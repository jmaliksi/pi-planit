# Repo: pi-planit

## Purpose
Extension for pi.dev providing headless plan mode — safe codebase exploration with read-only tool gating, file-based planning, and a TUI review/execution workflow.

## Tech Stack
- TypeScript (tsc compiler)
- Vitest for tests
- Dependencies: `@earendil-works/pi-ai`, `@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui`, TypeBox

## Key Concepts
- **Plan Mode** — read-only exploration session where `edit`/`write`/`ast_rewrite` are blocked, and `bash` is filtered through a whitelist/denylist
- **Plan File** — written via `write_plan` tool, stored at `~/.pi/agent/plans/<sanitized-project>/<name-timestamp>.md`, contains checklist with `- [ ]` items
- **Phases** — 4 independent states: `idle`, `planning`, `planned`, `executing`
- **Session restoration** — phase, plan content, and tool set are persisted in session history and restored on restart

## Source Map
| File | Responsibility |
|---|---|
| `src/index.ts` | Extension entry point — registers PlanMode instance |
| `src/plan-mode.ts` | Core state machine: enter/exit, tool gating, system prompt injection, review flow, session lifecycle |
| `src/plan-file.ts` | Plan file I/O, checklist parsing, storage paths, `listPlans()` |
| `src/bash-filter.ts` | Whitelist/denylist for bash commands in plan mode |
| `src/ui.ts` | TUI menus, status bar, plan widget rendering |
| `src/types.ts` | Shared type definitions (PlanPhase, PlanModeConfig, ChecklistItem) |
| `src/path-utils.ts` | Path resolution helpers |

## Commands (user-facing)
`/planit` toggle · `/planit on` · `/planit off` · `/planit review` · `/planit resume` · `/planit cancel` · `/planit delete` · `/planit discard` · `/planit status`

## Build & Test
```bash
npm run build    # tsc
npm run test     # vitest run
npm run dev      # tsc --watch
```

> Note: If already in the repo root, the agent doesn't need to `cd` first — just run the commands directly.

## State Machine
```
idle ──/planit──> planning ──agent writes plan──> planned
                  (read-only)    (auto)              │ user does work
                                                     │ themselves,
                                                     │ checks off items
                                                     │
planned ──/planit review──> executing (auto-build)   │
                                                     │
planned ──/planit cancel──> planning (edit more)     │
                                                     │
planned ──/planit off──> idle                        │
executing ──all steps done──> idle                   │
executing ──/planit cancel──> planning               │
                                                    │
idle ──/planit off──> idle (no-op) ──────────────────+
```

- `idle` — normal operation, full tool access
- `planning` — read-only tools + filtered bash. Agent explores and writes plan.
- `planned` — full tools restored. User in control. Plan is a reference checklist. Agent does NOT auto-execute.
- `executing` — full tools restored. Agent auto-runs approved plan steps with `[DONE:n]` progress tracking.

## Conventions
- Tests mirror source structure: `src/foo.ts` → `test/foo.test.ts`
- All public types are explicitly defined in `types.ts`
- State transitions are the single source of truth in `plan-mode.ts`
- `BashFilter` uses whitelist-first + denylist override (must pass both to be allowed)
- No side effects in plan mode — tool gating enforced at both `setActiveTools()` and event handler levels
- Config defaults are written to disk on first run if `config.json` doesn't exist
