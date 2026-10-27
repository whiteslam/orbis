import os
from types import SimpleNamespace

import pytest

from research_desk import __main__ as cli
from research_desk.memory import MEMORY_BUCKET, memory_path
from research_desk.run import Deps, run_one, settle_user
from research_desk.usage import TokenCapReached
from tests.fakes import FakeDb
from tests.test_events import PM, TRADER

ENTRY_END = "\n\n<!-- ENTRY_END -->\n\n"
RUN_ID = "11111111-1111-4111-8111-111111111111"
USER_ID = "22222222-2222-4222-8222-222222222222"


def queued_run(**extra):
    return {
        "id": RUN_ID, "user_id": USER_ID, "status": "queued", "ticker": "RELIANCE.NS", "symbol": "RELIANCE", "exchange": "NSE",
        "trade_date": "2026-10-27", "created_at": "2026-10-27T04:00:00Z",
        "portfolio_context": {"currency": "INR", "cash": None, "positions": [{"ticker": "RELIANCE.NS", "quantity": 20, "average_price": 2600}]},
        "config": {"analysts": ["market", "fundamentals", "news"], "deepModel": "anthropic/claude-sonnet-5.5",
                   "quickModel": "anthropic/claude-haiku-5.5", "tokenCap": 600000},
        **extra,
    }


class FakeGraph:
    """Stands in for TradingAgentsGraph: replays a scripted run, never calls a model."""

    def __init__(self, analysts, config, callbacks, *, states, on_state=None, entries=None, fail_with=None, on_settle=None):
        self.analysts, self.config, self.callbacks = analysts, config, callbacks
        self.on_settle = on_settle
        self.states, self.on_state, self._entries, self.fail_with = states, on_state, entries or [], fail_with
        self.recorded = None
        self.portfolio = None

    def stream(self, ticker, trade_date, portfolio):
        self.portfolio = portfolio
        for index, state in enumerate(self.states):
            if self.on_state:
                self.on_state(index)
            if self.fail_with and index == 1:
                raise self.fail_with
            # A model call's usage arrives through the callbacks.
            for callback in self.callbacks:
                callback.on_llm_end(SimpleNamespace(llm_output={"token_usage": {"prompt_tokens": 1000, "completion_tokens": 100},
                                                                "model_name": "anthropic/claude-haiku-5.5"}, generations=[]))
            yield state

    def record(self, ticker, trade_date, final_state):
        self.recorded = (ticker, trade_date, final_state.get("final_trade_decision"))
        os.makedirs(os.path.dirname(self.config["memory_log_path"]), exist_ok=True)
        with open(self.config["memory_log_path"], "a", encoding="utf-8") as handle:
            handle.write(f"[{trade_date} | {ticker} | Overweight | pending]\n\nDECISION:\nx{ENTRY_END}")

    def rating(self, final_state):
        return "Overweight"

    def entries(self):
        return self._entries

    def settle_all(self):
        if self.on_settle:
            self.on_settle()
        return None


STATES = [
    {"market_report": "Uptrend.", "news_report": "Quiet.", "fundamentals_report": "Debt falling."},
    {"investment_debate_state": {"current_response": "Bull Analyst: Margins.", "count": 1}},
    {"investment_debate_state": {"current_response": "Bear Analyst: Valuation.", "count": 2}, "investment_plan": "Lean long."},
    {"trader_investment_plan": TRADER},
    {"risk_debate_state": {"current_neutral_response": "Neutral Analyst: Half size."}},
    {"final_trade_decision": PM},
]


def make_deps(db, tmp_path, **graph_kwargs):
    built = {}

    def make_graph(analysts, config, callbacks):
        built["graph"] = FakeGraph(analysts, config, callbacks, states=graph_kwargs.pop("states", STATES), **graph_kwargs)
        return built["graph"]

    deps = Deps(db=db, make_graph=make_graph, base_config={"data_vendors": {}, "tool_vendors": {}, "benchmark_map": {}},
                home=str(tmp_path), today=lambda: "2026-10-27", resolve_name=lambda ticker: "Reliance Industries Limited")
    return deps, built


def test_a_run_streams_its_events_and_finishes_with_the_call(tmp_path):
    db = FakeDb([queued_run()])
    db.storage[(MEMORY_BUCKET, memory_path(USER_ID))] = f"[2026-10-01 | TCS.NS | Buy | pending]\n\nDECISION:\ny{ENTRY_END}".encode()
    deps, built = make_deps(db, tmp_path)
    assert run_one(RUN_ID, deps) == "done"
    graph = built["graph"]
    assert graph.analysts == ["market", "fundamentals", "news"]
    assert graph.config["deep_think_llm"] == "anthropic/claude-sonnet-5.5"
    assert graph.portfolio["positions"][0]["ticker"] == "RELIANCE.NS"
    agents = [e["agent"] for e in db.events if e["kind"] != "status"]
    assert agents == ["market", "fundamentals", "news", "bull", "bear", "research_manager", "trader", "risk_neutral", "portfolio_manager"]
    row = db.runs[RUN_ID]
    assert row["status"] == "done"
    assert row["decision"]["rating"] == "Overweight" and row["decision"]["priceTarget"] == 3100.0
    assert row["tokens"] == 6 * 1100
    assert row["cost_usd"] == pytest.approx(6 * (1000 * 0.10 + 100 * 0.50) / 1_000_000, abs=1e-6)
    # The memory log came down before the run and went back up after it, with this run's entry.
    saved = db.storage[(MEMORY_BUCKET, memory_path(USER_ID))].decode()
    assert "TCS.NS" in saved and "RELIANCE.NS | Overweight | pending" in saved
    # Each model call went to ai_generation_events for Settings → AI.
    assert len(db.ai_events) == 6 and db.ai_events[0]["feature"] == "research_desk"


def test_a_run_cancelled_midway_stops_and_is_never_marked_done(tmp_path):
    db = FakeDb([queued_run()])

    def cancel_at(index):
        if index == 3:
            db.runs[RUN_ID]["status"] = "cancelled"

    deps, built = make_deps(db, tmp_path, on_state=cancel_at)
    assert run_one(RUN_ID, deps) == "cancelled"
    assert db.runs[RUN_ID]["status"] == "cancelled"
    assert built["graph"].recorded is None
    assert not any(e["agent"] == "portfolio_manager" for e in db.events)
    # What it spent before stopping is still on the row.
    assert db.runs[RUN_ID]["tokens"] > 0


def test_a_run_past_its_token_cap_fails_with_a_reason(tmp_path):
    db = FakeDb([queued_run(config={**queued_run()["config"], "tokenCap": 2000})])
    deps, _ = make_deps(db, tmp_path)
    assert run_one(RUN_ID, deps) == "failed"
    assert "token cap" in db.runs[RUN_ID]["error"]


def test_an_upstream_error_fails_the_run_without_quoting_it(tmp_path):
    db = FakeDb([queued_run()])
    deps, _ = make_deps(db, tmp_path, fail_with=RuntimeError("RELIANCE price 2900 leaked"))
    assert run_one(RUN_ID, deps) == "failed"
    assert "RELIANCE" not in db.runs[RUN_ID]["error"] and "RuntimeError" in db.runs[RUN_ID]["error"]


def test_a_token_cap_wrapped_by_the_graph_is_still_recognised(tmp_path):
    db = FakeDb([queued_run()])
    wrapped = RuntimeError("graph step failed")
    wrapped.__cause__ = TokenCapReached("cap")
    deps, _ = make_deps(db, tmp_path, fail_with=wrapped)
    assert run_one(RUN_ID, deps) == "failed"
    assert "token cap" in db.runs[RUN_ID]["error"]


def test_a_run_someone_else_claimed_or_that_isn_t_indian_is_left_alone(tmp_path):
    db = FakeDb([queued_run(status="running")])
    deps, built = make_deps(db, tmp_path)
    assert run_one(RUN_ID, deps) == "skipped"
    assert "graph" not in built
    db = FakeDb([queued_run(ticker="AAPL")])
    deps, built = make_deps(db, tmp_path)
    assert run_one(RUN_ID, deps) == "failed"
    assert "graph" not in built


def test_a_date_ahead_of_the_runner_s_today_is_brought_back(tmp_path):
    # Queued in India just after midnight, run on a UTC machine still on the day before.
    db = FakeDb([queued_run(trade_date="2026-10-28")])
    deps, built = make_deps(db, tmp_path)
    assert run_one(RUN_ID, deps) == "done"
    assert db.runs[RUN_ID]["trade_date"] == "2026-10-27"
    assert built["graph"].recorded[1] == "2026-10-27"


def test_settled_entries_are_synced_after_a_run(tmp_path):
    earlier = {**queued_run(), "id": "33333333-3333-4333-8333-333333333333", "status": "done", "trade_date": "2026-10-01",
               "created_at": "2026-10-01T04:00:00Z"}
    db = FakeDb([queued_run(), earlier])
    entries = [{"date": "2026-10-01", "ticker": "RELIANCE.NS", "rating": "Buy", "pending": False, "raw": "+2.0%", "alpha": "+0.5%",
                "holding": "5d", "resolved": "2026-10-09", "decision": "", "reflection": "Held up."}]
    deps, _ = make_deps(db, tmp_path, entries=entries)
    assert run_one(RUN_ID, deps) == "done"
    assert [row["run_id"] for row in db.settlements] == [earlier["id"]]
    assert db.settlements[0]["alpha_pct"] == 0.5


def test_settle_mode_settles_and_syncs_without_a_run(tmp_path):
    earlier = {**queued_run(), "status": "done", "trade_date": "2026-10-01"}
    db = FakeDb([earlier])
    entries = [{"date": "2026-10-01", "ticker": "RELIANCE.NS", "rating": "Buy", "pending": False, "raw": "-1.0%", "alpha": "-1.5%",
                "holding": "5d", "resolved": "2026-10-09", "decision": "", "reflection": ""}]
    deps, _ = make_deps(db, tmp_path, entries=entries)
    # No memory log yet: nothing to settle, and no model is asked.
    assert settle_user(USER_ID, deps) == 0
    db.storage[(MEMORY_BUCKET, memory_path(USER_ID))] = b"[2026-10-01 | RELIANCE.NS | Buy | pending]\n"
    assert settle_user(USER_ID, deps) == 1
    assert db.settlements[0]["benchmark_pct"] == 0.5


def delete_account(db):
    """What deleteAccount leaves behind: the memory log removed, then the runs cascaded away with the user."""
    db.storage.clear()
    db.runs.clear()


def test_a_run_whose_account_is_deleted_midway_stops_and_never_saves_the_log(tmp_path):
    db = FakeDb([queued_run()])
    db.storage[(MEMORY_BUCKET, memory_path(USER_ID))] = f"[2026-10-01 | TCS.NS | Buy | pending]\n\nDECISION:\ny{ENTRY_END}".encode()

    def delete_at(index):
        if index == 2:
            delete_account(db)

    deps, built = make_deps(db, tmp_path, on_state=delete_at)
    # A missing row counts as cancelled, so the run stops instead of carrying on.
    assert run_one(RUN_ID, deps) == "cancelled"
    assert built["graph"].recorded is None
    assert db.storage == {}
    assert db.settlements == []


def test_a_run_that_fails_after_its_account_is_deleted_never_saves_the_log(tmp_path):
    db = FakeDb([queued_run()])
    db.storage[(MEMORY_BUCKET, memory_path(USER_ID))] = f"[2026-10-01 | TCS.NS | Buy | pending]\n\nDECISION:\ny{ENTRY_END}".encode()

    def delete_at(index):
        if index == 1:
            delete_account(db)

    deps, _ = make_deps(db, tmp_path, on_state=delete_at, fail_with=RuntimeError("insert violates foreign key"))
    assert run_one(RUN_ID, deps) == "failed"
    assert db.storage == {}


def test_settle_mode_never_saves_the_log_of_an_account_deleted_meanwhile(tmp_path):
    earlier = {**queued_run(), "status": "done", "trade_date": "2026-10-01"}
    db = FakeDb([earlier])
    db.storage[(MEMORY_BUCKET, memory_path(USER_ID))] = b"[2026-10-01 | RELIANCE.NS | Buy | pending]\n"
    entries = [{"date": "2026-10-01", "ticker": "RELIANCE.NS", "rating": "Buy", "pending": False, "raw": "-1.0%", "alpha": "-1.5%",
                "holding": "5d", "resolved": "2026-10-09", "decision": "", "reflection": ""}]
    deps, _ = make_deps(db, tmp_path, entries=entries, on_settle=lambda: delete_account(db))
    assert settle_user(USER_ID, deps) == 0
    assert db.storage == {}
    assert db.settlements == []


def test_the_command_line_refuses_bad_ids_before_touching_anything(monkeypatch):
    def boom(*args, **kwargs):
        raise AssertionError("no network for bad input")

    monkeypatch.setattr(cli, "connect", boom)
    assert cli.main(["run", "--run-ids", "not-a-uuid"]) == 2
    assert cli.main(["run", "--run-ids", ""]) == 2
    assert cli.main(["settle", "--user-id", "../x"]) == 2
    assert cli.main(["dance"]) == 2
