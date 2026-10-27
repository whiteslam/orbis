# Research desk Implementation Plan

## Resume here (checkpoint 2026-10-27)

**Done (Tasks 1-10, most of 12 and 13):** the migration, owner allowlist, ticker mapping, dispatch and queue, server
actions, the Investments section, the live run view with Cancel and Try again, the `/active/research` panel with
settings, and the whole Python worker (Supabase writer, India config, Indian news vendor, event differ, decision
parser, usage meter with token cap and `ai_generation_events` rows, memory log download/merge/upload, settlement
sync, `run`/`settle` CLI) plus the private repo's workflow. `.env.example` documents the five new env vars.

**Production-safe as committed:** nothing appears and no research table is queried unless BOTH
`ORBIS_RESEARCH_DESK_EMAILS` lists the signed-in owner AND `ORBIS_RESEARCH_GITHUB_TOKEN` + `ORBIS_RESEARCH_GITHUB_REPO`
are set (`researchDeskAvailable` in `lib/research/access.ts`, used by every action and by the panel page, which
404s otherwise). The Investments section renders nothing while loading, when not available, or when loading fails.

**Next task: Task 11 (weekly run and Monday heads-up).** Then Task 12's `lib/research/flow.test.ts` and Task 13's
export/deletion coverage. Nothing is half-done or known broken; `pnpm typecheck`, `pnpm lint` (4 pre-existing
warnings, none in research code), `pnpm test` (823 passed), `pnpm build` and the worker's pytest (51 passed) pass.

**Not yet verified (needs a real run):** OpenRouter accepting `anthropic/claude-sonnet-5.5` and
`anthropic/claude-haiku-5.5`; `UpstreamGraph` against TradingAgents v0.7.1 (`create_run_state`, `stream_run`,
`record_decision`, `settle_all_pending`, `memory_log.load_entries`); `_pin_openrouter` setting `extra_body`
(data collection denied, usage cost included) on the tier clients; the three RSS feed URLs in
`research_desk/news.py`; NewsData's `q` search; the panel and section layout in a browser.

**Python on a fresh machine:**
```
cd workers/research-desk
python -m venv .venv            # Python 3.11+; the workflow uses 3.13
.venv/Scripts/python -m pip install pytest      # Windows; .venv/bin/python elsewhere
.venv/Scripts/python -m pytest  # the tests need neither TradingAgents nor network
```
To run the worker for real: `pip install -r requirements.txt` (TradingAgents pinned to commit
`3e44faafa042daf953f6ec2422ae36bb1fd4f50f` = v0.7.1), set `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
`OPENROUTER_API_KEY` (optional `NEWSDATA_API_KEY`), then `python -m research_desk run --run-ids <uuid>`.

---

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Owner-only "Deep analysis" in Money → Investments: Orbis queues a TradingAgents v0.7.1 run, a Python worker on a private GitHub Actions repo runs it with an India setup, writes progress and the final call into Supabase, and Orbis shows the run live, the final call with its label, and a track record against Nifty.

**Architecture:** The app only queues and reads (Vercel's 60 s cap). A server action checks the owner allowlist, inserts a `research_runs` row with the service role and starts the private repo's workflow with `workflow_dispatch`. The worker (`workers/research-desk/`, plain Python, stdlib HTTP) claims the row, runs the graph with `stream_run`, turns state changes into `research_events`, writes the decision, token use and cost, syncs settlements from TradingAgents' memory log (kept per user in Supabase Storage) into `research_settlements`, and logs each model call to `ai_generation_events`. The Investments card and the `/active/research` panel poll the run.

**Tech Stack:** Next.js 16 server actions and route handlers, React 19, plain CSS, Supabase (Postgres RLS, Storage, pg_cron), GitHub Actions `workflow_dispatch`, Python 3.13, TradingAgents v0.7.1 (commit `3e44faafa042daf953f6ec2422ae36bb1fd4f50f`), OpenRouter, vitest, pytest.

**Spec:** `docs/superpowers/specs/2026-10-27-research-desk-tradingagents-design.md` (the "Decisions (made 2026-10-27)" section is binding).

## Global Constraints

- Owner only: every action, route and page refuses unless the signed-in email is in `ORBIS_RESEARCH_DESK_EMAILS`. Empty list = nobody (fails closed).
- Never connected to trading: no broker call is added; `lib/invest/*` is read only, for holdings.
- Every decision carries, verbatim: "Research output from AI agents, not investment advice. It can be wrong and it isn't repeatable run to run." with the track record beside it.
- No backtest performance claims on any page.
- Models through OpenRouter, ids in the repo's dotted style: deep `anthropic/claude-sonnet-5.5`, quick `anthropic/claude-haiku-5.5` (settings can change them).
- `.NS`/`.BO` only; analysts `market`, `fundamentals`, `news`; `social` never for `.NS`/`.BO`; mutual funds labelled "Not supported for funds".
- Tables follow Career's conventions: RLS on, owner `select` only, every write by `service_role`, export and deletion coverage.
- Worker logs never print portfolio values, positions, prices, ratings or decision text: only run ids, stage names and exception types.
- Weekly desk run exists behind `research_settings.weekly_enabled`, default `false`.
- The app repo is public: the workflow that holds secrets lives only in the private repo; this repo carries its file under `workers/research-desk/private-repo/`.
- New env vars go in `.env.example` with comments.

## Review Focus

- A broker symbol with a series suffix (`SBIN-BE`), an `&` (`M&M`), a BSE scrip code (`500325`) or a typed `NSE:`/`BSE:` prefix maps to the right Yahoo ticker; junk input (`../x`, lowercase with spaces, 30 chars) is refused. Tests in Task 2 and Task 6.
- A dispatch that GitHub refuses (no token, 401, 404, network) leaves the run `failed` with a readable reason, not `queued` forever; a run queued but never claimed for 45 minutes reads as failed. Tests in Task 3.
- A cancelled run stops at the worker's next event and is never overwritten to `done`. Tests in Task 7 and Task 3.
- The monthly run cap and one-active-run-per-ticker rule refuse a second press instead of spending money. Tests in Task 3.
- News feeds returning HTML error pages, empty bodies or articles outside the window give the analyst an explicit "unavailable" line, never an exception that ends the run. Tests in Task 6.

---

## File Structure

TypeScript (app):
- `lib/research/types.ts` – statuses, agents, event kinds, `ResearchRun`, `ResearchEvent`, `ResearchSettlement`, `ResearchSettings`, `DEFAULT_RESEARCH_SETTINGS`, `RESEARCH_DISCLAIMER`.
- `lib/research/access.ts` – `researchDeskEmails()`, `researchDeskAllowed(email)`.
- `lib/research/tickers.ts` – `researchTarget(holding)`, `parseTypedTicker(text)`, `isResearchTicker(t)`.
- `lib/research/context.ts` – `portfolioContextFor(analysisPositions, holdings, ticker)`, `deskHoldings(brokers)`.
- `lib/research/rows.ts` – shape checks `readRun`, `readEvent`, `readSettlement`, `readSettings`; `effectiveStatus(run, now)`.
- `lib/research/track.ts` – `trackRecord(settlements)`.
- `lib/research/dispatch.ts` – `dispatchConfig(env)`, `dispatchRuns(input, deps)`.
- `lib/research/queue.ts` – `queueRun(deps, input)`, `cancelRun(deps, input)`.
- `lib/research/weekly.ts` – `weeklyPicks(holdings, n)`, `weeklyHeadsup(runs, mondayIso)`.
- `lib/research/repository.ts` (server-only) – Supabase reads/writes used by actions and the cron.
- `app/research/actions.ts` – `loadResearchDeskAction`, `startResearchAction`, `loadResearchRunAction`, `cancelResearchRunAction`, `saveResearchSettingsAction`.
- `app/api/research/weekly/route.ts` – pg_cron entry (`?step=queue|summary`).
- `app/(orbis)/active/research/page.tsx` – panel page behind `appGate()` and the allowlist.
- `components/research/*` – `research-desk.tsx` (Investments card), `run-view.tsx`, `decision-card.tsx`, `track-record.tsx`, `use-research.ts`, `panel/research-panel.tsx`.
- `app/styles/research.css` – `.rd-` classes; panel reuses `.cp-` from career-panel.css.
- Modified: `components/money/invest-dashboard.tsx`, `lib/headsups/types.ts`, `components/app-shell.tsx`, `lib/account/deletion-plan.ts` (+test), `app/api/account/export/route.ts`, `lib/security/rate-limit-rules.ts`, `app/(orbis)/layout.tsx`, `.env.example`.
- `supabase/migrations/202610270003_research_desk.sql`, `supabase/cron/research_schedule.sql`.

Python (worker, `workers/research-desk/`):
- `requirements.txt` (TradingAgents pinned by commit), `pyproject.toml` (pytest config).
- `research_desk/tickers.py`, `india.py`, `news.py`, `supabase.py`, `writer.py`, `events.py`, `decision.py`, `usage.py`, `memory.py`, `run.py`, `safe_log.py`, `__main__.py`.
- `tests/test_*.py` – fakes only; never the real LLM or network.
- `private-repo/.github/workflows/research-desk.yml`.

---

## Phase 1: Worker + one run

### Task 1: Migration and types

**Files:** Create `supabase/migrations/202610270003_research_desk.sql`, `lib/research/types.ts`, `lib/research/rows.ts`, `lib/research/rows.test.ts`.

**Interfaces – Produces:**
- `RUN_STATUSES = ['queued','running','done','failed','cancelled']`, `AGENTS = ['desk','market','fundamentals','news','bull','bear','research_manager','trader','risk_aggressive','risk_conservative','risk_neutral','portfolio_manager']`, `EVENT_KINDS = ['status','report','turn','decision']`, `RATINGS = ['Buy','Overweight','Hold','Underweight','Sell']`.
- `type ResearchDecision = { rating: Rating | 'REVIEW'; summary: string|null; thesis: string|null; priceTarget: number|null; horizon: string|null; entry: number|null; stop: number|null; sizing: string|null; trader: 'Buy'|'Hold'|'Sell'|null }`.
- `readRun(row): ResearchRun | null`, `readEvent`, `readSettlement`, `readSettings(row|null): ResearchSettings` (merges over defaults), `effectiveStatus(run, now): RunStatus` (queued > 45 min without `started_at`, or running > 120 min → `failed`).

Tables: `research_runs` (id, user_id, ticker, symbol, exchange, trade_date, source `manual|weekly`, status, portfolio_context, config, decision, cost_usd, input_tokens, output_tokens, tokens, error, dispatched_at, started_at, finished_at, created_at, updated_at, unique(user_id,id)); `research_events` (bigint id, user_id, run_id, seq, agent, kind, content ≤ 60000, at; unique(run_id, seq); FK (user_id, run_id) cascade); `research_settlements` (id, user_id, run_id unique, ticker, trade_date, benchmark, holding_days, return_pct, benchmark_pct, alpha_pct, reflection, settled_at); `research_settings` (user_id pk, enabled default true, weekly_enabled default false, weekly_top_n default 5 between 1 and 15, deep_model, quick_model, run_token_cap default 600000, monthly_run_cap default 40, updated_at). All: RLS, `grant select … to authenticated` with an owner policy, `grant select, insert, update, delete … to service_role`. Private Storage bucket `research-memory` (text/markdown, text/plain, 5 MB), service role only.

- [x] Write `rows.test.ts`: a row with a bad status is dropped; `decision` with an unknown rating reads as null; `readSettings(null)` equals defaults; `effectiveStatus` turns a 46-minute-old unclaimed queued run into `failed` and leaves a 10-minute one `queued`.
- [x] Run `pnpm test lib/research/rows.test.ts` → FAIL; implement; → PASS. Commit.

### Task 2: Allowlist and ticker mapping

**Files:** `lib/research/access.ts`, `lib/research/tickers.ts`, tests beside them.

- `researchDeskAllowed(email: string|null|undefined): boolean` – env `ORBIS_RESEARCH_DESK_EMAILS`, comma/space separated, lower-cased; empty → false.
- `researchTarget({ symbol, isin, assetClass }): { ok: true; ticker; exchange: 'NSE'|'BSE'; symbol } | { ok: false; reason: 'fund'|'unsupported' }`.
- `parseTypedTicker(text): same union` (accepts `RELIANCE`, `reliance.ns`, `NSE:RELIANCE`, `BSE:500325`, `500325`).
- Rules: upper-case; strip a Zerodha series suffix `-(EQ|BE|BZ|BL|SM|ST|IL|IV|GB|GS)`; six digits → `.BO`; else `.NS`; result must match `^[A-Z0-9&-]{1,20}\.(NS|BO)$`; `assetClass === 'Mutual funds'`, or an `INF` ISIN whose symbol is not exchange-shaped → `fund`.
- [x] Tests: `SBIN-BE`→`SBIN.NS`; `M&M`→`M&M.NS`; `BAJAJ-AUTO`→`BAJAJ-AUTO.NS`; `500325`→`500325.BO`; `NSE:INFY`→`INFY.NS`; `GOLDBEES` (ETF) ok; Mutual funds → fund; `../x`, `a b`, 30 chars → unsupported. Allowlist: empty denies, case-insensitive match. FAIL → implement → PASS. Commit.

### Task 3: Dispatch and queue

**Files:** `lib/research/dispatch.ts`, `lib/research/queue.ts`, `lib/research/context.ts`, tests.

- `dispatchConfig(env = process.env): { token; repo; workflow; ref } | null` from `ORBIS_RESEARCH_GITHUB_TOKEN`, `ORBIS_RESEARCH_GITHUB_REPO` (`owner/name`), `ORBIS_RESEARCH_WORKFLOW` (default `research-desk.yml`), `ORBIS_RESEARCH_GITHUB_REF` (default `main`).
- `dispatchRuns({ runIds, mode: 'run'|'settle', userId? }, { config, fetch }): Promise<{ ok: true } | { ok: false; reason: 'not_configured'|'rejected'|'unreachable' }>` – `POST https://api.github.com/repos/{repo}/actions/workflows/{workflow}/dispatches`, headers `Authorization: Bearer`, `Accept: application/vnd.github+json`, `X-GitHub-Api-Version: 2022-11-28`, body `{ ref, inputs: { mode, run_ids: ids.join(','), user_id } }`; 204/200 ok; one retry on 5xx/network.
- `queueRun(deps: { db: QueueDb; dispatch }, input: { userId; target; context; settings; source; today }): Promise<{ ok: true; runId } | { ok: false; message }>` – refuses when `settings.enabled` is false, when the month's runs ≥ `monthly_run_cap`, or when the ticker already has a queued/running run; inserts, dispatches, on failure marks the row `failed` with the reason.
- `cancelRun(deps, { userId, runId })` – only `queued|running` → `cancelled` (conditional update).
- `portfolioContextFor(holdings, ticker)` → `{ currency: 'INR', cash: null, positions: [{ ticker, quantity, average_price }] }` over supported holdings only.
- [x] Tests with a fake `QueueDb` and fake `fetch`: happy path dispatches once with the run id; 401 → run marked failed, message "The research worker couldn't be started…"; not configured → no insert at all; cap reached → refused, no insert; duplicate active ticker → refused; cancel of a `done` run → refused. FAIL → implement → PASS. Commit.

### Task 4: Repository, actions and the minimal card

**Files:** `lib/research/repository.ts`, `app/research/actions.ts`, `components/research/research-desk.tsx`, `components/research/decision-card.tsx`, `app/styles/research.css`, modify `components/money/invest-dashboard.tsx`, `app/(orbis)/layout.tsx`, `lib/security/rate-limit-rules.ts` (bucket `research_run`: 12 per hour).

- `loadResearchDeskAction(): Promise<Result<ResearchDesk | null>>` – null when not allowlisted (the card renders nothing). `ResearchDesk = { holdings: DeskHolding[]; runs: ResearchRun[]; settlements: ResearchSettlement[]; settings: ResearchSettings; configured: boolean; monthUsed: number }`.
- `startResearchAction(input: { holdingKey?: string; ticker?: string }): Promise<Result<{ runId }>>` – allowlist, rate limit, mapping, live holdings for context, `queueRun`.
- Card: one row per stock/ETF holding with **Deep analysis**, funds shown with "Not supported for funds", a typed-ticker field, the latest runs with status, the decision card for a finished run.
- [x] `pnpm typecheck && pnpm lint` pass. Commit.

### Task 5: Worker skeleton: Supabase REST, writer, safe logging

**Files:** `workers/research-desk/research_desk/supabase.py`, `writer.py`, `safe_log.py`, `tests/test_writer.py`, `tests/fakes.py`, `requirements.txt`, `pyproject.toml`.

- `SupabaseRest(url, key, opener=urllib.request.urlopen)` with `select(table, params)`, `insert(table, rows)`, `update(table, params, patch, returning)`, `storage_download(bucket, path) -> bytes|None`, `storage_upload(bucket, path, data, content_type)`; `apikey` header always, `Authorization: Bearer` only for a JWT-shaped key.
- `RunWriter(db, run)` – `claim() -> bool` (conditional `queued → running`), `emit(agent, kind, content)` (seq increments, content trimmed to 60000), `cancelled() -> bool`, `finish(decision, usage)` (conditional on `status=running`), `fail(message)`.
- [x] Tests with a recording fake: claim sends `status=eq.queued`; emit numbers events 1, 2, 3; finish never overwrites a cancelled run; a JWT key sends Authorization, an `sb_secret_` key doesn't; `safe_log` refuses to format anything but ids, stage names and exception class names. FAIL → implement → PASS. Commit.

### Task 6: India config, tickers and the news vendor

**Files:** `research_desk/tickers.py`, `india.py`, `news.py`, tests.

- `to_yahoo(symbol, exchange=None) -> str|None` mirrors Task 2. `is_indian(ticker) -> bool`.
- `analysts_for(ticker) -> list[str]` → `['market','fundamentals','news']` for `.NS/.BO`.
- `build_config(settings: dict, base: dict, home: str) -> dict` – `llm_provider='openrouter'`, models from settings, `max_debate_rounds=1`, `max_risk_discuss_rounds=1`, `llm_max_retries=4`, `output_language='English'`, `data_vendors.news_data='orbis_india,yfinance'`, `tool_vendors.get_insider_transactions='yfinance'`, `macro_data` left (optional), India `global_news_queries` (RBI repo rate inflation; Nifty Sensex market outlook; rupee INR dollar; FII DII flows India; Indian banking IT pharma auto sector), memory/results/cache paths under `home`.
- `news.py`: `parse_newsdata(payload) -> list[Article]`, `parse_rss(xml_bytes, source) -> list[Article]`, `in_window(...)`, `get_news_india(ticker, start_date, end_date, *, fetch=...) -> str`, `get_global_news_india(as_of_date, look_back_days=None, limit=None, *, fetch=...) -> str`, `register()` adds `orbis_india` to the router's `VENDOR_METHODS['get_news']` and `['get_global_news']`. RSS feeds: Moneycontrol business, ET Markets, Mint markets. Company match on the bare symbol and the instrument's name when known. Errors raise `VendorUnavailableError` (so `yfinance` is tried next); nothing in window returns an explicit "no Indian headlines found" line.
- [x] Tests: NewsData sample parses title/source/date and drops items without a link; RSS with an HTML error page returns `[]`; out-of-window items excluded; config has no `social` and the news chain starts with `orbis_india`. FAIL → implement → PASS. Commit.

### Task 7: The run: events, decision, orchestration, workflow (done; also `merge_logs` so parallel jobs don't overwrite the memory log, and no concurrency group in the workflow)

**Files:** `research_desk/events.py`, `decision.py`, `run.py`, `__main__.py`, `private-repo/.github/workflows/research-desk.yml`, tests.

- `StateDiffer().diff(state: dict) -> list[tuple[agent, kind, content]]` – reports when `market_report`/`fundamentals_report`/`news_report` first appear; each new `investment_debate_state.current_response` (prefix `Bull Analyst:` → `bull`, `Bear Analyst:` → `bear`, prefix stripped); `investment_plan` → `research_manager` report; `trader_investment_plan` → `trader` report; each new `risk_debate_state.current_{aggressive,conservative,neutral}_response` → turn; `final_trade_decision` → `portfolio_manager` decision.
- `parse_decision(final_text, trader_text, rating) -> ResearchDecision dict` reading `**Rating**`, `**Executive Summary**`, `**Investment Thesis**`, `**Price Target**`, `**Time Horizon**`, trader `**Action**`, `**Entry Price**`, `**Stop Loss**`, `**Position Sizing**`; "not provided" → None.
- `run_one(run_row, deps)` – claim, settings, memory download, `TradingAgentsGraph(analysts_for(t), config, callbacks=[usage])`, `create_run_state` + `stream_run`, emit diffs, check `cancelled()` after each step (raise `Cancelled`), `record_decision`, finish, memory upload, settlement sync. `main(argv)` – `run --run-ids a,b` and `settle --user-id u`.
- Workflow: `workflow_dispatch` inputs `mode`, `run_ids`, `user_id`; checks out `whiteslam/orbis` at `vars.ORBIS_WORKER_REF` (must be a 40-char SHA) with sparse checkout of `workers/research-desk`; Python 3.13; `pip install -r requirements.txt`; runs `python -m research_desk "$MODE" …` with inputs passed through `env`, never interpolated into the script; `concurrency: research-desk`; `timeout-minutes: 120`; `permissions: contents: read`.
- [x] Tests: differ on a scripted sequence of states yields market, bull, bear, research_manager, trader, three risk turns, decision in that order with no repeats; parse_decision on the upstream markdown shape; `run_one` with a fake graph and a writer whose `cancelled()` flips true mid-run ends `cancelled` and never calls finish; invalid run ids are rejected before any network. FAIL → implement → PASS. Commit.

## Phase 2: Live view

### Task 8: Run view, polling and cancel

**Files:** `components/research/run-view.tsx`, `components/research/use-research.ts`, `lib/research/view.ts` (+test).
- `loadResearchRunAction(runId, afterSeq)` → `{ run, events (seq > afterSeq), settlement }`; `cancelResearchRunAction(runId)`.
- `groupEvents(events) -> { reports; debate; trader; risk; decision }` (pure, tested): debate turns in order alternating bull/bear, risk turns tagged by stance.
- `useResearchRun(runId)` polls every 4 s while `queued|running`, appends events, stops on a final status.
- View: analyst reports as collapsible sections as they finish, the debate as a conversation, trader proposal, risk debate, final-call card (rating chip, thesis, target, horizon, entry, stop, what it means for the current position), Cancel while active.
- [x] Test `groupEvents`; typecheck, lint. Commit.

## Phase 3: Memory and track record

### Task 9: Memory persistence and settlement sync

**Files:** `research_desk/memory.py`, tests; `lib/research/track.ts` (+test), `components/research/track-record.tsx`.
- `memory_path(user_id) -> f"{user_id}/trading_memory.md"`; `download_memory`, `upload_memory`.
- `settlements_from_entries(entries, runs) -> list[dict]` – resolved entries (`raw`, `alpha` strings like `+1.2%`) matched to `done` runs by `(ticker, trade_date)`; `benchmark_pct = raw - alpha`; benchmark `^NSEI` for `.NS`, `^BSESN` for `.BO`; skips already-settled runs.
- `trackRecord(settlements) -> { count; beat; averageAlpha; lastN }` over the last 12, newest first.
- Card copy: "Last 12 calls: 7 beat Nifty, average alpha +1.4%." beside every decision.
- [x] Python tests for the mapping (percent parsing, unmatched entries ignored, BSE uses Sensex); vitest for `trackRecord` (empty → count 0; average to one decimal). Commit.

## Phase 4: Panel page and weekly runs

### Task 10: `/active/research` panel

**Files:** `app/(orbis)/active/research/page.tsx`, `components/research/panel/research-panel.tsx`, styles.
- Same door as Career (`appGate()`), then `researchDeskAllowed(gate.email)` else `notFound()`; `robots: noindex`.
- Layout in the Career panel's style (`cp-panel`, `cp-wall`, `cp-frame`, `PanelCard`): left column runs list + track record, main column the selected run as an agent timeline with the bull/bear debate side by side on wide screens; settings card (weekly on/off, top-N, models, caps).
- `saveResearchSettingsAction(patch)` validates every field.
- [x] typecheck, lint. Commit.

### Task 11: Weekly run and Monday heads-up (OPEN, next)

**Files:** `lib/research/weekly.ts` (+test), `app/api/research/weekly/route.ts`, `supabase/cron/research_schedule.sql`, modify `lib/headsups/types.ts`, `components/app-shell.tsx`.
- `weeklyPicks(holdings, n)` – supported stock/ETF holdings by value, top n.
- `weeklyHeadsup(runs, weekOf)` → `{ kind: 'money.research_week', dedupeKey: 'research-week:<weekOf>', title, body, action: { type: 'open_research' } }` or null when no weekly runs finished.
- Route `POST /api/research/weekly?step=queue` (Saturday 09:00 IST): for each enabled, allowlisted person: dispatch `settle` when unsettled done runs are older than 8 days; when `weekly_enabled`, queue `weeklyPicks` within the cap and dispatch them in one workflow run. `?step=summary` (Monday 08:00 IST) raises the heads-up.
- [ ] Tests for picks and heads-up wording; typecheck. Commit.

## Phase 5: Hardening

### Task 12: Cost logging, caps, retries, mocked end-to-end (usage meter, caps and retries done; flow test open)

**Files:** `research_desk/usage.py` (+test), `lib/research/flow.test.ts`.
- `UsageMeter(prices, token_cap, sink)` – LangChain callback (`on_llm_end`): adds prompt/completion tokens, cost from OpenRouter's `usage.cost` when present else from the per-model price table (Sonnet 5.5 $2/$10, Haiku 5.5 $0.10/$0.50 per million), writes one `ai_generation_events` row per call (`feature='research_desk'`, `provider_id='openrouter'`, `sensitivity='personal'`, `outcome='succeeded'`), raises `TokenCapReached` past `run_token_cap`.
- Retries: `llm_max_retries=4` in config; dispatch retries once (Task 3); failed runs show **Try again**, which queues a fresh run.
- `flow.test.ts`: queue → fake GitHub → a fake worker writes events and a decision into the fake DB → `groupEvents` + `trackRecord` give the card what it shows. (The Playwright suite needs a live Supabase, so this is the mocked end-to-end.)
- [x] Python: cap raises after the threshold; cost prefers `usage.cost`; rows carry no prompt text. Commit.
- [ ] OPEN: `lib/research/flow.test.ts` (mocked end-to-end).

### Task 13: Export, deletion, env, final checks (`.env.example` done; export/deletion coverage OPEN)

- [ ] OPEN: Add the four tables to `EXPORT_TABLES` (`research_settings` keyed by `user_id`), `research-memory` to `STORAGE_BUCKETS` and `FILE_HELP`; extend `deletion-plan.test.ts`.
- [x] `.env.example`: `ORBIS_RESEARCH_DESK_EMAILS`, `ORBIS_RESEARCH_GITHUB_TOKEN`, `ORBIS_RESEARCH_GITHUB_REPO`, `ORBIS_RESEARCH_WORKFLOW`, `ORBIS_RESEARCH_GITHUB_REF`.
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, worker `pytest`; `git checkout -- next-env.d.ts`. Commit.

## Owner go-live (filled in by the final report)

Migrations `202610270003_research_desk.sql`; private repo + workflow + secrets + `ORBIS_WORKER_REF` variable; fine-grained token; Vercel env; `supabase/cron/research_schedule.sql` only if weekly runs or Saturday settling are wanted.
