"""Fakes for the worker's tests: a recording database, never the real Supabase."""

from __future__ import annotations

import json
from urllib.parse import parse_qsl, urlsplit


class FakeResponse:
    def __init__(self, status: int, body: bytes = b""):
        self.status = status
        self._body = body

    def read(self) -> bytes:
        return self._body

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


class RecordingOpener:
    """Stands in for urllib's urlopen: records each request, answers from a script."""

    def __init__(self, answers=None):
        self.requests = []
        self.answers = list(answers or [])

    def __call__(self, request, timeout=None):
        url = urlsplit(request.full_url)
        body = request.data
        self.requests.append({
            "method": request.get_method(),
            "path": url.path,
            "params": dict(parse_qsl(url.query)),
            "headers": {k.lower(): v for k, v in request.header_items()},
            "body": json.loads(body) if body and request.get_header("Content-type") == "application/json" else body,
        })
        status, payload = self.answers.pop(0) if self.answers else (200, [])
        raw = payload if isinstance(payload, bytes) else json.dumps(payload).encode()
        return FakeResponse(status, raw)


class FakeDb:
    """The handful of SupabaseRest calls the writer and run use, kept in memory."""

    def __init__(self, runs=None):
        self.runs = {run["id"]: dict(run) for run in (runs or [])}
        self.events = []
        self.inserts = []
        self.updates = []
        self.settlements = []
        self.ai_events = []
        self.storage = {}

    @staticmethod
    def _matches(row, filters):
        for key, condition in filters.items():
            if key in ("select", "order", "limit"):
                continue
            op, _, value = condition.partition(".")
            if op == "eq" and str(row.get(key)) != value:
                return False
            if op == "in" and str(row.get(key)) not in value.strip("()").split(","):
                return False
        return True

    def select(self, table, params):
        if table == "research_runs":
            return [dict(r) for r in self.runs.values() if self._matches(r, params)]
        if table == "research_events":
            rows = [e for e in self.events if self._matches(e, params)]
            return sorted(rows, key=lambda e: -e["seq"])[: int(params.get("limit", 1000))]
        if table == "research_settlements":
            return [dict(r) for r in self.settlements if self._matches(r, params)]
        return []

    def insert(self, table, rows, **kwargs):
        rows = rows if isinstance(rows, list) else [rows]
        self.inserts.append((table, rows))
        if table == "research_events":
            self.events.extend(rows)
        if table == "research_settlements":
            self.settlements.extend(rows)
        if table == "ai_generation_events":
            self.ai_events.extend(rows)
        return rows

    def storage_download(self, bucket, path):
        return self.storage.get((bucket, path))

    def storage_upload(self, bucket, path, data, content_type="text/markdown"):
        self.storage[(bucket, path)] = data

    def update(self, table, filters, patch):
        self.updates.append((table, filters, patch))
        if table != "research_runs":
            return []
        changed = []
        for row in self.runs.values():
            if self._matches(row, filters):
                row.update(patch)
                changed.append(dict(row))
        return changed
