"""Broker symbols to Yahoo tickers, Indian listings only.

The same rules as the app's lib/research/tickers.ts: upper-case, Zerodha's
series suffix dropped (SBIN-BE → SBIN), a six-digit BSE scrip code to .BO,
anything else to .NS. The app already maps before queueing; the worker checks
again because it trusts nothing it reads.
"""

from __future__ import annotations

import re

TICKER = re.compile(r"^[A-Z0-9&-]{1,20}\.(NS|BO)$")
LISTED = re.compile(r"^[A-Z0-9&-]{1,20}$")
BSE_CODE = re.compile(r"^\d{6}$")
SERIES = re.compile(r"-(EQ|BE|BZ|BL|SM|ST|IL|IV|GB|GS)$")


def is_indian(ticker: str) -> bool:
    return isinstance(ticker, str) and bool(TICKER.match(ticker))


def to_yahoo(symbol: str, exchange: str | None = None) -> str | None:
    """RELIANCE → RELIANCE.NS, 500325 → 500325.BO; None for anything that isn't a listed symbol."""
    if not isinstance(symbol, str):
        return None
    text = symbol.strip().upper()
    if text.endswith(".NS") or text.endswith(".BO"):
        exchange = exchange or ("BSE" if text.endswith(".BO") else "NSE")
        text = text[:-3]
    text = SERIES.sub("", text)
    if not LISTED.match(text):
        return None
    on = exchange or ("BSE" if BSE_CODE.match(text) else "NSE")
    ticker = f"{text}.{'BO' if on == 'BSE' else 'NS'}"
    return ticker if is_indian(ticker) else None


def bare_symbol(ticker: str) -> str:
    """RELIANCE.NS → RELIANCE."""
    return ticker.rsplit(".", 1)[0]
