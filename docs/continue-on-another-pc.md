# Continue on another PC

Branch `continue-web-and-research`, pushed 2026-10-27. It is `main` plus two builds in progress, both switched off, so nothing here changes how the app looks or works until you turn them on. **It is not merged into `main`.**

## Get it running

```
git fetch origin
git checkout continue-web-and-research
pnpm install
```

Then copy your `.env.local` from the old PC (secrets are never in git). `.env.example` lists every variable, including the new ones below.

Port 3000 was taken by another project on the old PC, so the plans use `pnpm dev -p 3101`.

## What's on this branch

| Build | Plan (start at its "Resume here" section) | State | Next task |
|---|---|---|---|
| **Desktop web layout**: the whole app full-window on a laptop, with a left rail, header, Ctrl/Cmd+K search, Ask docked on the right and Settings as a dialog | `docs/superpowers/plans/2026-10-27-web-desktop.md` | Tasks 1–4 done. Tasks 5–8 (Today, Money, Health, Journal, Social) have a first pass that needs polish. | Task 9: link the Career panel's rail back to the other tabs. Then Task 10: e2e tests and final screenshots. |
| **Research desk**: TradingAgents in Money → Investments, owner only | `docs/superpowers/plans/2026-10-27-research-desk.md` | Tasks 1–10 done, plus most of 12 and 13. The Python worker has 51 passing tests. | Task 11: the weekly run and Monday heads-up. Then Task 12's flow test and Task 13's export/deletion coverage. |

Designs: `docs/superpowers/specs/2026-10-27-web-desktop-design.md` and `docs/superpowers/specs/2026-10-27-research-desk-tradingagents-design.md`. Also new on this branch: `docs/superpowers/specs/2026-10-03-bank-statement-import-design.md`, which was never committed before.

To pick it up with Claude Code, open the repo and say: *"Continue the desktop web layout from its plan's Resume here section"* or *"Continue the Research desk from its plan's Resume here section."*

## The two switches

- **Desktop layout:** on unless the build has `NEXT_PUBLIC_DESKTOP_LAYOUT=0`, which keeps the phone mock-up at every width. The phone layout is the same either way.
- **Research desk:** hidden, and none of its tables are read, unless `ORBIS_RESEARCH_DESK_EMAILS` has your email **and** both `ORBIS_RESEARCH_GITHUB_TOKEN` and `ORBIS_RESEARCH_GITHUB_REPO` are set.

## Python worker (Research desk)

```
cd workers/research-desk
python -m venv .venv                          # Python 3.11+
.venv/Scripts/python -m pip install pytest    # Windows; .venv/bin/python on Mac/Linux
.venv/Scripts/python -m pytest
```

The tests need neither TradingAgents nor the network.

## Before any of this goes live

**Career** (already on `main`):
1. Run migrations `202610270001_career.sql` and `202610270002_career_followup.sql`.
2. Run `supabase/cron/career_schedule.sql`.
3. Add `gmail.send` to the Google OAuth consent screen.

**Research desk:**
1. Run migration `202610270003_research_desk.sql`.
2. Create a **private** repo, `orbis-research-worker`. `whiteslam/orbis` is public, and so are its Actions logs.
3. Copy `workers/research-desk/private-repo/.github/workflows/research-desk.yml` into the private repo.
4. Give that repo:
   - the secrets `OPENROUTER_API_KEY`, `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (optionally `NEWSDATA_API_KEY`);
   - an Actions variable `ORBIS_WORKER_REF`, set to a full 40-character commit SHA of `whiteslam/orbis`.
5. Create a fine-grained GitHub token with Actions: write on that repo only.
6. In Vercel, set `ORBIS_RESEARCH_GITHUB_TOKEN`, `ORBIS_RESEARCH_GITHUB_REPO` (`<owner>/orbis-research-worker`) and `ORBIS_RESEARCH_DESK_EMAILS` (your email).

**Not yet tested against the real services:**
- OpenRouter's model ids `anthropic/claude-sonnet-5.5` and `anthropic/claude-haiku-5.5`;
- the worker's calls into TradingAgents v0.7.1;
- the Indian RSS feed URLs;
- both builds in a real browser with keyboard only.

## Merging later

When a build is finished and checked, merge this branch (or just that build's commits) into `main`. CI runs `typecheck`, `lint`, `test`, `build` and `audit` on every push.
