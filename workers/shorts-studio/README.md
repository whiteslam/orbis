# Orbis Shorts worker

This worker runs on your own PC and makes the faceless shorts you queue in **Social → Shorts**. Each job takes two stages:

1. **Plan.** Claude Code uses the `faceless-shorts` skill to write the script, captions, shot list and sources. You then edit and approve them in Orbis.
2. **Build.** Claude Code records the voice, times every word, animates the shots, checks every frame and renders the MP4. The worker then uploads the files to Orbis.

Design: `docs/superpowers/specs/2026-11-10-faceless-shorts-foundation-design.md`.

## What it needs

- **The skill:** installed at `~/.claude/skills/faceless-shorts/`. Its `scripts/setup.sh` must print **All set**; the worker checks this on every start.
- **Claude Code**, signed in. The VS Code and Cursor extensions ship the CLI, for example:
  `~/.cursor/extensions/anthropic.claude-code-<version>-linux-x64/resources/native-binary/claude`
  That path changes on every extension update, so link it once and point `CLAUDE_BIN` at the link:
  ```bash
  ln -sf ~/.cursor/extensions/anthropic.claude-code-*-linux-x64/resources/native-binary/claude ~/.local/bin/claude
  claude --version   # signs in on first use if needed: run `claude` once interactively
  ```
- **Node 22.18+** (it runs the TypeScript directly), ffmpeg and Google Chrome.
- **The database migration** `supabase/migrations/202611100001_shorts.sql`, applied.

## Configure

Put these settings in `~/.config/orbis-shorts/.env`:

```bash
mkdir -p ~/.config/orbis-shorts
cat > ~/.config/orbis-shorts/.env <<'EOF'
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<the service-role / secret key>
# Your Orbis user id: Supabase → Authentication → Users → your row's UID
OWNER_USER_ID=<uuid>
CLAUDE_BIN=~/.local/bin/claude
# Optional:
# SKILL_DIR=~/.claude/skills/faceless-shorts
# PROJECTS_DIR=~/faceless-shorts
# SOFTWARE_GL=1     # no GPU: 3D styles render at 0.6 resolution, 24 fps
EOF
chmod 600 ~/.config/orbis-shorts/.env
```

The service-role key never leaves this PC. The worker only takes jobs whose `user_id` is `OWNER_USER_ID`.

## Run it

To try it in a terminal:

```bash
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON workers/shorts-studio/src/main.ts
```

To run it as a service:

```bash
cp workers/shorts-studio/orbis-shorts.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now orbis-shorts
journalctl --user -u orbis-shorts -f
```

The service stops when you log out. To keep it running after you log out: `loginctl enable-linger $USER`.

## What it does

- **On start:**
  - runs the skill's `setup.sh`;
  - uploads the style catalog: each `STYLE.md` header and its `style-sheet.png`;
  - sends the voice list;
  - marks any short it was in the middle of as failed, so you can retry it.
- **While running:** sends a heartbeat every 30 s. Orbis shows the worker as offline after 2 minutes without one.
- **Each job:**
  - runs `claude -p` in `~/faceless-shorts/<style>-<id>/`;
  - uses `--permission-mode dontAsk` and a tool allowlist, so anything outside it is refused;
  - loads no MCP servers and has web access only while planning;
  - takes the topic as tagged data, never as instructions.
- **Limits:** planning stops after 15 minutes and a build after 2 hours.
- **Cancelling:** a short you cancel in Orbis is stopped within about 20 s.
- **Claude Code signed out or out of usage:** the job fails with a clear note, and the worker waits 30 minutes before taking the next one.
- **Project folders stay on this PC.** Later revisions will re-render from them.

## Tests

```bash
pnpm vitest run workers/shorts-studio
```

`fake-claude.mjs` stands in for Claude Code, so the flow tests use no usage and no network.
