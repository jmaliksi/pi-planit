# pi-planit

Headless plan mode for pi.dev — plan, review, and execute changes with safety and control.

## Quick Start

```bash
# Start a session in plan mode via flag
--planit

# Or enter plan mode mid-session
/planit migrate auth to JWT

# The agent explores the codebase and writes a plan
# (write tools blocked, bash filtered to read-only)

# Review the plan and choose an execution mode
/planit review

# Check status at any time
/planit status

# Resume a past plan
/planit resume

# Exit plan mode
/planit off
```

## Features

### Plan Mode (`/planit`)

Enter **plan mode** to explore the codebase safely before making any changes. While in plan mode:

- **Tool gating** — write tools (`edit`, `write`, `ast_rewrite`) are blocked via the active tool set.
- **Bash filtering** — `bash` calls pass through a whitelist/denylist filter. Only explicitly safe commands are allowed.
- **System prompt injection** — a read-only guard-rail prompt is appended to the agent's system prompt on every turn.

The agent uses the `write_plan` tool (registered as a custom tool, available only in plan mode) to save the plan. No plan file is created until the agent calls `write_plan`.

### Phases

The state machine has four phases:

| Phase | Tool access | Description |
|---|---|---|
| `idle` | Full | Normal operation, no plan active |
| `planning` | Read-only (whitelisted tools + filtered bash) | Agent explores, asks questions, writes plan |
| `planned` | Full | Plan reviewed and approved. User is in control. |
| `executing` | Full | Agent runs approved plan steps with progress tracking |

### Enter Plan Mode

| Method | Usage |
|--------|-------|
| Command | `/planit` — toggles (idle ↔ planning; planned/executing → planning) |
| Flag | `--planit` — starts the session in plan mode |

### Plan File

Plans are saved via the `write_plan` tool, which is available only during plan mode. Files are stored at `~/.pi/agent/plans/<sanitized-project-path>/<plan-name-timestamp>.md`.

The agent is guided by a system prompt template that defines the expected structure:

```markdown
# Title
## Summary
One-paragraph overview.

## Steps
- [ ] Step 1: Objective — target files, validation method
- [ ] Step 2: Objective — target files, validation method
- [ ] Step 3: ...

## Plan Details
Implementation notes for each step. Target files, code changes, config updates,
validation criteria. Include concrete file paths and function/method names.

## Assumptions and Reference
- Assumption 1 — brief explanation
- Reference: https://example.com/api-docs
- Reference: src/auth/jwt.ts
```

Checklists use the `- [ ]` format and are auto-detected for the TUI widget.

### Live Widget

A TUI widget displays plan progress:

- **Planning/planned** — shows plan title, file path, and checklist with `☐` (pending) / `☑` (completed) markers
- **Executing** — shows `📋 n/total` progress, updates as the agent emits `[DONE:n]` markers

### Review Menu (`/planit review`)

After the agent writes a plan, run `/planit review` to see the full plan and choose an execution mode:

| Option | Phase transition | Behavior |
|---|---|---|
| **↺ Build (auto)** | `planned` → `executing` | Agent runs all plan steps automatically. Progress reported with `[DONE:n]`. |
| **✓ Build (guided)** | Stays `planned` | Full tools restored. Plan is injected as a system prompt reference. User stays in control. |
| **↻ Continue editing** | `planned` → `planning` | Returns to read-only planning mode. Revise the plan and re-review. |

### Session Restoration

When a session restarts, plan mode state (phase, plan file, tool set) is reconstructed from session history. You can resume mid-plan or mid-execution.

### Configuration

Plan mode tools are configurable via `~/.pi/agent/extensions/pi-planit/config.json`:

- **`allowedTools`** — tool names allowed in plan mode (intersected with available tools). Default: `read`, `bash`, `grep`, `find`, `ls`, `lsp`, `ast_search`, `web_search`, `fetch_content`, `get_search_content`, `code_search`, `write_plan`.
- **`blockedTools`** — tools always blocked at the event handler level. Default: `edit`, `write`, `ast_rewrite`.

Note: `bash` is in `allowedTools` but is further filtered by `BashFilter`.

---

## Commands

| Command | Description |
|---|---|
| `/planit` | Toggle (idle ↔ planning; planned/executing → planning) |
| `/planit on` / `/planit enable` / `/planit start` | Enter planning mode |
| `/planit off` / `/planit disable` / `/planit stop` / `/planit exit` | Exit plan mode (return to idle) |
| `/planit review` | Review plan and choose execution mode (auto, guided, or continue editing) |
| `/planit resume` | Browse past plans via picker; loads selected plan into its saved phase |
| `/planit cancel` | Cancel execution/planning → planning (or idle if already in planning) |
| `/planit delete` | Delete a plan file via picker + confirmation |
| `/planit discard` | Remove the currently active plan file (resets to fresh state) |
| `/planit status` | Show current phase and progress |

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

### Install as Extension

Copy the `dist` output to your pi installation's extension directory, or add the package to `~/.pi/agent/extensions/pi-planit/`.

### Run Tests

```bash
# All tests (vitest, flat in test/)
npm run test
```

### File Structure

```
src/
├── index.ts          # Extension entry point
├── plan-mode.ts      # Core state machine (idle/planning/planned/executing), tool gating, system prompt injection, review flow
├── plan-file.ts      # Plan file I/O, checklist parsing, storage paths
├── bash-filter.ts    # Whitelist/denylist bash command filter
├── ui.ts             # TUI menus, status bar, widget rendering
├── path-utils.ts     # Path resolution helpers
└── types.ts          # Shared types: PlanPhase, PlanModeConfig, ChecklistItem
```
