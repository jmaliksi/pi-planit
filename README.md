# pi-planit

Headless plan mode for pi.dev — plan, review, and execute changes with safety and control.

## Features

### Plan Mode (`/planit`)

Enable **plan mode** to explore your codebase safely before making any changes. While plan mode is active, all write tools (`edit`, `write`, `ast_rewrite`) are blocked and bash commands are filtered through a read-only whitelist (only `cat`, `ls`, `grep`, `git status`, `find`, etc. are allowed).

This lets you and the agent inspect, analyze, and design without the risk of accidental modifications.

### Enter Plan Mode

| Method | Usage |
|--------|-------|
| Command | `/planit` — toggles on/off |
| Flag | `--planit` — starts the session in plan mode |

### Plan File

When you enter plan mode, a structured plan file is created at `~/.pi/agent/plans/<project-path>/<plan-name>.md` (mirroring your project directory). The agent writes plans to this file using the built-in `write_plan` tool — no need for the agent to use `write` (which is blocked).

Plan files include sections for **Summary**, **Steps** (with checklists), **Plan Details**, and **Assumptions**. The checklist format `- [ ] Step N: description` is auto-detected and rendered in a TUI widget.

### Live Widget

During planning, a widget in the TUI shows:
- The plan title and file path
- A live checklist with `☐` (pending) and `☑` (completed) markers

During execution, the widget shows progress as `📋 n/total` and updates as steps complete.

### Review Menu (`/planit review`)

When the agent finishes writing a plan, run `/planit review` to see the full plan in the widget and choose how to proceed:

| Option | Behavior |
|--------|----------|
| **↺ Build (auto)** | The agent executes all steps automatically. Report progress with `[DONE:n]` after each step. |
| **✓ Build (guided)** | Write tools are unblocked and the plan serves as a reference. You stay in control and can iterate. |
| **↻ Continue editing** | Return to planning mode to revise the plan before execution. |

### Execution Tracking

After approval, the agent tracks progress with `[DONE:n]` markers after each completed step. These are automatically parsed and the widget updates to show progress (e.g., `3/7`).

### Configuration

Plan mode tools are configurable via `~/.pi/agent/extensions/pi-planit/config.json`:

- **`allowedTools`** — tools permitted in plan mode (read tools + optional MCP tools). Default includes `read`, `bash`, `grep`, `find`, `ls`, `lsp`, `ast_search`, `web_search`, `fetch_content`, `get_search_content`, `code_search`.
- **`blockedTools`** — tools always blocked. Default: `edit`, `write`, `ast_rewrite`.

---

## Usage

```bash
# Enter plan mode, ask the agent to plan something
/planit migrate auth to JWT

# The agent explores the codebase and writes a plan
# (write tools are blocked during this time)

# Review the plan and choose an execution mode
/planit review

# Or check status at any time
/planit status

# Exit plan mode
/planit off
```

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
# Unit tests (plain vitest)
npx vitest run tests/unit

# Integration tests (requires pi-test-harness + running pi instance)
npx vitest run tests/integration
```

### File Structure

```
src/
├── index.ts          # Extension entry point
├── plan-mode.ts      # Core state machine: enter/exit, tool gating, events
├── plan-file.ts      # Plan file I/O, checklist parsing
├── bash-filter.ts    # Read-only bash whitelist/denylist
├── ui.ts             # TUI menus, status bar, widget rendering
└── types.ts          # Shared type definitions
```

### Planned

- `/planit delete` — delete a plan file
- `/planit resume` — resume an interrupted execution
- `/planit status` — detailed progress display
- Session persistence (state survives session restarts)
- Plan picker to browse and select past plans
