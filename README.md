# pi-planit

Minimal, chat-first plan mode for [pi.dev](https://pi.dev) — explore read-only, save free-form plans on demand, then build with full tool access.

## Installation

### Via npm (recommended)

```bash
pi install npm:pi-planit
```

### Via git

```bash
cd /path/to/project
git clone git@github.com:jmaliksi/pi-planit.git
cd pi-planit
npm install
npm run build
pi install /path/to/project/pi-planit
```

### Usage

```bash
# start a session in plan mode via flag
pi --planit

# or enter plan mode mid-session
/planit

# or enter plan mode with an initial message
/planit i want to make a plan

# you can explore the codebase and discuss the approach in chat while the agent can only use read-only tools.

# when ready, save the current conversation as a plan file
/planit:write

# review the current plan
/planit:review

# resume a past plan
/planit:resume

# throw away the plan and exit
/planit:discard

# when ready to implement, restore full tools and inject the plan as context
/planit:build

# delete and exit once done
/planit:finish

# exit back to idle (without deleting the plan)
/planit:exit
```

## Features

### Chat-first exploration

Plan mode is chat-first: the agent explores the codebase and discusses the approach in conversation. No plan file is created unless you explicitly call `/planit write`. Read-only tool access and hard bash filtering keep the agent safe while you think.

### Hard bash filtering

Unlike extensions that rely on system prompt guidance to keep bash read-only, pi-planit enforces a whitelist/denylist filter at the tool invocation layer. Only explicitly safe commands pass through.

### Free-form plan files

Plans are optional and written on demand — no checklist format, no required structure. Write whatever makes sense for your workflow. A typical plan looks like:

```markdown
# Migrate Auth to JWT

## Approach
Replace session-based auth with stateless JWT tokens. Key changes:
- Replace `express-session` with `jsonwebtoken`
- Update `authMiddleware` to validate Bearer tokens
- Migrate `/login` to issue tokens instead of sessions

## Key Files
- `src/middleware/auth.ts` — middleware rewrite
- `src/routes/auth.ts` — login endpoint
- `src/types/user.ts` — add token payload type

## Decisions
- Use RS256 (asymmetric) over HS256 for multi-service compatibility
- 15-minute access tokens, 7-day refresh tokens stored in httpOnly cookies
```

### Auto-summarize and merge

Run `/planit write` to ask the LLM to summarize the conversation into a plan document. If a plan file already exists, it semantically merges the new content rather than overwriting.

### Session restoration

When a session restarts, plan mode state (phase, plan file, tool set) is reconstructed from session history. You can resume mid-plan or mid-build.

### Phases

The state machine has three phases:

| Phase | Tool access | Description |
|---|---|---|
| `idle` | Full | Normal operation, no plan active |
| `planning` | Read-only (whitelisted tools + filtered bash) | Agent explores and discusses in chat |
| `building` | Full | Plan injected as context. Agent executes (auto) or user drives. |

### Plan file storage

Plans are stored based on `planStorage` in `config.json` (see Configuration):

- **`global`** (default): `~/.pi/agent/plans/<sanitized-project-path>/<plan-name-timestamp>.md`
- **`local`**: `<cwd>/.pi/plans/<plan-name-timestamp>.md` (no project subdirectory)

### Enter plan mode

| Method | Usage |
|--------|-------|
| Command | `/planit` — enters planning mode (no-op if already in planning) |
| Command | `/planit <message>` — enters planning mode and forwards the message as a follow-up |
| Flag | `--planit` — starts the session in plan mode |

### Build modes

`/planit build` prompts you to choose **Agent executes automatically** or **I'll drive**. Either way, full tool access is restored and the plan is injected into the system prompt as context.

Exit building mode at any time with `/planit:exit`, `/planit:discard`, or `/planit:finish`.

### Review (`/planit review`)

Opens the current plan file in your external editor (`$VISUAL`/`$EDITOR`). Pi's TUI suspends while the editor is active, then resumes when the editor exits. Changes are written back on exit.

- **No plan file** → notification: "No plan written yet. Use `/planit:write` to create one first."
- **No `$VISUAL`/`$EDITOR`** → notification: "External editor not set. Set `$VISUAL` or `$EDITOR` to edit."
- **Works from any phase** (`idle`, `planning`, `building`)

### System Prompt Templates

Plan mode uses three markdown prompt templates that are bundled by default under `src/prompts/`:

| File | Purpose | Variables |
|---|---|---|
| `planning.md` | Read-only guard-rail injected in planning phase | None |
| `building.md` | Plan context injected in building phase | `{planFilePath}`, `{planContent}` |
| `writing.md` | Instruction sent to LLM when `/planit write` is called | None |

To customize prompts, set `systemPromptDir` in `config.json` to a directory containing your custom `.md` files. Missing custom files fall back to bundled defaults with a `console.warn`.

### Configuration

Plan mode configuration is stored in `~/.pi/agent/extensions/pi-planit/config.json`:

- **`allowedTools`** — tool names allowed in plan mode (intersected with available tools). Default: `read`, `bash`, `grep`, `find`, `ls`, `lsp`, `ast_search`, `web_search`, `fetch_content`, `get_search_content`, `code_search`.
- **`blockedTools`** — tools always blocked at the event handler level. Default: `edit`, `write`, `ast_rewrite`.
- **`planStorage`** — where plan files are stored: `"global"` (default, `~/.pi/agent/plans/`) or `"local"` (`<cwd>/.pi/plans/`).
- **`systemPromptDir`** — directory containing custom system prompt `.md` files (`planning.md`, `building.md`, `writing.md`). Falls back to bundled defaults if not set.

Note: `bash` is in `allowedTools` but is further filtered by `BashFilter`.

---

## Commands

| Command | Description |
|---|---|
| `/planit` | Enter planning mode. With arguments, enter planning and forward the message as a follow-up. |
| `/planit:build` | Restore full tools, inject plan as context, optionally auto-execute |
| `/planit:discard` | Exit to idle; prompts to delete the plan file if one exists |
| `/planit:exit` | Exit plan mode and restore full tool access (no file deletion) |
| `/planit:finish` | Like discard but only works from building phase |
| `/planit:resume` | Browse and resume a saved plan file |
| `/planit:review` | Open the current plan in your external editor ($VISUAL/$EDITOR); Pi suspends, changes written back on exit |
| `/planit:write` | Ask the LLM to summarize the chat and save/merge a plan file |
| `/planit:delete` | Delete a plan file via picker and confirmation |

## Environment Variables

| Variable | Description |
|---|---|
| `PI_CODING_AGENT_DIR` | Override the default agent directory (`~/.pi/agent`). Plan files, config, and session data are stored relative to this path. |

---

## Development

### Prerequisites

- Node.js
- TypeScript
- A local build of `pi` from [earendil-works/pi](https://github.com/earendil-works/pi) (for development)

### Build

```bash
npm install
npm run build
```


### Run Tests

```bash
# All tests (vitest, flat in test/)
npm run test
```

### File Structure

```
src/
├── index.ts          # Extension entry point
├── plan-mode.ts      # Core state machine (idle/planning/building), tool gating, system prompt injection
├── plan-file.ts      # Plan file I/O, free-form markdown storage, listPlans()
├── bash-filter.ts    # Whitelist/denylist bash command filter
├── ui.ts             # Status bar, plan widget, build prompt dialog
├── path-utils.ts     # Path resolution helpers
├── types.ts          # Shared types: PlanPhase, PlanModeConfig
└── prompts/          # System prompt templates (planning.md, building.md, writing.md)
```
