import pytest

from research_desk import safe_log
from research_desk.supabase import SupabaseRest
from research_desk.writer import RunWriter
from tests.fakes import FakeDb, RecordingOpener

RUN_ID = "11111111-1111-4111-8111-111111111111"
USER_ID = "22222222-2222-4222-8222-222222222222"


def queued_run(**extra):
    return {"id": RUN_ID, "user_id": USER_ID, "status": "queued", **extra}


def test_claim_takes_only_a_queued_run():
    db = FakeDb([queued_run()])
    writer = RunWriter(db, RUN_ID, USER_ID)
    assert writer.claim() is True
    table, filters, patch = db.updates[0]
    assert table == "research_runs"
    assert filters == {"id": f"eq.{RUN_ID}", "status": "eq.queued"}
    assert patch["status"] == "running"
    # A second worker (a retried workflow) finds it already running.
    assert RunWriter(db, RUN_ID, USER_ID).claim() is False


def test_events_are_numbered_in_order_and_trimmed():
    db = FakeDb([queued_run()])
    writer = RunWriter(db, RUN_ID, USER_ID)
    writer.claim()
    writer.emit("market", "report", "Uptrend.")
    writer.emit("bull", "turn", "x" * 70000)
    writer.emit("bear", "turn", "   ")  # nothing to say: not written
    assert [e["seq"] for e in db.events] == [1, 2]
    assert len(db.events[1]["content"]) == 60000
    assert db.events[0]["user_id"] == USER_ID and db.events[0]["run_id"] == RUN_ID


def test_a_restarted_worker_carries_on_from_the_last_event():
    db = FakeDb([queued_run()])
    db.events = [{"run_id": RUN_ID, "seq": 7, "user_id": USER_ID}]
    writer = RunWriter(db, RUN_ID, USER_ID)
    writer.claim()
    writer.emit("desk", "status", "Back.")
    assert db.events[-1]["seq"] == 8


def test_finish_never_overwrites_a_cancelled_run():
    db = FakeDb([queued_run()])
    writer = RunWriter(db, RUN_ID, USER_ID)
    writer.claim()
    db.runs[RUN_ID]["status"] = "cancelled"
    assert writer.cancelled() is True
    assert writer.finish({"rating": "Buy"}, {"input_tokens": 1, "output_tokens": 2, "cost_usd": 0.1}) is False
    assert db.runs[RUN_ID]["status"] == "cancelled"


def test_a_run_whose_row_is_gone_counts_as_cancelled():
    db = FakeDb([queued_run()])
    writer = RunWriter(db, RUN_ID, USER_ID)
    writer.claim()
    assert writer.cancelled() is False and writer.exists() is True
    del db.runs[RUN_ID]
    assert writer.cancelled() is True and writer.exists() is False


def test_finish_records_the_decision_and_the_spend():
    db = FakeDb([queued_run()])
    writer = RunWriter(db, RUN_ID, USER_ID)
    writer.claim()
    assert writer.finish({"rating": "Hold"}, {"input_tokens": 100, "output_tokens": 20, "cost_usd": 0.0123456789}) is True
    row = db.runs[RUN_ID]
    assert row["status"] == "done"
    assert row["decision"] == {"rating": "Hold"}
    assert row["tokens"] == 120
    assert row["cost_usd"] == 0.012346


def test_fail_keeps_a_short_message_and_leaves_finished_runs_alone():
    db = FakeDb([queued_run()])
    writer = RunWriter(db, RUN_ID, USER_ID)
    writer.claim()
    writer.fail("Prices weren't available. " * 50)
    assert db.runs[RUN_ID]["status"] == "failed"
    assert len(db.runs[RUN_ID]["error"]) <= 500
    _, filters, _ = db.updates[-1]
    assert filters["status"] == "in.(queued,running)"


def test_a_jwt_service_key_is_sent_as_bearer_and_a_secret_key_is_not():
    opener = RecordingOpener([(200, [])])
    SupabaseRest("https://x.supabase.co", "eyJhbGciOi.test.sig", opener=opener).select("research_runs", {"id": "eq.1"})
    headers = opener.requests[0]["headers"]
    assert headers["apikey"] == "eyJhbGciOi.test.sig"
    assert headers["authorization"] == "Bearer eyJhbGciOi.test.sig"

    opener = RecordingOpener([(200, [])])
    SupabaseRest("https://x.supabase.co", "sb_secret_abc", opener=opener).select("research_runs", {"id": "eq.1"})
    headers = opener.requests[0]["headers"]
    assert headers["apikey"] == "sb_secret_abc"
    assert "authorization" not in headers


def test_rest_calls_use_postgrest_paths_and_filters():
    opener = RecordingOpener([(200, [{"id": "a"}]), (201, []), (200, [{"id": "a"}])])
    db = SupabaseRest("https://x.supabase.co/", "sb_secret_abc", opener=opener)
    assert db.select("research_runs", {"id": "eq.a", "select": "id"}) == [{"id": "a"}]
    db.insert("research_events", [{"seq": 1}])
    db.update("research_runs", {"id": "eq.a"}, {"status": "done"})
    first, second, third = opener.requests
    assert first["path"] == "/rest/v1/research_runs" and first["params"] == {"id": "eq.a", "select": "id"}
    assert second["method"] == "POST" and second["body"] == [{"seq": 1}]
    assert third["method"] == "PATCH" and third["headers"]["prefer"] == "return=representation"


def test_storage_download_of_a_missing_file_is_none():
    opener = RecordingOpener([(404, {"error": "not_found"})])
    db = SupabaseRest("https://x.supabase.co", "sb_secret_abc", opener=opener)
    assert db.storage_download("research-memory", f"{USER_ID}/trading_memory.md") is None
    assert opener.requests[0]["path"] == f"/storage/v1/object/research-memory/{USER_ID}/trading_memory.md"


def test_a_failed_rest_call_raises_without_echoing_the_body():
    opener = RecordingOpener([(500, {"message": "secret detail RELIANCE 1234"})])
    db = SupabaseRest("https://x.supabase.co", "sb_secret_abc", opener=opener)
    with pytest.raises(Exception) as caught:
        db.select("research_runs", {})
    assert "RELIANCE" not in str(caught.value)
    assert "500" in str(caught.value)


def test_safe_log_prints_only_ids_stages_and_exception_types(capsys):
    safe_log.stage(RUN_ID, "claimed")
    safe_log.failure(RUN_ID, ValueError("RELIANCE target 3100"))
    out = capsys.readouterr().out
    assert "claimed" in out and "ValueError" in out
    assert "RELIANCE" not in out and "3100" not in out
    with pytest.raises(ValueError):
        safe_log.stage(RUN_ID, "decision was Buy")
    with pytest.raises(ValueError):
        safe_log.stage("not-a-uuid RELIANCE", "claimed")
