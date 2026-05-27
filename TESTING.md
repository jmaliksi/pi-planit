# Manual QA Checklist — pi-planit

> **Goal:** Final verification of all flows end-to-end.
> **Estimated total effort:** ~1.5 hours
> **Run groups in order** (A → B → C → D → E → F → G → H). Items within a group can be done in any order unless noted.

---

## A. Prerequisites (run these first)

| # | Check | How |
|---|-------|-----|
| A1 | Default `config.json` written on first load | Delete `~/.pi/agent/extensions/pi-planit/config.json`, start pi, verify file created with correct defaults |
| A2 | No `/planit-file` command exists | Run `/planit-file` → should be "command not found" (widget covers display) |

---

## B. Independent Checks (any order, no prerequisites)

These each test a single, self-contained concern.

| # | Check | How |
|---|-------|-----|
| B1 | Bash whitelist **allows**: `cat`, `head`, `ls`, `grep`, `rg`, `git status`, `git log`, `npm list`, `find`, `man`, `--help` | In plan mode, run each — should succeed |
| B2 | Bash whitelist **blocks**: `rm`, `git commit`, `npm install`, `cp -r`, `chmod`, `curl -X POST`, `wget -O`, `sudo`, file redirects (`>`) | In plan mode, run each — should be blocked with reason |
| B3 | Default blocked list blocks `edit`, `write`, `ast_rewrite` | In plan mode, try calling each tool — should be blocked |
| B4 | Menu option text < 80 chars (avoids Issue #4435) | Review `src/ui.ts` — options are "↺ Build (auto)", "✓ Build (guided)", "↻ Continue editing" — all ~18 chars ✅ |
| B5 | No crashes on empty plan | `/planit review` with no plan written → should say "No plan to review" |
| B6 | No crashes on malformed session entries | Restart pi with a session containing unexpected data in `getBranch()` |

---

## C. Mode Toggle → Config

| # | Check | Prerequisite | Verified |
|---|-------|-------------|---|
| C1 | `/planit` in idle → enters planning mode, switches to read-only tools, shows "⏸ plan" status | A1 | o |
| C2 | `/planit` in planning → exits plan mode, restores original tools, shows "Plan mode disabled" | C1 | o |
| C3 | `/planit toggle` (same as bare `/planit`) toggles idle ↔ planning | C1→C2 | o |
| C4 | `/planit on` / `/planit enable` → enters planning | C1 | o |
| C5 | `/planit off` / `/planit disable` / `/planit stop` / `/planit exit` → exits planning | C2 | o |
| C6 | `--planit` flag → enters planning mode on session start (no `/planit` command needed) | A1 | o |
| C7 | Configurable tools: adding a tool name to `allowedTools` in config includes it in plan mode | C1 | ? |

---

## D. Plan Creation → Display

| # | Check | Prerequisite | Verified |
|---|-------|-------------|---|
| D1 | Agent calls `write_plan` with content → file created | C1 (must be in planning mode) | o |
| D2 | Plan file created at `~/.pi/agent/plans/--project-path--/<name-timestamp>.md` | D1 | o |
| D3 | Checklist parsing correctly identifies `- [ ]` and `- [x]` items with step numbers | D1 | o |
| D4 | Widget shows checklist (☐/☑ prefix) + file path during planning | D1 | o |
| D5 | `derivePlanName()` produces 3–5 word hyphenated filename with timestamp | Unit test already covers this | o |

---

## E. Review Flow

| # | Check | Prerequisite | Verified |
|---|-------|-------------|---|
| E1 | `/planit review` with no plan → "No plan to review" | None | o |
| E2 | `/planit review` with plan → shows plan content in scrollable editor + build mode picker | D4 | o |
| E3 | "↺ Build (auto)" → enters executing phase, full execution, `[DONE:n]` tracking in system prompt | E2 | x |
| E4 | "✓ Build (guided)" → enters executing, writes enabled, plan as reference (not hard constraint) | E2 | o |
| E5 | "↻ Continue editing" → back to planning mode, read-only tools restored | E2 | need to hide checkboxes |
| E6 | No auto-menu on `agent_end` (review must be explicit via `/planit review`) | None | o |
| E7 | Non-UI mode (`ctx.hasUI === false`) → auto-approves with "buildAuto" | E2 | ? |

---

## F. Execution & Progress

| # | Check | Prerequisite |
|---|-------|-------------|
| F1 | Status shows `📋 n/total` during auto build, updated each turn via `[DONE:n]` extraction | E3 |
| F2 | Widget updates with ☑ on completed steps during execution | E3 |
| F3 | When all steps complete → status clears, "All plan steps complete" notification, returns to idle | E3 |
| F4 | `/planit status` in planning → shows "Plan mode: ON (read-only)" + widget | C1 |
| F5 | `/planit status` in executing → shows progress `📋 n/total` | E3 |
| F6 | `/planit status` in idle → shows "Plan mode: OFF" | C2 |

---

## G. Resume, Cancel, Delete

| # | Check | Prerequisite | Verified |
|---|-------|-------------|---|
| G1 | `/planit resume` with no plans → "No plans found" | None | o |
| G2 | `/planit resume` with plans → picker menu, loads selected plan into planning | D1 (has at least one plan) | o |
| G3 | `/planit cancel` in executing → returns to planning, read-only tools | E3 | o |
| G4 | `/planit cancel` in planning → exits plan mode (same as `off`) | C1 | o |
| G5 | `/planit cancel` in idle → "Nothing to cancel" | C2 | o |
| G6 | `/planit delete` → plan picker → confirmation dialog → file removed | D1 | o |
| G7 | `/planit delete` with no plans → "No plans found" | None | o |
| G8 | `/planit discard` → exits mode, deletes current plan, resets state | D1 | o |

---

## H. Edge Cases & Robustness

| # | Check | How | Verified |
|---|-------|-----|---|
| H1 | Session persistence: exit plan mode mid-execution → restart → state restored with progress intact | E3, then kill pi, restart | |
| H2 | `session_tree` handler: navigate `/tree` → state restored | E3 or C1 | x |
| H3 | Works in `-p` (print) mode → non-UI fallback (auto-approve in review, auto-resume latest plan) | Test with headless invocation | |
| H4 | Toggle while already in same mode → idempotent notification ("Plan mode is already enabled") | C1, run `/planit` again | |
| H5 | `/planit review` while executing → should navigate to review first (executing → idle path via resume/cancel) | E3 | |
| H6 | Concurrent tool calls during `tool_call` event → gating still works correctly | E3, observe tool call log | |

---

## Known Issues to Watch For

1. **`pi.setActiveTools()` during agent loop** — Issue #4147. Only call in command handlers and lifecycle events.
2. **`tool_execution_start` before `tool_call` block** — Issue #2543. Cosmetic only, tool never executes.
3. **Menu option text overflow** — Issue #4435. Keep option labels < 80 chars.
4. **Plan file path resolution** — Use `ctx.cwd` relative paths, resolve with `path.resolve()`.
5. **Concurrent tool calls** — In parallel mode, `tool_call` may not see sibling results. Plan gating doesn't depend on this.
6. **Non-UI modes** — Always check `ctx.hasUI` before calling `ctx.ui.*` methods.

---

## Effort Summary

| Group | Items | Effort |
|-------|-------|--------|
| A. Prerequisites | 2 | ~5 min |
| B. Independent | 6 | ~15 min |
| C. Mode Toggle | 7 | ~15 min |
| D. Plan Creation | 5 | ~10 min |
| E. Review Flow | 7 | ~15 min |
| F. Execution | 6 | ~10 min |
| G. Resume/Cancel/Delete | 8 | ~15 min |
| H. Edge Cases | 6 | ~20 min |
| **Total** | **47 items** | **~1.5h** |
