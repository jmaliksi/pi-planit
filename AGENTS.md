# Repo: pi-planit

## Purpose
Extension for pi.dev providing chat-first plan mode — safe codebase exploration with read-only tool gating, optional file-based plan saving, and a user-controlled build workflow.

## Tech Stack
- TypeScript (tsc compiler)
- Vitest for tests
- Dependencies: `@earendil-works/pi-ai`, `@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui`, TypeBox

## Key Concepts
- **Plan Mode** — chat-first read-only exploration session where `edit`/`write`/`ast_rewrite` are blocked, and `bash` is filtered through a whitelist/denylist
- **Plan File** — optional; written via `/planit write`, stored at `~/.pi/agent/plans/<sanitized-project>/<name-timestamp>.md`, free-form markdown
- **Phases** — 3 states: `idle`, `planning`, `building`
- **Session restoration** — phase, plan content, and tool set are persisted in session history and restored on restart

## Source Map
| File | Responsibility |
|---|---|
| `src/index.ts` | Extension entry point — registers PlanMode instance |
| `src/plan-mode.ts` | Core state machine: enter/exit, tool gating, system prompt injection, session lifecycle, `/planit review` |
| `src/plan-file.ts` | Plan file I/O, storage paths, versioned writes (retained timestamped backups), `listPlans()`/`listBackups()`/`restoreLatestBackup()`/`deleteFile()` |
| `src/bash-filter.ts` | Whitelist/denylist for bash commands in plan mode |
| `src/ui.ts` | Status bar, plan widget, build prompt dialog |
| `src/types.ts` | Shared type definitions (PlanPhase, PlanModeConfig) |
| `src/path-utils.ts` | Path resolution helpers |

## Commands (user-facing)
`/planit` toggle · `/planit write [title]` · `/planit build` · `/planit replan` · `/planit exit` · `/planit resume` · `/planit delete` · `/planit discard` · `/planit review` · `/planit undo`

## Build & Test
```bash
npm run build    # tsc
npm run test     # vitest run
npm run dev      # tsc --watch
```

> IMPORTANT: If already in the repo root, the agent doesn't need to `cd` first — just run the commands directly.

## State Machine
```
idle ──/planit──> planning (read-only tools + filtered bash)
                      │
                      ├── /planit write ──> LLM summarizes chat, writes/merges plan file, stays in planning
                      │
                      ├── /planit build ──> UI asks "auto or user-driven?" ──> building (full tools)
                      │                                                              │
                      │                                         /planit replan ──────────┘  (back to planning)
                      │                                                              │
                      │                                                    /planit exit/cancel/off ──> idle
                      │
                      └── /planit cancel ──> (confirm delete if plan file exists) ──> idle
```

- `idle` — normal operation, full tool access
- `planning` — read-only tools + filtered bash. Agent explores and discusses in chat. No auto plan writing.
- `building` — full tools restored. Plan injected as context. Agent executes (auto) or user drives.

## Conventions
- Tests mirror source structure: `src/foo.ts` → `test/foo.test.ts`
- All public types are explicitly defined in `types.ts`
- State transitions are the single source of truth in `plan-mode.ts`
- `BashFilter` uses whitelist-first + denylist override (must pass both to be allowed)
- No side effects in plan mode — tool gating enforced at both `setActiveTools()` and event handler levels
- Config defaults are written to disk on first run if `config.json` doesn't exist

## Changelog
- **Always update `CHANGELOG.md`** before a release. Add a new section for the upcoming version with a date and categorized entries (`Added`, `Changed`, `Fixed`, `Removed`, `Deprecated`).
- Use `[Unreleased]` at the top for changes not yet tagged.
- Group related commits; don't litter with per-commit entries unless they're independently meaningful.
- Version numbers follow semver. Review the changelog with stakeholders before committing.
