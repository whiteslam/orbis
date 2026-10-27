"""Writing one run's progress into Supabase: claim it, add events, finish or fail it.

Every status change is conditional, so the database decides races: two workers
(a retried workflow) can't both claim a run, and a run the owner cancelled is
never turned back into `done`.
"""

from __future__ import annotations

from datetime import UTC, datetime

MAX_CONTENT = 60000
MAX_ERROR = 500


def _now() -> str:
    return datetime.now(UTC).isoformat()


class RunWriter:
    def __init__(self, db, run_id: str, user_id: str):
        self.db = db
        self.run_id = run_id
        self.user_id = user_id
        self.seq = 0

    def _filters(self, **conditions) -> dict:
        return {"id": f"eq.{self.run_id}", **conditions}

    def claim(self) -> bool:
        """queued → running. False when another worker has it, or it was cancelled first."""
        claimed = self.db.update("research_runs", self._filters(status="eq.queued"), {"status": "running", "started_at": _now()})
        if not claimed:
            return False
        last = self.db.select("research_events", {
            "select": "seq", "run_id": f"eq.{self.run_id}", "order": "seq.desc", "limit": "1",
        })
        self.seq = int(last[0]["seq"]) if last else 0
        return True

    def emit(self, agent: str, kind: str, content: str) -> None:
        text = (content or "").strip()
        if not text:
            return
        self.seq += 1
        self.db.insert("research_events", [{
            "user_id": self.user_id, "run_id": self.run_id, "seq": self.seq,
            "agent": agent, "kind": kind, "content": text[:MAX_CONTENT],
        }])

    def cancelled(self) -> bool:
        rows = self.db.select("research_runs", self._filters(select="status"))
        return bool(rows) and rows[0].get("status") == "cancelled"

    def finish(self, decision: dict, usage: dict) -> bool:
        """running → done with the call and its spend. False when the run was cancelled meanwhile."""
        input_tokens = int(usage.get("input_tokens") or 0)
        output_tokens = int(usage.get("output_tokens") or 0)
        cost = usage.get("cost_usd")
        done = self.db.update("research_runs", self._filters(status="eq.running"), {
            "status": "done",
            "decision": decision,
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "tokens": input_tokens + output_tokens,
            "cost_usd": round(float(cost), 6) if cost is not None else None,
            "finished_at": _now(),
        })
        return bool(done)

    def record_usage(self, usage: dict) -> None:
        """What a stopped or failed run spent, so the bill on the screen stays honest."""
        input_tokens = int(usage.get("input_tokens") or 0)
        output_tokens = int(usage.get("output_tokens") or 0)
        cost = usage.get("cost_usd")
        self.db.update("research_runs", self._filters(), {
            "input_tokens": input_tokens, "output_tokens": output_tokens, "tokens": input_tokens + output_tokens,
            "cost_usd": round(float(cost), 6) if cost is not None else None,
        })

    def fail(self, message: str) -> None:
        self.db.update("research_runs", self._filters(status="in.(queued,running)"), {
            "status": "failed", "error": (message or "The run failed.")[:MAX_ERROR], "finished_at": _now(),
        })
