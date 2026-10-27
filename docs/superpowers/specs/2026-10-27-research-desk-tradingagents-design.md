# Research desk: TradingAgents inside Orbis Money

Date: 2026-10-27 · Status: **plan for the owner's review, not approved, nothing built** · Scope: product and architecture for bringing TauricResearch's TradingAgents into Money → Investments.

## Why

The owner wants the TradingAgents "agent" in Orbis's finance section (https://github.com/TauricResearch/TradingAgents). That is a team of AI agents that researches one stock and argues its way to a decision.

Orbis already shows the owner's real holdings (read-only Zerodha and Groww), prices, portfolio advice and portfolio news. What it can't do is take one holding and give it a deep, multi-angle analysis that ends in a clear call and its reasons.

## What TradingAgents is (v0.7.1, Apache-2.0, researched 2026-10-27)

- **Analysts** run in parallel, each with its own data tools:
  - **Market/technical:** yfinance prices and StockStats indicators.
  - **Fundamentals:** statements and insider trades.
  - **News:** ticker, global and macro news.
  - **Sentiment:** StockTwits and Reddit.
- **Bull vs Bear researchers** debate the analysts' reports. A **Research Manager** turns the debate into a plan with a rating.
- **Trader** proposes Buy/Hold/Sell with an entry price, a stop loss and position sizing.
- **Risk team** (aggressive, conservative, neutral) debates the trade.
- **Portfolio Manager** makes the final call: Buy, Overweight, Hold, Underweight or Sell, with a thesis, a price target and a time horizon. It works against the owner's actual positions when given a portfolio context.
- **Memory:** every decision is settled after 5 days against a benchmark (`.NS` against Nifty, `.BO` against Sensex), and an AI reflection on how it went is fed into later runs.
- **Backtest** over tickers and dates. It has **no** order execution or paper trading, by design.
- **Cost and time:** about 15–25 AI calls and roughly 150–300k input tokens per run, taking **3–10 minutes**. It is non-deterministic.
- **Disclaimer:** it is a research tool, "not financial, investment, or trading advice".

**Fit for Indian stocks (verified from the code):**
- **Works:** prices, indicators and the benchmark.
- **Weak:** fundamentals, which come from Yahoo with gaps.
- **Mostly blind:** ticker news (Yahoo tags few Indian listings) and sentiment (US forums).
- **Not supported:** mutual funds. They are a large part of most Groww portfolios.

## The proposal

### What the owner gets

**A Research desk in Money → Investments.** On any stock or ETF holding, and on any NSE/BSE ticker the owner types, there is **Deep analysis**. Pressing it starts a run, and the page shows the team working live:

- the analyst reports, as they finish;
- the Bull vs Bear debate, as a conversation;
- the trader's proposal;
- the risk debate;
- the **final call**: a rating chip, the thesis, a price target and horizon, the entry and stop, and what it means for the owner's current position.

Each call is then settled automatically against Nifty after the holding period. A **track record** card shows how past calls did ("last 12 calls: 7 beat Nifty, average alpha +1.4%"), so the owner can judge the tool on evidence, not on how confident it sounds.

Optionally, there is a **weekly desk run**: the top N stock holdings are analysed every weekend, and a summary heads-up arrives on Monday.

It also gets a web-panel page in the same style as the Career panel. There, the run is laid out as a timeline of the agents, with the debate side by side.

### Architecture (recommended: a Python worker, not a rewrite)

TradingAgents is Python and LangGraph, and its value is in the data layer and the look-ahead fixes, which it keeps improving (9 releases since February).

- **Not a TypeScript port:** that would take 2–3 weeks and we would lose upstream fixes.
- **Not on Vercel:** a run needs 3–10 minutes, and Vercel functions here stop at 60 s.

So Orbis queues the work and a small Python worker runs it.

```
Orbis (Vercel)                         Supabase                        Worker (Python, TradingAgents pinned)
Deep analysis ─► server action ─► research_runs row (queued) ──► dispatch ──► runs the graph with Orbis's config
                                   research_events (progress) ◄── writes each agent's output as it finishes
UI polls / Realtime ◄─────────────  research_runs (decision)  ◄── final decision, cost, tokens
pg_cron weekly ─► queue runs       research_memory (per user) ◄─► settlement + reflections persisted
```

- **Worker host** (the owner's choice, see Decisions):
  - **(a) GitHub Actions** in a private `orbis-research-worker` repo, started by `repository_dispatch`. It costs nothing up to the free minutes (2,000/month on a private repo, about 200–400 runs), the owner already uses GitHub, and it has a 6-hour job limit.
  - **(b) Modal** (serverless Python, pay per second; a run costs pennies of compute). It starts faster and suits on-demand use.
  - Both use the upstream Dockerfile or `pip install` pinned to v0.7.1.
- **The worker writes only through the service role** into the research tables. It never sees broker tokens: Orbis sends the portfolio context (ticker, quantity, average price, cash, INR) inside the job row.
- **India setup:**
  - Tickers get `.NS` (or `.BO`), mapped from the Zerodha and Groww symbols.
  - Analysts: `market`, `fundamentals`, `news`. `social` is off for Indian tickers, because it reads US forums.
  - `global_news_queries` cover the RBI, Nifty, the INR and Indian sector news.
  - A small custom news vendor feeds Indian headlines from the NewsData.io source Orbis already uses for portfolio news, and from public Indian RSS feeds (Moneycontrol, ET Markets, Mint), so the news analyst isn't blind.
  - Mutual funds are out of scope and clearly labelled "not supported for funds".
- **Models:** through OpenRouter, the key Orbis already has. The deep tier (Research Manager, Portfolio Manager) uses a Claude Sonnet/Opus-class model and the quick tier (analysts, debaters, trader) uses a Haiku-class model.
  - **Cost:** roughly $0.30–1.50 per run with these choices, to be checked on the first real runs.
  - **Logging:** the worker writes every call's tokens and cost to `ai_generation_events`, so Settings → AI shows the spend.
  - **Cap:** a per-run token cap and a monthly run cap (both settings) stop runaway loops, since the owner lifted the general AI budget.
- **Memory:** TradingAgents' markdown memory log is stored per user in Supabase Storage, downloaded at the start of a run and uploaded at the end, so settlements and reflections survive between runs.

### Data

| Table | Purpose |
|---|---|
| `research_runs` | `ticker`, `exchange`, `trade_date`, `status` (`queued`/`running`/`done`/`failed`/`cancelled`), `portfolio_context jsonb`, `config jsonb` (models, analysts, rounds), `decision jsonb` (rating, thesis, price target, horizon, entry, stop, sizing), `cost_usd`, `tokens`, `started_at`, `finished_at`, `error`. |
| `research_events` | Run id, `agent` (market, fundamentals, news, bull, bear, research_manager, trader, risk_aggressive, risk_conservative, risk_neutral, portfolio_manager), `kind` (report/turn/decision), `content`, `at`. Drives the live view. |
| `research_settlements` | Run id, `settled_at`, `return_pct`, `benchmark_pct`, `alpha_pct`, `reflection`. Drives the track record. |
| `research_settings` | One row per user: on/off, weekly run, top-N, models, per-run token cap, monthly run cap. |

All tables follow the same conventions as Career (RLS, owner reads, service-role writes, export and deletion coverage).

### Guardrails

- **Owner-only by default.** The feature is behind an allowlist flag holding the owner's email (see Decisions for why).
- **Never connected to trading.** The broker integrations stay read-only (`lib/invest/zerodha.ts` already says "Never add order endpoints here"). Nothing places, stages or suggests an order inside a broker.
- **Labelled as research.** Every decision carries "Research output from AI agents, not investment advice. It can be wrong and it isn't repeatable run to run." The track record is shown right beside it.
- **No backtest performance claims** on any page another person could see.
- The existing portfolio-advice prompt ("never tell the user to buy or sell a named security") stays as it is for that feature. The Research desk is a separate, owner-only, opt-in feature.

## Decisions the owner needs to make

1. **Only you, or your waitlist users too?**
   - Security-specific Buy/Sell calls with targets and stop losses, given to *other* people, very likely count as research-analyst or investment-adviser activity under SEBI rules and would need registration.
   - For your own use, no registration is needed.
   - **Recommendation: you only.** (Not legal advice. Confirm with a professional before opening it to anyone.)
2. **Where the worker runs:** GitHub Actions (free, slower to start) or Modal (pay per use, faster). **Recommendation: GitHub Actions to start.** That needs a private repo, a fine-grained token for Orbis to dispatch runs, and the OpenRouter and Supabase service keys as repo secrets.
3. **Models and cost:** Claude Sonnet-class for deep thinking and Haiku-class for the rest (about $0.30–1.50 a run), or all-Opus for the best reasoning (a few dollars a run).
4. **Weekly desk run:** on or off, and how many holdings.
5. **Sentiment for Indian stocks:** leave it off (recommended, since the sources are US forums), or add r/IndianStreetBets and r/IndiaInvestments through Reddit RSS (noisy).

## Phases

1. **Worker + one run.** Repo, pinned TradingAgents, India config, Indian news vendor, Supabase writer, dispatch from Orbis, a minimal result card in Money → Investments.
2. **Live view.** `research_events` streaming, the debate laid out as a conversation, the final-call card, cancelling a run.
3. **Memory and track record.** Persisted memory, settlement, reflections, the track-record card and alpha against Nifty.
4. **Web panel page and weekly runs.** Panel page in the Career panel's style, a weekly pg_cron run, a Monday heads-up.
5. **Hardening.** Cost logging into Settings → AI, run and token caps, failure retries, an e2e test with a mocked worker.

## Risks

- **Indian data is thin,** so the debate rests mostly on price and indicators while still sounding confident. This is why there's a visible track record and a clear label.
- **Non-determinism:** the same stock on the same day can get a different call. The UI says so, and a past run is never presented as "the answer".
- **yfinance** relies on Yahoo's unofficial endpoints. That is acceptable for personal use, but its data must not be redistributed to other users.
- **Upstream moves fast:** pin the version and upgrade on purpose, with a smoke run.
