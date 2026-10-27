"""One research run, start to finish, and the settle-only pass.

run_one claims a queued research_runs row, brings the owner's memory log down,
runs TradingAgents on the ticker with the India setup, writes each agent's
output as it arrives, checks for a cancel after every step, records the call
and its spend, puts the memory log back and syncs settlements. Everything that
talks to TradingAgents is in UpstreamGraph, so the rest is tested with a fake.
"""

from __future__ import annotations

import logging
import tempfile
import warnings
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from typing import Any, Protocol

from research_desk import safe_log
from research_desk.decision import parse_decision
from research_desk.events import StateDiffer
from research_desk.india import analysts_for, build_config
from research_desk.memory import download_memory, settlements_from_entries, upload_memory
from research_desk.news import set_company_name
from research_desk.tickers import is_indian
from research_desk.usage import TokenCapReached, UsageMeter
from research_desk.writer import RunWriter

DEFAULT_TOKEN_CAP = 600_000
STAGE_OF = {
    "market": "analysts", "fundamentals": "analysts", "news": "analysts", "bull": "debate", "bear": "debate",
    "research_manager": "plan", "trader": "trader", "risk_aggressive": "risk", "risk_conservative": "risk",
    "risk_neutral": "risk", "portfolio_manager": "decision",
}


class Graph(Protocol):
    def stream(self, ticker: str, trade_date: str, portfolio: dict | None) -> Iterator[dict]: ...
    def record(self, ticker: str, trade_date: str, final_state: dict) -> None: ...
    def rating(self, final_state: dict) -> str: ...
    def entries(self) -> list[dict]: ...
    def settle_all(self) -> Any: ...


@dataclass
class Deps:
    db: Any
    make_graph: Callable[[list[str], dict, list], Graph]
    base_config: dict
    home: str | None = None
    today: Callable[[], str] | None = None
    resolve_name: Callable[[str], str | None] | None = None


class Cancelled(Exception):
    """The owner cancelled the run."""


def configure_logging() -> None:
    """Silence every library's logging: their messages can quote tickers, prices and decisions."""
    logging.basicConfig(level=logging.CRITICAL)
    logging.getLogger().setLevel(logging.CRITICAL)
    warnings.filterwarnings("ignore")


def _caused_by(error: BaseException, kind: type[BaseException]) -> bool:
    seen = set()
    while error is not None and id(error) not in seen:
        if isinstance(error, kind):
            return True
        seen.add(id(error))
        error = error.__cause__ or error.__context__
    return False


def _failure_message(error: BaseException, cap: int) -> str:
    if _caused_by(error, TokenCapReached):
        return (f"Stopped at this run's token cap ({cap:,} tokens). "
                "Raise the cap in the desk's settings if runs need more.")
    # The class only: an exception's message can quote prices, positions or the model's words.
    return f"The run failed ({type(error).__name__}). Try again; if it keeps failing, check the worker's log."


def _usage_sink(db) -> Callable[[dict], None]:
    return lambda row: db.insert("ai_generation_events", [row])


def sync_settlements(db, graph: Graph, user_id: str) -> int:
    """New research_settlements rows from the memory log's settled entries. Returns how many."""
    runs = db.select("research_runs", {"select": "id,ticker,trade_date,status,created_at", "user_id": f"eq.{user_id}", "status": "eq.done"})
    settled = {row["run_id"] for row in db.select("research_settlements", {"select": "run_id", "user_id": f"eq.{user_id}"})}
    rows = settlements_from_entries(graph.entries(), runs, user_id, settled)
    if rows:
        db.insert("research_settlements", rows, upsert_on="run_id")
    return len(rows)


def _owner_present(db, user_id: str) -> bool:
    """Whether the owner still has Research desk rows; deleting an account deletes them all."""
    owner = {"user_id": f"eq.{user_id}", "limit": "1"}
    return bool(db.select("research_settings", {"select": "user_id", **owner})
                or db.select("research_runs", {"select": "id", **owner}))


def run_one(run_id: str, deps: Deps) -> str:
    """Runs one queued run. Returns its final status: done, cancelled, failed, skipped or missing."""
    db = deps.db
    rows = db.select("research_runs", {"select": "*", "id": f"eq.{run_id}"})
    if not rows:
        safe_log.stage(run_id, "skipped")
        return "missing"
    row = rows[0]
    user_id, ticker = row["user_id"], row["ticker"]
    writer = RunWriter(db, run_id, user_id)
    if not is_indian(ticker):
        writer.fail("The Research desk analyses NSE and BSE listings only.")
        safe_log.stage(run_id, "failed")
        return "failed"
    if not writer.claim():
        safe_log.stage(run_id, "skipped")
        return "skipped"
    safe_log.stage(run_id, "claimed")

    settings = row.get("config") or {}
    cap = int(settings.get("tokenCap") or DEFAULT_TOKEN_CAP)
    usage = UsageMeter(user_id=user_id, token_cap=cap, sink=_usage_sink(db))
    home = deps.home or tempfile.mkdtemp(prefix="research-desk-")
    config = build_config(settings, deps.base_config, home=f"{home}/{run_id[:8]}")
    graph: Graph | None = None
    try:
        # Upstream refuses a date after its own today, and the runner's clock is UTC
        # while the app dates runs in India: a run queued just after midnight IST would
        # otherwise fail. The row follows, so settlement finds it by its real date.
        today = deps.today() if deps.today else str(row["trade_date"])
        trade_date = min(str(row["trade_date"])[:10], today)
        if trade_date != str(row["trade_date"])[:10]:
            db.update("research_runs", {"id": f"eq.{run_id}"}, {"trade_date": trade_date})

        if download_memory(db, user_id, config["memory_log_path"]):
            safe_log.stage(run_id, "memory loaded")
        if deps.resolve_name:
            set_company_name(ticker, deps.resolve_name(ticker))

        graph = deps.make_graph(analysts_for(ticker), config, [usage])
        safe_log.stage(run_id, "graph built")
        writer.emit("desk", "status", "Analysts started: market, fundamentals and news. Sentiment is off for Indian listings.")

        differ = StateDiffer()
        final: dict = {}
        last_stage = None
        for state in graph.stream(ticker, trade_date, row.get("portfolio_context")):
            if isinstance(state, dict):
                final.update(state)
            for agent, kind, content in differ.diff(state):
                writer.emit(agent, kind, content)
                if STAGE_OF.get(agent) != last_stage:
                    last_stage = STAGE_OF.get(agent)
                    safe_log.stage(run_id, last_stage)
            if writer.cancelled():
                raise Cancelled()

        if writer.cancelled():
            raise Cancelled()
        graph.record(ticker, trade_date, final)
        safe_log.stage(run_id, "recorded")
        decision = parse_decision(final.get("final_trade_decision", ""), final.get("trader_investment_plan", ""), graph.rating(final))
        if not writer.finish(decision, usage.totals()):
            raise Cancelled()
        status = "done"
        safe_log.stage(run_id, "finished")
    except Cancelled:
        writer.record_usage(usage.totals())
        safe_log.stage(run_id, "cancelled")
        status = "cancelled"
    except Exception as error:  # noqa: BLE001 — every failure ends as a failed row, not a stuck one
        writer.record_usage(usage.totals())
        writer.fail(_failure_message(error, cap))
        safe_log.failure(run_id, error)
        status = "failed"

    # Settlements made during the run (upstream settles due calls beside its
    # analysts) are real whatever became of this run, so the log goes back up,
    # unless the row is gone: the owner deleted their account mid-run, and the
    # log was deleted with it.
    try:
        if not writer.exists():
            safe_log.stage(run_id, "owner gone")
            return status
        if upload_memory(db, user_id, config["memory_log_path"]):
            safe_log.stage(run_id, "memory saved")
        if graph is not None:
            safe_log.stage(run_id, "settled", sync_settlements(db, graph, user_id))
    except Exception as error:  # noqa: BLE001
        safe_log.failure(run_id, error)
    return status


def settle_user(user_id: str, deps: Deps, token_cap: int = 200_000) -> int:
    """Settles the owner's due calls without a new analysis (the Saturday pass). Returns new settlements."""
    db = deps.db
    settings_rows = db.select("research_settings", {"select": "deep_model,quick_model", "user_id": f"eq.{user_id}"})
    stored = settings_rows[0] if settings_rows else {}
    settings = {"deepModel": stored.get("deep_model"), "quickModel": stored.get("quick_model")}
    home = deps.home or tempfile.mkdtemp(prefix="research-desk-")
    config = build_config(settings, deps.base_config, home=f"{home}/settle-{user_id[:8]}")
    if not download_memory(db, user_id, config["memory_log_path"]):
        return 0
    safe_log.stage(user_id, "settle start")
    usage = UsageMeter(user_id=user_id, token_cap=token_cap, sink=_usage_sink(db))
    # Reflections use the quick tier; building the graph calls no model.
    graph = deps.make_graph(["market"], config, [usage])
    graph.settle_all()
    if not _owner_present(db, user_id):
        # The account was deleted while this settled; its log was deleted with it and must stay gone.
        safe_log.stage(user_id, "owner gone")
        return 0
    upload_memory(db, user_id, config["memory_log_path"])
    count = sync_settlements(db, graph, user_id)
    safe_log.stage(user_id, "settle done", count)
    return count


class UpstreamGraph:
    """TradingAgentsGraph v0.7.1 behind the small interface run_one uses.

    Unverified until the first real run: this is the one place that depends on
    upstream's API (create_run_state, stream_run, record_decision, run_rating,
    settle_all_pending, memory_log.load_entries).
    """

    def __init__(self, analysts: list[str], config: dict, callbacks: list):
        from tradingagents.graph.trading_graph import TradingAgentsGraph

        self.graph = TradingAgentsGraph(selected_analysts=analysts, debug=False, config=config, callbacks=callbacks)
        _pin_openrouter(self.graph)

    def stream(self, ticker, trade_date, portfolio):
        from tradingagents.portfolio import PortfolioContext

        book = PortfolioContext.model_validate(portfolio) if portfolio else None
        initial = self.graph.create_run_state(ticker, trade_date, "stock", book)
        for _messages, state in self.graph.stream_run(initial, **self.graph.propagator.get_graph_args()):
            if state is not None:
                yield state

    def record(self, ticker, trade_date, final_state):
        self.graph.record_decision(ticker, trade_date, final_state)

    def rating(self, final_state):
        from tradingagents.agents.rating import run_rating

        return run_rating(final_state)

    def entries(self):
        return self.graph.memory_log.load_entries()

    def settle_all(self):
        return self.graph.settle_all_pending(wait=True)


def _pin_openrouter(graph) -> None:
    """Ask OpenRouter to route to providers that don't keep or train on prompts, and to report cost.

    Upstream builds the chat clients without a way to pass a request body, so
    this sets it on the two tier clients after the fact; the agents hold the
    same objects, so every call carries it. Best effort: if it can't be set the
    run goes ahead, and the OpenRouter account's own privacy setting applies.
    """
    body = {"provider": {"data_collection": "deny"}, "usage": {"include": True}}
    for llm in (getattr(graph, "deep_thinking_llm", None), getattr(graph, "quick_thinking_llm", None)):
        try:
            llm.extra_body = {**(getattr(llm, "extra_body", None) or {}), **body}
        except Exception:  # noqa: BLE001
            pass


def resolve_company_name(ticker: str) -> str | None:
    """The company's name from Yahoo's profile, for the Indian news vendor's search."""
    try:
        from tradingagents.agents.context import resolve_instrument_identity

        return resolve_instrument_identity(ticker).get("company_name")
    except Exception:  # noqa: BLE001
        return None


def upstream_today() -> str:
    from tradingagents.dataflows.date_window import get_current_date

    return get_current_date()
