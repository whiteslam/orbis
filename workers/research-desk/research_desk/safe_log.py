"""The worker's only output: run ids, fixed stage names and exception types.

GitHub Actions keeps every line a job prints. The repo running this is private,
but the rule is stricter than that: logs never carry portfolio values,
positions, prices, ratings or decision text. So nothing here takes free text:
a stage must be one of STAGES and an id must be a UUID, and an exception is
named by its class alone, since its message can quote data. Every library's
own logging is silenced in run.configure_logging().
"""

from __future__ import annotations

import re
import sys
from datetime import UTC, datetime

UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.IGNORECASE)

STAGES = frozenset({
    "start", "claimed", "skipped", "memory loaded", "memory saved", "graph built", "analysts",
    "debate", "plan", "trader", "risk", "decision", "recorded", "settled", "finished",
    "cancelled", "token cap", "failed", "settle start", "settle done", "no runs", "owner gone",
})


def _stamp() -> str:
    return datetime.now(UTC).strftime("%H:%M:%S")


def _checked(run_id: str) -> str:
    if not isinstance(run_id, str) or not UUID.match(run_id):
        raise ValueError("safe_log takes a run or user id (a UUID) only")
    return run_id[:8]


def stage(run_id: str, name: str, count: int | None = None) -> None:
    """One line: which run, which stage, and optionally a count (events, settlements)."""
    if name not in STAGES:
        raise ValueError("safe_log takes a fixed stage name only")
    suffix = f" ({int(count)})" if count is not None else ""
    print(f"{_stamp()} [{_checked(run_id)}] {name}{suffix}", file=sys.stdout, flush=True)


def failure(run_id: str, error: BaseException) -> None:
    """A failure, named by the exception's class only: its message may quote data."""
    print(f"{_stamp()} [{_checked(run_id)}] failed: {type(error).__name__}", file=sys.stdout, flush=True)


def note(name: str) -> None:
    """A run-independent stage (no runs to do, settle pass started)."""
    if name not in STAGES:
        raise ValueError("safe_log takes a fixed stage name only")
    print(f"{_stamp()} {name}", file=sys.stdout, flush=True)
