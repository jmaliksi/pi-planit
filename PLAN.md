# Headless Plan Mode — Phased Implementation Plan

> **Goal:** A purely headless plan mode for pi.dev that operates entirely within the Pi TUI.
> The agent explores codebase read-only, writes a persistent plan file (not committed), then
> the user approves execution against that plan file.
>
> **Base:** `@narumitw/pi-plan-mode` — the most minimal, TUI-native implementation.
> **Key additions:** file-based plan contract (from `@plannotator/pi-extension` pattern),
> structured checklist parsing (from `@plannotator/pi-extension`), and improved bash filtering
> (from `@devkade/pi-plan`).

---

## Prerequisites & Research

**What was already researched:**
1. `@narumitw/pi-plan-mode` — source code read via pi.dev package page. Provides the foundation:
   - `/planit` toggle with `--planit` flag
   - Tool set capture/restore on enter/exit
   - Read-only tool subset (no `edit`/`write`)
   - Bash whitelist filtering
   - TUI `ctx.ui.select()` for action menus
   - `before_agent_start` system prompt injection
   - `[DONE:n]` progress tracking
2. `@devkade/pi-plan` — source code read. Provides:
   - Structured output contract (Goal → Evidence → Plan → Risks)
   - `isSafeReadOnlyCommand()` whitelist pattern
   - `[DONE:n]` step extraction helpers
   - `selectPlanNextActionWithInlineNote()` TUI menu
3. `@plannotator/pi-extension` — source code read. Provides:
   - `plannotator_submit_plan` tool pattern (file-based submission)
   - Checklist parsing from markdown (`- [ ]` / `- [x]`)
   - Per-phase config system (optional, likely skip)
   - State persistence via `pi.appendEntry()`
4. Pi dev extension API docs — read from `packages/coding-agent/docs/extensions.md`

**Key pi.dev API references used throughout:**
- Extension entry point: `export default function (pi: ExtensionAPI)` ([extensions.md](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md#writing-an-extension))
- `pi.setActiveTools()` — switch tools ([extensions.md](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md#tool-events))
- `pi.getAllTools()` — list available tools ([extensions.md](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md))
- `pi.registerTool()` — custom LLM-callable tool ([extensions.md](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md#writing-an-extension))
- `pi.registerCommand()` — register `/cmd` ([extensions.md](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md#writing-an-extension))
- `pi.registerFlag()` — CLI flags like `--plan` ([extensions.md](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md#writing-an-extension))
- `pi.registerShortcut()` — keyboard shortcuts ([extensions.md](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md#writing-an-extension))
- `pi.appendEntry()` — session persistence ([extensions.md](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md))
- `pi.sendUserMessage()` — inject messages from extensions ([extensions.md](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md#input-events))
- `ctx.ui.select()`, `ctx.ui.confirm()`, `ctx.ui.input()`, `ctx.ui.notify()` — TUI interaction ([extensions.md](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md#extensioncontext))
- `ctx.ui.setStatus()` — footer status bar ([extensions.md](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md#extensioncontext))
- `ctx.ui.setWidget()` — widget area above editor ([extensions.md](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md#extensioncontext))
- `ctx.hasUI` — false in print/JSON mode ([extensions.md](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md#extensioncontext))
- Events: `session_start`, `session_shutdown`, `tool_call`, `before_agent_start`, `agent_end`, `turn_end` ([extensions.md](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md#events))
- `isToolCallEventType()` — type guard for tool events ([extensions.md](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md#tool-call))

---

## Phase 1: Skeleton & Tool Gating ✅

**Status:** Implemented.

**Summary:** Extension entry point, shared types, config loading from `~/.pi/agent/extensions/pi-planit/config.json` with defaults fallback. Core `PlanMode` class with phase state machine (`idle` / `planning` / `executing`), tool capture/restore via `pi.getAllTools()` + `pi.setActiveTools()`, `onToolCall` gating for blocked tools and bash whitelist, `onBeforeAgentStart` system prompt injection for planning and execution phases, `[DONE:n]` progress extraction via `onTurnEnd`. Toggle/on/off/status commands and `--planit` flag.

**References:**
- Extension factory pattern ([extensions.md](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md#writing-an-extension))
- `registerCommand`, `registerFlag`, `registerShortcut` ([extensions.md](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md#writing-an-extension))
- `pi.setActiveTools()` — tool switching, Issue #4147 caveat
- `tool_call` event gating via `{ block: true }` — Issue #2543 cosmetic caveat
- `before_agent_start` system prompt chaining ([extensions.md](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md#before_agent_start))
- Event registration (`pi.on()`) ([extensions.md](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md#events))

**Tier 1 — Unit tests** (`test/bash-filter.test.ts`): Plain vitest, no harness.
- `BashFilter.isSafe()` — assert SAFE_PATTERNS match: `cat`, `ls`, `grep`, `git status`, `find`, `npm list`, etc.
- `BashFilter.isSafe()` — assert DANGEROUS_PATTERNS block: `rm`, `git commit`, `npm install`, `sudo`, `mv`, file redirects (`>`)
- Edge case: empty / whitespace-only commands allowed



---

## Phase 2: Plan File Management ✅

**Status:** Implemented.

**Summary:** `PlanFile` class with plan file I/O in `~/.pi/agent/plans/--project-path--/` mirror structure (same naming convention as pi.dev sessions). Filename derived from user summary (3-5 words + timestamp). Checklist parsing via regex for `- [ ]` / `- [x]` markers, title extraction, `getWidgetLines()` for TUI display, `markCompleted()` for progress updates, `getRemainingSteps()` for execution context. `write_plan` custom tool registered in `PlanMode.register()` — the agent's only permitted write method during planning.

**References:**
- Custom tool registration ([extensions.md](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md#writing-an-extension))
- Checklist parsing pattern from @plannotator/pi-extension

**Tier 1 — Unit tests** (`test/plan-file.test.ts`): Plain vitest with fs mocking.
- `PlanFile.init()` — creates file in `~/.pi/agent/plans/--project-path--/` mirror structure
- `derivePlanName()` — derives 3-5 word filename from user summary (e.g., "migrate auth to jwt" → `migrate-auth-to-jwt`)
- Same summary produces unique filenames (different timestamps)
- Checklist parsing: `- [ ]` and `- [x]` markers correctly parsed
- `markCompleted()` — updates checkbox state correctly
- `getWidgetLines()` — returns correct checkbox prefix (`☐` / `☑`)

---

## Phase 3: Review Flow ✅

**Status:** Implemented.

**Summary:** `PlanUI` class with `notify()`, `setStatus()`, `setWidget()`, `showPlanningWidget()` (checklist + file path), and `showReviewMenu()` (full plan content + three-option picker). Review integration in `PlanMode`: `/planit review` → menu → `buildAuto` (full execution, `[DONE:n]` tracking), `buildGuided` (writes enabled, plan as reference), `continueEditing` (back to planning with read-only tools). `buildMode` flag controls system prompt injection. No auto-menu on `agent_end` — review is always explicit.

**References:**
- `ctx.ui.select()` for menus ([extensions.md](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md#custom-ui))
- `ctx.ui.setWidget()` for plan display ([extensions.md](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md#extensioncontext))
- `pi.sendUserMessage()` for injection ([extensions.md](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md#input-events))

**Tier 1 — Unit tests** (`test/plan-mode.test.ts`): Plain vitest with mocked UI.
- `PlanUI.showReviewMenu()` — UI picker returns correct action codes
- `PlanUI.showReviewMenu()` — non-UI mode (`ctx.hasUI === false`) → auto returns `"buildAuto"`
- `PlanUI.showPlanningWidget()` — renders checklist + file path lines correctly
- Mode transition assertions (idle → planning → executing → idle)
- System prompt injection content (read-only + plan content)

---

## Phase 4: Bash Filtering ✅

**Status:** Implemented.

**Summary:** `BashFilter` class with SAFE_PATTERNS (file inspection, directory listing, text search, read-only git, process/info, package info, documentation) and DANGEROUS_PATTERNS (destructive commands, redirects, git mutations, package installation, file modification, network writes). Two-phase check: dangerous patterns always block, then safe patterns whitelist. Default-deny for unmatched commands.

**References:**
- Adapted from `@devkade/pi-plan`'s whitelist approach ([src/utils.ts](https://github.com/devkade/pi-plan/blob/main/src/utils.ts))

Tests covered by Phase 1's `BashFilter` unit tests. Phase 4 adds expanded patterns — the same test structure applies:
- Git mutation patterns blocked: `git commit`, `git push`, `git reset --hard`, `git rebase`, etc.
- Network write patterns blocked: `curl -X POST`, `wget -O`
- File modification patterns blocked: `chmod`, `chown`, `cp -r`
- Destructive patterns blocked: `shred`, `truncate`, `unlink`
- Package install patterns blocked: `yarn add`, `yarn remove`, `pip install`, `pip uninstall`

---

## Phase 5: Execution Commands ✅

**Status:** Implemented.

**Summary:** Extended `/planit` command with toggle semantics for executing phase (`executing → planning` via toggle/cancel, not just `idle ↔ planning`). `/planit resume` — `PlanFile.listPlans()` scans project plan directory, shows picker menu (filenames with timestamps, stripped for readability), loads selected plan into planning mode; non-UI fallback picks most recent. `/planit status` — shows mode state + live progress (`📋 n/total` during execution, checklist widget during planning). `/planit cancel` — `executing → planning` (read-only restore), `planning → idle`, idle is no-op. Widget shows checklist + file path; no separate `/planit-file` command.

**References:**
- `ctx.ui.select()` for menus ([extensions.md](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md#custom-ui))
- `ctx.ui.setStatus()` / `ctx.ui.setWidget()` for live progress updates

---

## Phase 6: Session Persistence & Edge Cases ✅

**Status:** Implemented. `restoreState` uses `ctx.sessionManager.getBranch()` to scan for the last `planit` custom entry and reconstructs phase, plan file (from persisted content or disk fallback), and captured tools. `session_tree` handler re-triggers `restoreState` on `/tree` navigation.

---

## Phase 7: Polish & Manual QA (1 hour)

**Goal:** Final verification of all flows end-to-end.

### 7.1 Manual Testing Checklist

See [TESTING.md](TESTING.md) for the refined, categorized checklist (47 items across 8 dependency groups, ~1.5h).

### 7.2 Common Issues to Watch For

1. **`pi.setActiveTools()` during agent loop** — Issue #4147. Only call in command handlers and lifecycle events.
2. **`tool_execution_start` before `tool_call` block** — Issue #2543. Cosmetic only, tool never executes.
3. **Menu option text overflow** — Issue #4435. Keep option labels < 80 chars.
4. **Plan file path resolution** — Use `ctx.cwd` relative paths, resolve with `path.resolve()`.
5. **Concurrent tool calls** — In parallel mode, `tool_call` may not see sibling results. Plan gating doesn't depend on this.
6. **Non-UI modes** — Always check `ctx.hasUI` before calling `ctx.ui.*` methods.

---

## Implementation Status

**Source files implemented:** `src/` (7 files, ~1100 lines total)
**Test files implemented:** `test/` (4 files)

| File | Status |
|------|--------|
| `src/index.ts` | ✅ Entry point |
| `src/types.ts` | ✅ Shared types |
| `src/path-utils.ts` | ✅ Path helpers (`agentPath()`) |
| `src/bash-filter.ts` | ✅ Bash whitelist/denylist |
| `src/plan-file.ts` | ✅ Plan file I/O, checklist parsing |
| `src/ui.ts` | ✅ TUI menus, status, widgets |
| `src/plan-mode.ts` | ✅ Core state machine, tool gating, system prompts |

| Test File | Status |
|-----------|--------|
| `test/bash-filter.test.ts` | ✅ BashFilter unit tests |
| `test/plan-file.test.ts` | ✅ PlanFile unit tests |
| `test/plan-mode.test.ts` | ✅ PlanMode / UI / lifecycle tests |
| `test/delete-plan.test.ts` | ✅ Delete/discard tests |

**Phases completed in source:**
- ✅ **Phase 1** — Skeleton, config, tool gating (`/planit on/off/toggle`, `--planit` flag, blocked tools, bash filtering)
- ✅ **Phase 2** — Plan file management (`write_plan` tool, checklist parsing, gitignore)
- ✅ **Phase 3** — Review flow (`/planit review` → menu → build auto/guided/continue editing)
- ✅ **Phase 4** — Bash filtering (SAFE/DANGEROUS pattern lists)
- ✅ **Phase 5** — Execution commands (`/planit` toggle semantics for executing, `/planit resume` picker, `/planit status` live progress, `/planit cancel` return-to-planning)
- ✅ **Phase 6** — Session persistence (`restoreState` reads `getBranch()` for `planit` custom entries, reconstructs phase/file/tools, `session_tree` handler for `/tree` navigation)
- ✅ **Phase 7** — Polish & manual QA (see [TESTING.md](TESTING.md))
- ✅ **Phase 8** — Delete plans (`/planit delete` picker + confirmation, `/planit discard` resets state)

---

## File Structure Summary

```
pi-planit/
├── package.json          # Extension manifest
├── tsconfig.json         # TypeScript config
├── vitest.config.ts      # Vitest configuration
├── TESTING.md            # Manual QA checklist (Phase 7)
├── PLAN.md               # This file — phased implementation plan
├── README.md             # Usage documentation
├── src/
│   ├── index.ts          # Entry point — creates PlanMode, registers with pi
│   ├── plan-mode.ts      # Core state machine: enter/exit, tool gating, system prompts
│   ├── plan-file.ts      # Plan file I/O, checklist parsing
│   ├── bash-filter.ts    # Read-only bash command whitelist/denylist
│   ├── ui.ts             # TUI menus, status, widgets
│   ├── path-utils.ts     # Path helpers (agentPath())
│   └── types.ts          # Shared types (ChecklistItem, PlanPhase, etc.)
└── test/
    ├── bash-filter.test.ts  # BashFilter unit tests
    ├── plan-file.test.ts    # PlanFile unit tests
    ├── plan-mode.test.ts    # PlanMode / UI / lifecycle tests
    └── delete-plan.test.ts  # Delete/discard tests
```

---

## Estimated Total Effort: 7–10 hours (all phases implemented)

| Phase | Description | Time |
|-------|-------------|------|
| 1 | Skeleton, config & tool gating | 1–2h |
| 2 | Plan file management | 1–2h |
| 3 | Approval flow | 2–3h |
| 4 | Bash filtering | 1h |
| 5 | Execution commands | ~1.5h |
| 6 | Persistence & edge cases | 1–2h |
| 7 | Polish & manual QA | ~1h |
| 8 | Delete plans | 0.5–1h |

---

## Key Dependencies on pi.dev API Stability

This extension depends on:
- `pi.setActiveTools()` — if this API changes or is restricted further, tool switching breaks
- `pi.registerTool()` — custom tool registration must remain stable
- `pi.on("tool_call", ...)` — blocking via `{ block: true }` must continue working
- `ctx.ui.select()` and `ctx.ui.input()` — TUI interaction must remain stable
- `pi.appendEntry()` — session persistence format must be stable
- `before_agent_start` system prompt injection — must continue chaining correctly

**Risk level:** Moderate. The extension touches core agent loops (tool gating, tool switching, system prompt injection). Any API breakage in these areas would require updates.

---

## Explore Later

Things worth investigating in future iterations — not for the current MVP:

- **YAML frontmatter** — Replace regex checkbox parsing with YAML frontmatter (`title`, `status`, `steps` array, `completed` count). Pros: structured, queryable, type-safe. Cons: requires YAML parser dep, harder for LLM to produce reliably, adds fragility if parsing fails. Could be a config option to let users choose their preferred format.
- **Plan file discovery** — Basic discovery is handled by `/planit resume` (project-scoped picker). Future: configurable plan directory, global search across projects, title-based search instead of filename.
- **Plan export** — Copy plan content to clipboard, send to chat, or write to arbitrary file path.
- **Plan versioning** — Track plan revisions over time.

---

## Phase 8: Delete Plans (0.5–1 hour)

**Status:** Implemented.

**Goal:** User can delete and discard plan files via `/planit delete` and `/planit discard`.

### Abstract

- **`/planit delete`** — Lists all project plans via picker (or non-UI fallback to most recent), prompts confirmation, removes the selected file. Uses `PlanFile.listPlans(cwd)` for discovery.
- **`/planit discard`** — Exits any active mode (planning/executing → idle), deletes the currently loaded plan file, and resets `planFile` to a fresh uninitialized state. Requires confirmation in UI mode.
- Both commands use `ctx.ui.confirm()` for safety in UI mode; non-UI mode proceeds without confirmation.
- `ctx.hasUI` checked before any `ctx.ui.*` call.
- **Reference:** `ctx.ui.confirm()` ([extensions.md](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md#custom-ui))

---

## Future Enhancements (Out of Scope)

- **Plan diff** — Show changes when plan is revised (inspired by plannotator)
- **Per-step approval** — Approve each step individually during execution
- **Multi-file plans** — Support multiple plan files
- **Plan sharing** — Export plan to clipboard or file path
- **Plan versioning** — Track plan revisions over time
- **Inline plan editing** — Edit plan file from within TUI
- **YAML frontmatter for state**
