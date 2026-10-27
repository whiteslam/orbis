"""TradingAgents set up for an Indian stock, from the run's settings.

- Models through OpenRouter: the deep tier (Research and Portfolio Managers) and
  the quick tier (analysts, debaters, trader) come from the owner's settings.
- Analysts: market, fundamentals and news. The sentiment analyst (`social`)
  reads US forums (StockTwits, Reddit), so it is never used for .NS/.BO.
- News: Orbis's Indian vendor first (NewsData.io and Indian market RSS), then
  Yahoo, so the news analyst isn't blind on Indian listings.
- Fundamentals from Yahoo only: SEC EDGAR files US companies.
- Every decision is scored after 5 trading days against Nifty (.NS) or Sensex (.BO).
"""

from __future__ import annotations

import copy
import os

from research_desk.tickers import is_indian

OPENROUTER_URL = "https://openrouter.ai/api/v1"

INDIA_ANALYSTS = ["market", "fundamentals", "news"]

BENCHMARKS = {".NS": "^NSEI", ".BO": "^BSESN"}

# For Yahoo's global news search, the fallback after the Indian vendor.
INDIA_GLOBAL_NEWS_QUERIES = [
    "RBI repo rate inflation India",
    "Nifty Sensex market outlook",
    "rupee INR dollar exchange rate",
    "FII DII flows Indian equities",
    "India banking IT pharma auto sector news",
]

DEFAULT_DEEP = "anthropic/claude-sonnet-5.5"
DEFAULT_QUICK = "anthropic/claude-haiku-5.5"


def analysts_for(ticker: str) -> list[str]:
    """The analysts a run uses. Only Indian tickers reach the worker, and they never get `social`."""
    if not is_indian(ticker):
        raise ValueError("The Research desk analyses NSE and BSE listings only")
    return list(INDIA_ANALYSTS)


def _rounds(value, default: int = 1) -> int:
    try:
        return max(1, min(3, int(value)))
    except (TypeError, ValueError):
        return default


def build_config(settings: dict, base: dict, home: str) -> dict:
    """TradingAgents' config for one run: upstream's defaults (`base`) with the India setup over them."""
    config = copy.deepcopy(base)
    config.update({
        "llm_provider": "openrouter",
        "backend_url": OPENROUTER_URL,
        "deep_think_provider": None,
        "quick_think_provider": None,
        "deep_think_backend_url": None,
        "quick_think_backend_url": None,
        "deep_think_llm": settings.get("deepModel") or DEFAULT_DEEP,
        "quick_think_llm": settings.get("quickModel") or DEFAULT_QUICK,
        "output_language": "English",
        "max_debate_rounds": _rounds(settings.get("debateRounds")),
        "max_risk_discuss_rounds": _rounds(settings.get("riskRounds")),
        # Rides out OpenRouter's bursty 429s instead of failing the run.
        "llm_max_retries": 4,
        "checkpoint_enabled": False,
        "holding_period_days": 5,
        "benchmark_ticker": None,
        "global_news_queries": list(INDIA_GLOBAL_NEWS_QUERIES),
        "results_dir": os.path.join(home, "results"),
        "data_cache_dir": os.path.join(home, "cache"),
        "memory_log_path": os.path.join(home, "memory", "trading_memory.md"),
    })
    config["benchmark_map"] = {**(base.get("benchmark_map") or {}), **BENCHMARKS}
    config["data_vendors"] = {
        **(base.get("data_vendors") or {}),
        "news_data": "orbis_india,yfinance",
        "fundamental_data": "yfinance",
    }
    config["tool_vendors"] = {
        **(base.get("tool_vendors") or {}),
        # Upstream files insider trades under news; only Yahoo serves them.
        "get_insider_transactions": "yfinance",
    }
    return config
