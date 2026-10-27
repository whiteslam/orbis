from types import SimpleNamespace

import pytest

from research_desk.memory import memory_path, parse_pct, settlements_from_entries
from research_desk.usage import PRICES_PER_MILLION, TokenCapReached, UsageMeter

USER_ID = "22222222-2222-4222-8222-222222222222"


def llm_result(model="anthropic/claude-haiku-5.5", prompt=1000, completion=200, cost=None, via_metadata=False):
    if via_metadata:
        message = SimpleNamespace(usage_metadata={"input_tokens": prompt, "output_tokens": completion},
                                  response_metadata={"model_name": model})
        return SimpleNamespace(llm_output=None, generations=[[SimpleNamespace(message=message)]])
    usage = {"prompt_tokens": prompt, "completion_tokens": completion, "total_tokens": prompt + completion}
    if cost is not None:
        usage["cost"] = cost
    return SimpleNamespace(llm_output={"token_usage": usage, "model_name": model}, generations=[])


def test_tokens_add_up_and_cost_comes_from_the_price_table():
    rows = []
    meter = UsageMeter(user_id=USER_ID, token_cap=3_000_000, sink=rows.append)
    meter.on_llm_end(llm_result("anthropic/claude-haiku-5.5", 1_000_000, 100_000))
    meter.on_llm_end(llm_result("anthropic/claude-sonnet-5.5", 100_000, 10_000, via_metadata=True))
    totals = meter.totals()
    assert totals["input_tokens"] == 1_100_000
    assert totals["output_tokens"] == 110_000
    # Haiku 5.5: $0.10 in + $0.50 out per million; Sonnet 5.5: $2 + $10.
    assert totals["cost_usd"] == pytest.approx(0.10 + 0.05 + 0.2 + 0.1)
    assert PRICES_PER_MILLION["anthropic/claude-sonnet-5.5"] == (2.0, 10.0)


def test_openrouter_s_own_cost_wins_over_the_table():
    meter = UsageMeter(user_id=USER_ID, token_cap=1_000_000, sink=lambda row: None)
    meter.on_llm_end(llm_result(cost=0.0042))
    assert meter.totals()["cost_usd"] == pytest.approx(0.0042)


def test_each_call_is_logged_for_settings_ai_without_its_text():
    rows = []
    meter = UsageMeter(user_id=USER_ID, token_cap=1_000_000, sink=rows.append)
    meter.on_chat_model_start({}, [["prompt mentioning RELIANCE 2900"]], run_id="r1")
    meter.on_llm_end(llm_result(cost=0.01), run_id="r1")
    row = rows[0]
    assert row["user_id"] == USER_ID
    assert row["feature"] == "research_desk"
    assert row["provider_id"] == "openrouter"
    assert row["model_id"] == "anthropic/claude-haiku-5.5"
    assert row["model"] == "openrouter/anthropic/claude-haiku-5.5"
    assert row["sensitivity"] == "personal"
    assert row["outcome"] == "succeeded"
    assert row["input_tokens"] == 1000 and row["output_tokens"] == 200
    assert row["cost_usd"] == pytest.approx(0.01)
    assert 0 <= row["duration_ms"] <= 120000
    assert "RELIANCE" not in repr(row)


def test_a_failing_sink_never_stops_the_run():
    def broken(row):
        raise OSError("db down")
    meter = UsageMeter(user_id=USER_ID, token_cap=1_000_000, sink=broken)
    meter.on_llm_end(llm_result())
    assert meter.totals()["input_tokens"] == 1000


def test_the_token_cap_stops_a_runaway_run():
    meter = UsageMeter(user_id=USER_ID, token_cap=2500, sink=lambda row: None)
    meter.on_llm_end(llm_result(prompt=1000, completion=200))
    with pytest.raises(TokenCapReached):
        meter.on_llm_end(llm_result(prompt=1200, completion=200))
    # LangChain swallows handler errors unless the handler asks it not to.
    assert meter.raise_error is True


def test_an_unknown_model_counts_tokens_but_no_cost():
    meter = UsageMeter(user_id=USER_ID, token_cap=1_000_000, sink=lambda row: None)
    meter.on_llm_end(llm_result(model="someone/new-model"))
    assert meter.totals()["input_tokens"] == 1000
    assert meter.totals()["cost_usd"] is None


def test_memory_lives_under_the_owner_s_folder():
    assert memory_path(USER_ID) == f"{USER_ID}/trading_memory.md"
    with pytest.raises(ValueError):
        memory_path("../other")


def test_percent_strings_from_the_memory_log():
    assert parse_pct("+1.2%") == 1.2
    assert parse_pct("-0.4%") == -0.4
    assert parse_pct("n/a") is None
    assert parse_pct(None) is None


def entry(ticker, date, raw, alpha, pending=False, reflection="Momentum held."):
    return {"date": date, "ticker": ticker, "rating": "Buy", "pending": pending, "raw": None if pending else raw,
            "alpha": None if pending else alpha, "holding": None if pending else "5d", "resolved": None, "decision": "...", "reflection": reflection}


def test_settled_entries_become_settlements_for_the_runs_that_made_them():
    runs = [
        {"id": "run-a", "ticker": "RELIANCE.NS", "trade_date": "2026-10-01", "status": "done", "created_at": "2026-10-01T04:00:00Z"},
        {"id": "run-a2", "ticker": "RELIANCE.NS", "trade_date": "2026-10-01", "status": "done", "created_at": "2026-10-01T06:00:00Z"},
        {"id": "run-b", "ticker": "500325.BO", "trade_date": "2026-10-02", "status": "done", "created_at": "2026-10-02T04:00:00Z"},
        {"id": "run-c", "ticker": "TCS.NS", "trade_date": "2026-10-03", "status": "done", "created_at": "2026-10-03T04:00:00Z"},
    ]
    entries = [
        entry("RELIANCE.NS", "2026-10-01", "+2.1%", "+1.5%"),
        entry("500325.BO", "2026-10-02", "-1.0%", "-0.4%"),
        entry("TCS.NS", "2026-10-03", None, None, pending=True),
        entry("INFY.NS", "2026-09-01", "+1.0%", "+0.5%"),  # no run of ours made it
    ]
    rows = settlements_from_entries(entries, runs, USER_ID, already_settled={"run-z"})
    assert [row["run_id"] for row in rows] == ["run-a", "run-b"]
    first, second = rows
    assert first["return_pct"] == 2.1 and first["alpha_pct"] == 1.5 and first["benchmark_pct"] == pytest.approx(0.6)
    assert first["benchmark"] == "^NSEI" and first["holding_days"] == 5
    assert second["benchmark"] == "^BSESN"
    assert first["user_id"] == USER_ID and first["reflection"] == "Momentum held."
    assert settlements_from_entries(entries, runs, USER_ID, already_settled={"run-a", "run-b"}) == []


SEP = "\n\n<!-- ENTRY_END -->\n\n"


def test_two_jobs_writing_the_same_log_lose_nothing():
    from research_desk.memory import merge_logs

    remote = "[2026-10-01 | TCS.NS | Buy | pending]\n\nDECISION:\nA" + SEP + "[2026-10-02 | INFY.NS | Hold | pending]\n\nDECISION:\nB" + SEP
    local = ("[2026-10-01 | TCS.NS | Buy | +1.0% | +0.2% | 5d | resolved:2026-10-09]\n\nDECISION:\nA\n\nREFLECTION:\nOk" + SEP
             + "[2026-10-27 | RELIANCE.NS | Overweight | pending]\n\nDECISION:\nC" + SEP)
    merged = merge_logs(remote, local)
    blocks = [b for b in merged.split(SEP) if b.strip()]
    assert [b.splitlines()[0].split("|")[1].strip() for b in blocks] == ["TCS.NS", "INFY.NS", "RELIANCE.NS"]
    # The settled version of an entry wins over the pending one, whichever side has it.
    assert "resolved:2026-10-09" in blocks[0]
    assert merge_logs(local, remote).count("resolved:2026-10-09") == 1
    assert merge_logs("", local) == local
