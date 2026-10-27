"""Turning TradingAgents' streamed states into the live view's events.

`stream_run` yields the run's state many times over, sometimes a whole state
and sometimes one analyst's finished report. StateDiffer remembers what it has
already passed on and returns only what is new, as (agent, kind, content).
"""

from __future__ import annotations

REPORTS = (("market_report", "market"), ("fundamentals_report", "fundamentals"), ("news_report", "news"))
DEBATE_SPEAKERS = (("Bull Analyst:", "bull"), ("Bear Analyst:", "bear"))
RISK_SPEAKERS = (
    ("current_aggressive_response", "Aggressive Analyst:", "risk_aggressive"),
    ("current_conservative_response", "Conservative Analyst:", "risk_conservative"),
    ("current_neutral_response", "Neutral Analyst:", "risk_neutral"),
)


def _text(value) -> str:
    return value.strip() if isinstance(value, str) else ""


def _strip(text: str, prefix: str) -> str:
    return text[len(prefix):].strip() if text.startswith(prefix) else text


class StateDiffer:
    def __init__(self):
        self._seen: dict[str, object] = {}

    def _new(self, key: str, value) -> bool:
        if not value or self._seen.get(key) == value:
            return False
        self._seen[key] = value
        return True

    def diff(self, state) -> list[tuple[str, str, str]]:
        if not isinstance(state, dict):
            return []
        out: list[tuple[str, str, str]] = []

        for key, agent in REPORTS:
            text = _text(state.get(key))
            if self._new(key, text):
                out.append((agent, "report", text))

        debate = state.get("investment_debate_state")
        if isinstance(debate, dict):
            text = _text(debate.get("current_response"))
            for prefix, agent in DEBATE_SPEAKERS:
                # The turn count tells a repeated argument in a later round from the same state seen twice.
                if text.startswith(prefix) and self._new("debate", (debate.get("count"), text)):
                    out.append((agent, "turn", _strip(text, prefix)))

        plan = _text(state.get("investment_plan"))
        if self._new("investment_plan", plan):
            out.append(("research_manager", "report", plan))

        trade = _text(state.get("trader_investment_plan"))
        if self._new("trader_investment_plan", trade):
            out.append(("trader", "report", trade))

        risk = state.get("risk_debate_state")
        if isinstance(risk, dict):
            for key, prefix, agent in RISK_SPEAKERS:
                text = _text(risk.get(key))
                if self._new(key, text):
                    out.append((agent, "turn", _strip(text, prefix)))

        final = _text(state.get("final_trade_decision"))
        if self._new("final_trade_decision", final):
            out.append(("portfolio_manager", "decision", final))
        return out
