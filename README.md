# pi-planit

Chat-first plan mode for pi.dev — explore safely, save a plan when ready, then build with full tool access.

## Quick Start

### Installation
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

# you can explore the codebase and discusses the approach in chat while the agent can only use read-only tools.

# when ready, save the current conversation as a plan file
/planit write

# drop out of planning to resume (or not) later
/planit exit

# review the current plan
/planit review

# resume a past plan
/planit resume

# throw away the plan and exit
/planit discard

# Or when ready to implement, restore full tools and inject the plan as context
/planit build

# delete and exit once done
/planit finish
```

## Features

### Plan Mode (`/planit`)

Enter **plan mode** to explore the codebase safely before making any changes. While in plan mode:

- **Tool gating** — write tools (`edit`, `write`, `ast_rewrite`) are blocked via the active tool set.
- **Bash filtering** — `bash` calls pass through a whitelist/denylist filter. Only explicitly safe commands are allowed.
- **System prompt injection** — a read-only guard-rail prompt is appended to the agent's system prompt on every turn.

Planning is **chat-first**: the agent explores and discusses in conversation. No plan file is created unless you explicitly call `/planit write`.

### Phases

The state machine has three phases:

| Phase | Tool access | Description |
|---|---|---|
| `idle` | Full | Normal operation, no plan active |
| `planning` | Read-only (whitelisted tools + filtered bash) | Agent explores and discusses in chat |
| `building` | Full | Plan injected as context. Agent executes (auto) or user drives. |

### Enter Plan Mode

| Method | Usage |
|--------|-------|
| Command | `/planit` — toggles between idle and planning |
| Flag | `--planit` — starts the session in plan mode |

### Plan File

Plans are optional and written on demand via `/planit write`. Storage location is controlled by `planStorage` in `config.json` (see Configuration below):

- **`global`** (default): `~/.pi/agent/plans/<sanitized-project-path>/<plan-name-timestamp>.md`
- **`local`**: `<cwd>/.pi/plans/<plan-name-timestamp>.md` (no project subdirectory)

When you run `/planit write`, the extension asks the LLM to summarize the conversation into a plan document and saves the result. If a plan file already exists, the LLM semantically merges the new content with the existing file.

Plan files are free-form markdown — no required structure. A typical plan looks like:

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

### Building (`/planit build`)

When you run `/planit build`, the extension:

1. Prompts you to choose: **Agent executes automatically** or **I'll drive (plan injected as context)**
2. Restores full tool access
3. If a plan file was written, shows its path in the status widget
4. Injects the plan content into the agent's system prompt as a reference

In auto mode, the agent immediately starts working through the plan. In manual mode, you remain in control with the plan as background context.

Exit building mode at any time with `/planit exit`, `/planit discard`, or `/planit finish`.

### Review (`/planit review`)

Opens the current plan file in your external editor (`$VISUAL`/`$EDITOR`). Pi's TUI suspends while the editor is active, then resumes when the editor exits. Any changes made in the editor are written back to the plan file.

- **No plan file** → notification: "No plan written yet. Use `/planit write` to create one first."
- **No `$VISUAL`/`$EDITOR`** → notification: "External editor not set. Set `$VISUAL` or `$EDITOR` to edit."
- **Works from any phase** (`idle`, `planning`, `building`)

### Session Restoration

When a session restarts, plan mode state (phase, plan file, tool set) is reconstructed from session history. You can resume mid-plan or mid-build.

### Configuration

Plan mode configuration is stored in `~/.pi/agent/extensions/pi-planit/config.json`:

- **`allowedTools`** — tool names allowed in plan mode (intersected with available tools). Default: `read`, `bash`, `grep`, `find`, `ls`, `lsp`, `ast_search`, `web_search`, `fetch_content`, `get_search_content`, `code_search`.
- **`blockedTools`** — tools always blocked at the event handler level. Default: `edit`, `write`, `ast_rewrite`.
- **`planStorage`** — where plan files are stored: `"global"` (default, `~/.pi/agent/plans/`) or `"local"` (`<cwd>/.pi/plans/`).

Note: `bash` is in `allowedTools` but is further filtered by `BashFilter`.

---

## Commands

| Command | Description |
|---|---|
| `/planit` | Toggle (idle ↔ planning) |
| `/planit exit` | Exit to idle; shows a build-warning if exiting from building |
| `/planit discard` | Exit to idle; prompts to delete the plan file if one exists |
| `/planit finish` | Like discard, but only works from building phase |
| `/planit write [title]` | Ask the LLM to summarize the chat and save/merge a plan file |
| `/planit build` | Restore full tools, inject plan as context, optionally auto-execute |
| `/planit resume` | Browse past plans via picker; loads selected plan into planning mode |
| `/planit delete` | Delete a plan file via picker + confirmation |
| `/planit review` | Open the current plan in your external editor ($VISUAL/$EDITOR); Pi suspends, changes written back on exit

## Environment Variables

| Variable | Description |
|---|---|
| `PI_CODING_AGENT_DIR` | Override the default agent directory (`~/.pi/agent`). Plan files, config, and session data are stored relative to this path. |

---

## Development

### Prerequisites

- Node.js
- TypeScript
- A local build of `pi` from [earendil-works/pi](https://github.com/earendil-works/pi)

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
└── types.ts          # Shared types: PlanPhase, PlanModeConfig
```
