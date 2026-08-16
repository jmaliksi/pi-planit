# Changelog

## [Unreleased]

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
