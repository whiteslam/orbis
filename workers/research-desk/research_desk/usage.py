"""What a run spends: tokens and dollars per model call, and the per-run cap.

A LangChain callback on both model tiers. Each call is written to
ai_generation_events, the table Settings → AI reads, so the desk's spend shows
there beside everything else. Only counts and the model id are recorded, never
a prompt or a reply. Past the run's token cap it raises TokenCapReached, which
ends the run as failed instead of letting a loop run up the bill.
"""

from __future__ import annotations

import time

try:
    from langchain_core.callbacks import BaseCallbackHandler
except ImportError:  # The tests run without LangChain installed.
    BaseCallbackHandler = object

# US dollars per million input and output tokens, for when OpenRouter's reply
# doesn't carry its own cost. Matched by prefix, so a dated variant still prices.
PRICES_PER_MILLION: dict[str, tuple[float, float]] = {
    "anthropic/claude-sonnet-5.5": (2.0, 10.0),
    "anthropic/claude-haiku-5.5": (0.10, 0.50),
    "anthropic/claude-opus-5.5": (4.0, 20.0),
    "anthropic/claude-sonnet-5": (2.0, 10.0),
    "anthropic/claude-sonnet-4.6": (3.0, 15.0),
    "anthropic/claude-haiku-4.5": (1.0, 5.0),
}


class TokenCapReached(RuntimeError):
    """The run used more tokens than its cap allows."""


def _price(model: str) -> tuple[float, float] | None:
    for prefix in sorted(PRICES_PER_MILLION, key=len, reverse=True):
        if model.startswith(prefix):
            return PRICES_PER_MILLION[prefix]
    return None


def _int(value) -> int:
    try:
        return max(0, int(value))
    except (TypeError, ValueError):
        return 0


def read_usage(response) -> tuple[str, int, int, float | None]:
    """(model, input tokens, output tokens, OpenRouter's own cost or None) from a LangChain LLMResult."""
    output = getattr(response, "llm_output", None) or {}
    usage = output.get("token_usage") or {}
    model = str(output.get("model_name") or "")
    tokens_in, tokens_out = _int(usage.get("prompt_tokens")), _int(usage.get("completion_tokens"))
    cost = usage.get("cost") if isinstance(usage.get("cost"), (int, float)) else None
    if not (tokens_in or tokens_out):
        for generations in getattr(response, "generations", None) or []:
            for generation in generations or []:
                message = getattr(generation, "message", None)
                metadata = getattr(message, "usage_metadata", None) or {}
                tokens_in += _int(metadata.get("input_tokens"))
                tokens_out += _int(metadata.get("output_tokens"))
                response_meta = getattr(message, "response_metadata", None) or {}
                model = model or str(response_meta.get("model_name") or "")
                token_usage = response_meta.get("token_usage") or {}
                if cost is None and isinstance(token_usage.get("cost"), (int, float)):
                    cost = token_usage["cost"]
    return model, tokens_in, tokens_out, cost


class UsageMeter(BaseCallbackHandler):
    # Without this LangChain logs a handler's exception and carries on, and the cap would never bite.
    raise_error = True

    def __init__(self, *, user_id: str, token_cap: int, sink=None, clock=time.monotonic):
        if BaseCallbackHandler is not object:
            super().__init__()
        self.user_id = user_id
        self.token_cap = int(token_cap)
        self.sink = sink
        self.clock = clock
        self.input_tokens = 0
        self.output_tokens = 0
        self.cost_usd = 0.0
        self.priced = True
        self.calls = 0
        self._started: dict[object, float] = {}

    def on_llm_start(self, serialized, prompts, *, run_id=None, **kwargs):
        self._started[run_id] = self.clock()

    def on_chat_model_start(self, serialized, messages, *, run_id=None, **kwargs):
        self._started[run_id] = self.clock()

    def on_llm_end(self, response, *, run_id=None, **kwargs):
        model, tokens_in, tokens_out, cost = read_usage(response)
        if cost is None:
            price = _price(model)
            if price is not None:
                cost = (tokens_in * price[0] + tokens_out * price[1]) / 1_000_000
        if cost is None:
            self.priced = False
        else:
            self.cost_usd += float(cost)
        self.input_tokens += tokens_in
        self.output_tokens += tokens_out
        self.calls += 1
        started = self._started.pop(run_id, None)
        duration = int((self.clock() - started) * 1000) if started is not None else 0
        self._record(model, tokens_in, tokens_out, cost, duration)
        if self.input_tokens + self.output_tokens > self.token_cap:
            raise TokenCapReached("The run went past its token cap")

    def _record(self, model: str, tokens_in: int, tokens_out: int, cost: float | None, duration_ms: int) -> None:
        if not self.sink:
            return
        model_id = (model or "unknown")[:160]
        row = {
            "user_id": self.user_id,
            "feature": "research_desk",
            "model": f"openrouter/{model_id}"[:120],
            "provider_id": "openrouter",
            "model_id": model_id,
            "sensitivity": "personal",
            "attempt": 1,
            "outcome": "succeeded",
            "provider_status": 200,
            "duration_ms": max(0, min(duration_ms, 120000)),
            "response_bytes": 0,
            "input_tokens": tokens_in,
            "output_tokens": tokens_out,
        }
        if cost is not None:
            row["cost_usd"] = round(float(cost), 8)
        try:
            self.sink(row)
        except Exception:  # noqa: BLE001 — bookkeeping never stops a run
            pass

    def totals(self) -> dict:
        return {
            "input_tokens": self.input_tokens,
            "output_tokens": self.output_tokens,
            # None when any call's model had no known price: a partial sum would understate the bill.
            "cost_usd": round(self.cost_usd, 6) if self.priced else None,
        }
