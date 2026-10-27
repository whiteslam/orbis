"""TradingAgents' memory log, kept per person, and the track record drawn from it.

Upstream keeps a markdown log of each decision and, once its holding period
has traded, the outcome against the benchmark and a reflection that later runs
read. The worker's disk is gone after each job, so the log lives in the private
`research-memory` bucket as <user_id>/trading_memory.md: downloaded before a
run, uploaded after. Settled entries become research_settlements rows, which
the app's track record reads.
"""

from __future__ import annotations

import os
import re
from datetime import UTC, datetime

from research_desk.india import BENCHMARKS

MEMORY_BUCKET = "research-memory"
UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.IGNORECASE)


def memory_path(user_id: str) -> str:
    if not isinstance(user_id, str) or not UUID.match(user_id):
        raise ValueError("A memory path needs a user id")
    return f"{user_id}/trading_memory.md"


def download_memory(db, user_id: str, local_path: str) -> bool:
    """The owner's log onto this machine; False when there is none yet (a first run)."""
    data = db.storage_download(MEMORY_BUCKET, memory_path(user_id))
    if not data:
        return False
    os.makedirs(os.path.dirname(local_path), exist_ok=True)
    with open(local_path, "wb") as handle:
        handle.write(data)
    return True


def upload_memory(db, user_id: str, local_path: str) -> bool:
    if not os.path.exists(local_path):
        return False
    with open(local_path, "rb") as handle:
        db.storage_upload(MEMORY_BUCKET, memory_path(user_id), handle.read(), "text/markdown")
    return True


def parse_pct(value) -> float | None:
    """'+1.2%' → 1.2; anything else → None."""
    if not isinstance(value, str):
        return None
    match = re.fullmatch(r"\s*([+-]?\d+(?:\.\d+)?)%\s*", value)
    return float(match.group(1)) if match else None


def _holding_days(value) -> int:
    match = re.fullmatch(r"\s*(\d+)d\s*", value or "")
    return max(1, min(60, int(match.group(1)))) if match else 5


def benchmark_for(ticker: str) -> str:
    return BENCHMARKS[".BO"] if ticker.endswith(".BO") else BENCHMARKS[".NS"]


def settlements_from_entries(entries: list[dict], runs: list[dict], user_id: str, already_settled: set[str]) -> list[dict]:
    """New research_settlements rows: one per settled log entry made by one of this owner's finished runs.

    The log keeps one entry per ticker and date, so when two runs share both,
    the first one made is the one the entry describes.
    """
    by_key: dict[tuple[str, str], dict] = {}
    for run in sorted(runs, key=lambda r: r.get("created_at") or ""):
        if run.get("status") == "done":
            by_key.setdefault((run["ticker"], str(run["trade_date"])[:10]), run)
    rows = []
    now = datetime.now(UTC).isoformat()
    for entry in entries:
        if entry.get("pending"):
            continue
        run = by_key.get((entry.get("ticker"), entry.get("date")))
        raw, alpha = parse_pct(entry.get("raw")), parse_pct(entry.get("alpha"))
        if not run or run["id"] in already_settled or raw is None or alpha is None:
            continue
        rows.append({
            "user_id": user_id,
            "run_id": run["id"],
            "ticker": run["ticker"],
            "trade_date": entry["date"],
            "benchmark": benchmark_for(run["ticker"]),
            "holding_days": _holding_days(entry.get("holding")),
            "return_pct": raw,
            "benchmark_pct": round(raw - alpha, 3),
            "alpha_pct": alpha,
            "reflection": (entry.get("reflection") or None) and entry["reflection"][:20000],
            "settled_at": now,
        })
    return rows
