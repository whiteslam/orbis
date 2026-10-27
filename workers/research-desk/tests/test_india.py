from research_desk.india import BENCHMARKS, INDIA_GLOBAL_NEWS_QUERIES, analysts_for, build_config
from research_desk.tickers import is_indian, to_yahoo

BASE = {
    "llm_provider": "openai",
    "deep_think_llm": "gpt",
    "quick_think_llm": "gpt",
    "data_vendors": {"core_stock_apis": "yfinance", "news_data": "yfinance", "fundamental_data": "sec_edgar,yfinance"},
    "tool_vendors": {},
    "global_news_queries": ["Federal Reserve interest rates inflation"],
    "benchmark_map": {".NS": "^NSEI", ".BO": "^BSESN", "": "SPY"},
    "max_debate_rounds": 1,
}

SETTINGS = {"deepModel": "anthropic/claude-sonnet-5.5", "quickModel": "anthropic/claude-haiku-5.5", "debateRounds": 1, "riskRounds": 1}


def test_ticker_mapping_matches_the_app():
    assert to_yahoo("RELIANCE") == "RELIANCE.NS"
    assert to_yahoo("SBIN-BE") == "SBIN.NS"
    assert to_yahoo("M&M") == "M&M.NS"
    assert to_yahoo("500325") == "500325.BO"
    assert to_yahoo("INFY", "BSE") == "INFY.BO"
    assert to_yahoo("tcs.ns") == "TCS.NS"
    assert to_yahoo("../etc") is None
    assert to_yahoo("A B") is None
    assert to_yahoo("X" * 30) is None
    assert is_indian("RELIANCE.NS") and is_indian("500325.BO")
    assert not is_indian("AAPL") and not is_indian("RELIANCE.NSE")


def test_indian_tickers_never_get_the_sentiment_analyst():
    assert analysts_for("RELIANCE.NS") == ["market", "fundamentals", "news"]
    assert analysts_for("500325.BO") == ["market", "fundamentals", "news"]
    assert "social" not in analysts_for("RELIANCE.NS")


def test_config_uses_openrouter_with_the_settings_models():
    config = build_config(SETTINGS, BASE, home="/tmp/rd")
    assert config["llm_provider"] == "openrouter"
    assert config["deep_think_llm"] == "anthropic/claude-sonnet-5.5"
    assert config["quick_think_llm"] == "anthropic/claude-haiku-5.5"
    assert config["backend_url"] == "https://openrouter.ai/api/v1"
    assert config["output_language"] == "English"
    assert config["llm_max_retries"] == 4
    assert config["checkpoint_enabled"] is False


def test_config_reads_indian_news_first_and_asks_about_india():
    config = build_config(SETTINGS, BASE, home="/tmp/rd")
    assert config["data_vendors"]["news_data"] == "orbis_india,yfinance"
    # Insider trades are in the news category upstream, and only Yahoo has them.
    assert config["tool_vendors"]["get_insider_transactions"] == "yfinance"
    # SEC EDGAR files US companies only.
    assert config["data_vendors"]["fundamental_data"] == "yfinance"
    assert config["global_news_queries"] == INDIA_GLOBAL_NEWS_QUERIES
    assert any("RBI" in query for query in config["global_news_queries"])
    # The input wasn't changed in place.
    assert BASE["data_vendors"]["news_data"] == "yfinance"


def test_config_keeps_its_files_under_the_run_home_and_scores_against_nifty():
    config = build_config(SETTINGS, BASE, home="/tmp/rd")
    assert config["memory_log_path"].replace("\\", "/") == "/tmp/rd/memory/trading_memory.md"
    assert config["results_dir"].replace("\\", "/").startswith("/tmp/rd/")
    assert config["benchmark_map"][".NS"] == "^NSEI" and config["benchmark_map"][".BO"] == "^BSESN"
    assert BENCHMARKS == {".NS": "^NSEI", ".BO": "^BSESN"}
    assert config["holding_period_days"] == 5


def test_rounds_are_clamped():
    config = build_config({**SETTINGS, "debateRounds": 9, "riskRounds": 0}, BASE, home="/tmp/rd")
    assert config["max_debate_rounds"] == 3
    assert config["max_risk_discuss_rounds"] == 1
