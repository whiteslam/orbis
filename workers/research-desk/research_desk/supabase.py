"""A small Supabase client over PostgREST and Storage, with the standard library only.

The worker writes as the service role, so every request carries the key the
private repo keeps as a secret (SUPABASE_SERVICE_ROLE_KEY). A legacy
service_role key is a JWT and goes in both headers; a new `sb_secret_` key goes
in `apikey` only. Errors name the table and the status, never the response
body, which can quote row data.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from collections.abc import Callable
from urllib.parse import quote, urlencode

Opener = Callable[..., object]


class SupabaseError(RuntimeError):
    """A request Supabase refused or couldn't answer. The message holds no row data."""

    def __init__(self, what: str, status: int):
        super().__init__(f"Supabase {what} failed with status {status}")
        self.status = status


class SupabaseRest:
    def __init__(self, url: str, key: str, opener: Opener | None = None, timeout: float = 30.0):
        if not url or not key:
            raise ValueError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required")
        self.url = url.rstrip("/")
        self.key = key
        self.opener = opener or urllib.request.urlopen
        self.timeout = timeout

    def _headers(self, extra: dict | None = None) -> dict:
        headers = {"apikey": self.key}
        if self.key.startswith("eyJ"):
            headers["Authorization"] = f"Bearer {self.key}"
        headers.update(extra or {})
        return headers

    def _send(self, method: str, path: str, *, params: dict | None = None, body: bytes | None = None,
              headers: dict | None = None, what: str = "request", allow_missing: bool = False) -> tuple[int, bytes]:
        url = f"{self.url}{path}"
        if params:
            url += "?" + urlencode(params, safe="(),.:*")
        request = urllib.request.Request(url, data=body, method=method, headers=self._headers(headers))
        try:
            with self.opener(request, timeout=self.timeout) as response:
                status, raw = response.status, response.read()
        except urllib.error.HTTPError as error:
            status, raw = error.code, b""
        except (urllib.error.URLError, TimeoutError, OSError) as error:
            raise SupabaseError(what, 0) from error
        if allow_missing and status in (400, 404):
            return status, b""
        if status >= 300:
            raise SupabaseError(what, status)
        return status, raw

    @staticmethod
    def _json(raw: bytes):
        return json.loads(raw) if raw else []

    # ─── PostgREST ──────────────────────────────────────────────────────────

    def select(self, table: str, params: dict) -> list:
        _, raw = self._send("GET", f"/rest/v1/{table}", params=params, what=f"select on {table}")
        return self._json(raw)

    def insert(self, table: str, rows, *, upsert_on: str | None = None, returning: bool = False) -> list:
        prefer = ["return=representation" if returning else "return=minimal"]
        params = None
        if upsert_on:
            prefer.append("resolution=merge-duplicates")
            params = {"on_conflict": upsert_on}
        _, raw = self._send(
            "POST", f"/rest/v1/{table}", params=params, body=json.dumps(rows).encode(),
            headers={"Content-Type": "application/json", "Prefer": ",".join(prefer)}, what=f"insert into {table}",
        )
        return self._json(raw) if returning else []

    def update(self, table: str, filters: dict, patch: dict) -> list:
        """Updates the rows matching `filters` and returns them, so a conditional update says whether it applied."""
        _, raw = self._send(
            "PATCH", f"/rest/v1/{table}", params=filters, body=json.dumps(patch).encode(),
            headers={"Content-Type": "application/json", "Prefer": "return=representation"}, what=f"update on {table}",
        )
        return self._json(raw)

    # ─── Storage ────────────────────────────────────────────────────────────

    def storage_download(self, bucket: str, path: str) -> bytes | None:
        status, raw = self._send(
            "GET", f"/storage/v1/object/{quote(bucket)}/{quote(path)}", what=f"download from {bucket}", allow_missing=True,
        )
        return None if status in (400, 404) else raw

    def storage_upload(self, bucket: str, path: str, data: bytes, content_type: str = "text/markdown") -> None:
        self._send(
            "POST", f"/storage/v1/object/{quote(bucket)}/{quote(path)}", body=data,
            headers={"Content-Type": content_type, "x-upsert": "true"}, what=f"upload to {bucket}",
        )
