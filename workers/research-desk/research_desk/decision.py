"""The final call as the app stores it, read from upstream's markdown.

The Portfolio Manager's decision and the Trader's proposal are rendered by
TradingAgents with fixed labels (render_pm_decision, render_trader_proposal in
tradingagents/agents/schemas.py); "not provided" means the agent gave none.
"""

from __future__ import annotations

import re

RATINGS = ("Buy", "Overweight", "Hold", "Underweight", "Sell")
TRADER_ACTIONS = ("Buy", "Hold", "Sell")


def _field(text: str, label: str) -> str | None:
    match = re.search(rf"\*\*{re.escape(label)}\*\*:\s*(.+?)(?=\n\s*\n|\n\*\*|\Z)", text or "", re.DOTALL)
    if not match:
        return None
    value = match.group(1).strip()
    return None if not value or value.lower() == "not provided" else value


def _price(text: str, label: str) -> float | None:
    value = _field(text, label)
    if value is None:
        return None
    number = re.search(r"\d[\d,]*(?:\.\d+)?", value)
    if not number:
        return None
    try:
        return float(number.group(0).replace(",", ""))
    except ValueError:
        return None


def parse_decision(final_text: str, trader_text: str, rating: str) -> dict:
    trader = _field(trader_text, "Action")
    return {
        "rating": rating if rating in RATINGS else "REVIEW",
        "summary": _field(final_text, "Executive Summary"),
        "thesis": _field(final_text, "Investment Thesis"),
        "priceTarget": _price(final_text, "Price Target"),
        "horizon": _field(final_text, "Time Horizon"),
        "entry": _price(trader_text, "Entry Price"),
        "stop": _price(trader_text, "Stop Loss"),
        "sizing": _field(trader_text, "Position Sizing"),
        "trader": trader if trader in TRADER_ACTIONS else None,
    }
