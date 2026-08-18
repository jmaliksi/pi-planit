# Changelog

## [Unreleased]

### Added

- Versioned plan writes: every overwrite archives the previous content to a timestamped `<plan>.md.bak-<ts>` sibling, and new `/planit:undo` restores the latest backup (restore is itself reversible)
- Preview-diff guardrail: follow-up `/planit:write` runs show a diff preview and require confirmation before overwriting the plan (configurable via `previewDiff` in `config.json`, default on; skipped on first writes and in headless sessions)
- Read-only timekeeping bash commands (`date`, `time`, `cal`, `uptime`, `timedatectl`) are now allowed in plan mode
- Plan mode now explicitly forbids interpreter commands (node, python, etc.): the agent is directed to use the built-in read-only tools, and may only ask the user to run a command when certain the built-in tools cannot retrieve the information

### Changed

- Follow-up `/planit:write` prompts now enforce an append-only contract: existing content must be reproduced verbatim and new information is added as timestamped addenda (`#### Update (YYYY-MM-DD HH:MM)`) under the relevant step, as a new sequential step (fractional numbers like `2.5` when inserted between steps), or in a trailing `## Notes` section
- Plan files are only created on disk once the first write lands (no empty stub file is materialized at `/planit:write` time)

## [1.2.0] - 2026-08-16

### Added

- Manual (user-driven) build mode prompting: in manual build mode the agent receives an extra pause block in its system prompt (configurable via `manualBuildPause` in `config.json`, bundled default in `building-manual.md`), prompting it to pause and hand control back to the user after each step.

### Fixed

- Resumed plans are now injected into the agent's context during the planning phase. Previously `/planit:resume` loaded a plan into the UI but never surfaced its content to the LLM, so the model had no reference to the plan while discussing.

## [1.1.0] - 2026-08-16 

### Added

- Token preservation during build: a new `context`-event filter sheds plan noise once a plan file has content
  - `avoidPlanDuplication` (default `true`): drops the `/planit:write` instruction and captured plan-response messages from build context, since the plan is already injected via the system prompt. The planning conversation is otherwise left intact.
- Writing prompt now requires self-contained plans: the plan must capture concrete file paths, symbols, and decisions explicitly so it remains usable when resumed in a fresh session

## [1.0.1] — 2026-08-13

### Fixes

- In user-driven build mode, plan writes now pause the agent and notify the user instead of auto-continuing, giving a natural review point before the next build cycle

## [1.0.0] — 2026-08-13

### Changes

- `planit:write` now works during the building phase — LLM can summarize and write/merge the plan mid-build
- User-driven build mode: plan writes pause the agent for user review before continuing

## [0.2.0] — 2026-08-12

### Added

- `/planit replan` — return to plan mode from building while preserving plan file and tools
- `planit:write` accepts optional arguments: single-word = title (first write), multi-word = additional LLM instructions

### Changed

- `PlanFile.load()` always reads from disk instead of trusting external snapshots (catches external edits, branch switches, manual modifications)
- `planit:write` now works in both `planning` and `building` phases

## [0.1.0] — 2026-08-04

### Initial Release

- Phase 1: Skeleton & tool gating — read-only tool set with filtered bash in plan mode
- Three-phase state machine: `idle` → `planning` → `building`
- `/planit` toggle, `/planit write`, `/planit build`, `/planit exit/cancel/off`, `/planit resume`, `/planit delete`
- Plan file I/O — writes/merges markdown plans at `~/.pi/agent/plans/`
- Bash whitelist/denylist filtering
- Phase-specific system prompt injection (planning / building / writing)
- UI: status bar, plan widget, build-mode dialog
- Session state persistence & restoration (phase, plan content, tool set)
- Extracted prompt templates for each phase
- Review improvements
- Consolidated commands to colon syntax (`/planit:write`, etc.)
- Chat-first state machine redesign
- Checkbox support in plan output
