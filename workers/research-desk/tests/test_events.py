from research_desk.decision import parse_decision
from research_desk.events import StateDiffer

DEBATE = {"bull_history": "", "bear_history": "", "history": "", "current_response": "", "count": 0}
RISK = {
    "aggressive_history": "", "conservative_history": "", "neutral_history": "", "history": "", "latest_speaker": "",
    "current_aggressive_response": "", "current_conservative_response": "", "current_neutral_response": "", "count": 0,
}


def states():
    """What stream_run hands back over a run: analysts' reports from their own steps, then full states."""
    yield {"news_report": "Quiet week for the company."}
    yield {"market_report": "Price above the 50-day average."}
    yield {"fundamentals_report": "Debt is falling."}
    full = {"market_report": "Price above the 50-day average.", "news_report": "Quiet week for the company.",
            "fundamentals_report": "Debt is falling.", "investment_debate_state": dict(DEBATE), "risk_debate_state": dict(RISK),
            "investment_plan": "", "trader_investment_plan": "", "final_trade_decision": ""}
    yield dict(full)  # the same reports again in a values chunk: nothing new
    full["investment_debate_state"] = {**DEBATE, "current_response": "Bull Analyst: Margins expand.", "count": 1}
    yield dict(full)
    yield dict(full)  # repeated: nothing new
    full["investment_debate_state"] = {**DEBATE, "current_response": "Bear Analyst: Valuation is rich.", "count": 2}
    yield dict(full)
    # The Research Manager writes its plan into current_response too; that is not a debate turn.
    full["investment_debate_state"] = {**DEBATE, "current_response": "Lean long, size small.", "count": 2}
    full["investment_plan"] = "Lean long, size small."
    yield dict(full)
    full["trader_investment_plan"] = "**Action**: Buy\n\n**Entry Price**: 2900"
    yield dict(full)
    full["risk_debate_state"] = {**RISK, "current_aggressive_response": "Aggressive Analyst: Size up."}
    yield dict(full)
    full["risk_debate_state"] = {**full["risk_debate_state"], "current_conservative_response": "Conservative Analyst: Keep it small."}
    yield dict(full)
    full["risk_debate_state"] = {**full["risk_debate_state"], "current_neutral_response": "Neutral Analyst: Half size."}
    yield dict(full)
    full["final_trade_decision"] = "**Rating**: Overweight"
    yield dict(full)


def test_the_differ_turns_a_run_into_events_once_each_in_order():
    differ = StateDiffer()
    events = [event for state in states() for event in differ.diff(state)]
    assert [(agent, kind) for agent, kind, _ in events] == [
        ("news", "report"), ("market", "report"), ("fundamentals", "report"),
        ("bull", "turn"), ("bear", "turn"),
        ("research_manager", "report"), ("trader", "report"),
        ("risk_aggressive", "turn"), ("risk_conservative", "turn"), ("risk_neutral", "turn"),
        ("portfolio_manager", "decision"),
    ]
    # Speaker prefixes are dropped: the screen names who spoke.
    assert events[3][2] == "Margins expand."
    assert events[7][2] == "Size up."


def test_the_differ_ignores_none_and_partial_states():
    differ = StateDiffer()
    assert differ.diff(None) == []
    assert differ.diff({}) == []
    assert differ.diff({"investment_debate_state": None, "risk_debate_state": "odd"}) == []


def test_a_second_debate_round_with_the_same_words_is_still_a_turn():
    differ = StateDiffer()
    first = differ.diff({"investment_debate_state": {**DEBATE, "current_response": "Bull Analyst: Same.", "count": 1}})
    again = differ.diff({"investment_debate_state": {**DEBATE, "current_response": "Bull Analyst: Same.", "count": 3}})
    assert len(first) == 1 and len(again) == 1


PM = """**Rating**: Overweight

**Executive Summary**: Build the position over two weeks; stop below 2,700.

**Investment Thesis**: Retail and Jio margins keep expanding while debt falls.

**Price Target**: 3100.0

**Time Horizon**: 3-6 months"""

TRADER = """**Action**: Buy

**Reasoning**: Momentum and fundamentals agree.

**Entry Price**: 2900.5

**Stop Loss**: 2700

**Position Sizing**: 5% of portfolio

FINAL TRANSACTION PROPOSAL: **BUY**"""


def test_the_decision_is_read_from_the_upstream_markdown():
    assert parse_decision(PM, TRADER, "Overweight") == {
        "rating": "Overweight",
        "summary": "Build the position over two weeks; stop below 2,700.",
        "thesis": "Retail and Jio margins keep expanding while debt falls.",
        "priceTarget": 3100.0,
        "horizon": "3-6 months",
        "entry": 2900.5,
        "stop": 2700.0,
        "sizing": "5% of portfolio",
        "trader": "Buy",
    }


def test_missing_levels_and_an_unreadable_rating():
    decision = parse_decision(PM.replace("3100.0", "not provided"), "**Action**: Hold\n\n**Entry Price**: not provided", "REVIEW")
    assert decision["rating"] == "REVIEW"
    assert decision["priceTarget"] is None
    assert decision["entry"] is None and decision["stop"] is None and decision["sizing"] is None
    assert decision["trader"] == "Hold"
    # A rating upstream doesn't know is REVIEW, never a guess.
    assert parse_decision("", "", "Strong Buy")["rating"] == "REVIEW"
    assert parse_decision("free text with no labels", "", "Sell")["summary"] is None


def test_prices_with_currency_marks_and_commas_are_read():
    decision = parse_decision("**Rating**: Buy\n\n**Price Target**: ₹3,150.50", "**Stop Loss**: Rs. 2,700", "Buy")
    assert decision["priceTarget"] == 3150.5
    assert decision["stop"] == 2700.0
