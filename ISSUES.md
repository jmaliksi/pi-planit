# Issues — pi-planit

> **Goal:** Track bugs, missing behaviors, and gaps found during extension code review against [pi.dev extension docs](https://pi.dev/docs/extensions).
> **Last audited:** 2026-05-27

---

## 🟠 High — State Restoration

### Issue 2: `resumePlan` hardcodes to `planning` instead of restoring saved state
- **Location:** `src/plan-mode.ts:536-610`
- **Status:** ✅ **Fixed** (2026-05-27)
- **Flow:** `/planit resume` → picker or no-UI fallback → loads plan file → restores saved phase → shows widget
- **Problem:** `resumePlan()` always resumed in `planning` phase regardless of what state was saved (e.g., `planned`, `executing`).
- **Fix:** Both the no-UI and UI picker branches now scan session entries for a persisted `planit` custom type, extract `data.phase`, and restore the correct phase. For `planning`, read-only tools are set; for `planned`/`executing`, the full restored tool set is restored.

### Issue 5: `resumePlan` (no-UI fallback) has same root cause as Issue 2
- **Location:** `src/plan-mode.ts:536-555`
- **Status:** ✅ **Fixed** (2026-05-27)
- **Flow:** `/planit resume` with `ctx.hasUI === false` → loads plan → restores saved phase → shows widget
- **Problem:** The no-UI branch loads the plan and sets `phase = "planning"` regardless of what was saved. Same root cause as Issue 2.
- **Fix:** Fixed as part of Issue 2 — the no-UI branch now extracts `data.phase` from the session entry and restores the correct phase.

---

## 🟠 High — Missing UI / State Visibility

### Issue 3: `/planit cancel` from executing has no widget/status update
- **Status:** ✅ **Fixed** (2026-05-27)
- **Flow:** `/planit cancel` while executing → `cancelPlan()` sets `phase = "planning"`, restores tools
- **Problem:** Unlike `continueEditing()`, `cancelPlan()` doesn't call `showPlanningWidget()` or `setStatus()`. The user gets a notification but the footer widget still shows the old `📋 n/total` status, and the working indicator may linger.
- **Per docs:** `setStatus(key, text | undefined)` and `setWidget(key, content)` should be used to update the footer.
- **Fix:** Added `setWidget(undefined)` before `showPlanningWidget()` in `cancelPlan()` executing branch.

### Issue 3b: Checkbox widget not dismissed on mode transitions (collective)
- **Status:** ✅ **Fixed** (2026-05-27)
- **Scope:** Checkbox widget (`planit-todos`) was not dismissed during **any** mode transition away from executing/planning.
- **Affected methods:**
  - `exitPlanning()` — planning → idle (`/planit off`)
  - `onTurnEnd()` — executing → idle (all steps complete)
  - `cancelPlan()` — executing → planning (`/planit cancel`)
  - `resumePlan()` non-UI — executing → planning
  - `resumePlan()` UI — executing → planning
  - `discardPlan()` — executing → idle
- **Fix:** Added `setWidget(undefined, ctx.hasUI, ctx.ui)` at each transition point before any subsequent widget/status call.
- **Location:** `src/plan-mode.ts:627`
- **Flow:** `/planit cancel` while executing → `cancelPlan()` sets `phase = "planning"`, restores tools
- **Problem:** Unlike `continueEditing()`, `cancelPlan()` doesn't call `showPlanningWidget()` or `setStatus()`. The user gets a notification but the footer widget still shows the old `📋 n/total` status, and the working indicator may linger.
- **Per docs:** `setStatus(key, text | undefined)` and `setWidget(key, content)` should be used to update the footer.

### Issue 4: `exitPlanning` clears status to `undefined` but doesn't clear the widget
- **Status:** ✅ **Fixed** (2026-05-27)
- **Flow:** `/planit off` → `exitPlanning()` → `setStatus(undefined)`
- **Problem:** The widget (`planit-todos`) is never cleared. If the user was executing a plan with a checklist widget, that stale widget remains visible after exiting plan mode.
- **Per docs:** `setWidget(key, undefined)` clears the widget.
- **Location:** `src/plan-mode.ts:203`
- **Flow:** `/planit off` → `exitPlanning()` → `setStatus(undefined)`
- **Problem:** The widget (`planit-todos`) is never cleared. If the user was executing a plan with a checklist widget, that stale widget remains visible after exiting plan mode.
- **Per docs:** `setWidget(key, undefined)` clears the widget.

---

## 🟠 High — `before_agent_start` Edge Case

### Issue 6: Executing phase with no steps — agent should stop
- **Location:** `src/plan-mode.ts:269-272`
- **Flow:** Agent is in executing phase → next turn starts → `onBeforeAgentStart` checks `this.planFile.hasSteps()` → if `false`, returns `undefined`
- **Problem:** Without a system prompt, the agent has no idea it's supposed to be executing anything. It will just respond normally and ignore the plan.
- **Trigger:** If the agent deletes or truncates the plan file while executing, or if `parseChecklist()` fails to match the step format.
- **Fix:** When `phase === "executing"` and `!planFile.hasSteps()`, transition to `idle` (stop execution). No system prompt is needed — the agent should simply stop executing a plan with no steps.

---

## 🟡 Medium — Event Handling Gaps

### Issue 7: `tool_execution_start` / `tool_execution_end` events not subscribed
- **Location:** `src/plan-mode.ts:772-778` (registration section)
- **Status:** ⏸ Irrelevant for now
- **Problem:** The extension subscribes to `tool_call` but not to `tool_execution_start` or `tool_execution_end`. Minor since `turn_end` already tracks `[DONE:n]`.
- **Note:** Can be added later if tool execution granularity is needed.

### Issue 8: `input` event not subscribed
- **Location:** `src/plan-mode.ts`
- **Status:** ⏸ Irrelevant for now
- **Problem:** The extension doesn't subscribe to the `input` event. Could enable earlier interception of user messages (e.g., auto-cancel on `/planit` during execution).
- **Note:** Can be added later when this pattern is needed.

---

## 🟡 Medium — State Management Issues

### Issue 9: `persistState` serializes `restoredTools` but `restoreState` doesn't use it
- **Location:** `src/plan-mode.ts:381` vs `389-419`
- **Problem:** `persistState` writes `restoredTools` to the session entry. `restoreState` ignores the persisted value and calls `this.pi.getAllTools()` to re-capture the current tool set. The `restoredTools` in the persisted state is dead data.
- **Severity:** Low. No functional bug.
- **Fix:** Remove `restoredTools` from `persistState()` serialization — don't serialize captured tools on session save.

### Issue 10: `reviewPending` flag has a race condition
- **Location:** `src/plan-mode.ts:107, 359, 468`
- **Status:** ✅ **Fixed** (2026-05-28)
- **Problem:** `reviewPending` is set to `true` in `reviewPlan()` and cleared in `onAgentEnd()`. But `onAgentEnd` fires for *every* agent end, not just the one after writing a plan. If the agent ends a turn for any other reason (e.g., user sent a follow-up, or the agent hit max turns), `reviewPending` would be cleared prematurely. If the agent then writes a plan in a subsequent turn, `reviewPending` would be `false` so `onAgentEnd` would return early and never show the review menu.
- **Trigger:** User types a follow-up message while plan is being written.
- **Fix:** Replaced the `reviewPending` flag with a direct check of `planFile.hasSteps()` in `onAgentEnd()`. If steps exist, show the review menu regardless of the flag.

---

## 🟢 Low — Cosmetic / DX

### Issue 11: Non-UI mode auto-approves with `buildAuto` instead of notifying user
- **Location:** `src/ui.ts:50-52`
- **Status:** ⚠️ Partially acceptable
- **Problem:** In print/RPC mode (`hasUI === false`), `showReviewMenu()` returns `buildAuto` and calls `notify()` — which is a no-op in non-UI mode. The user gets no feedback that the plan was auto-approved.
- **Fix:** Log to console instead of calling `this.ui.notify()` in non-UI mode. Simple one-liner.

### Issue 12: `showReviewMenu` doesn't show the plan in non-UI mode
- **Location:** `src/ui.ts:48-53`
- **Status:** 📝 Design issue to solve later
- **Problem:** In non-UI mode, the plan content is never shown to the user. It just auto-approves. In a headless context, there's no way to review the plan.
- **Note:** We're halfway there — the plan is a literal file on disk so headless users can use their builtin editor to view it. What's missing is better controls for approving/denying the plan in headless mode. This should be addressed when designing the headless approval flow.

### Issue 13: Widget key `"planit-todos"` is hardcoded
- **Location:** `src/ui.ts:19`
- **Status:** ✅ Acceptable — only one extension instance runs per session, so no conflict risk.

---

## Summary Matrix

| # | Severity | Category | Issue | Location | Status |
|---|----------|----------|-------|----------|--------|
| 2 | 🟠 High | State restoration | `resumePlan` hardcodes to `planning` | plan-mode.ts:536-610 | ✅ Fixed |
| 5 | 🟠 High | State restoration | Same root cause as Issue 2 | plan-mode.ts:536-555 | ✅ Fixed |
| 3 | 🟠 High | Missing UI | `cancelPlan` doesn't set widget/status | plan-mode.ts:627 | ✅ Fixed |
| 3b | 🟠 High | Missing UI | Checkbox widget not dismissed on mode transitions | plan-mode.ts (multiple) | ✅ Fixed |
| 4 | 🟠 High | Missing UI | `exitPlanning` doesn't clear widget | plan-mode.ts:203 | ✅ Fixed |
| 6 | 🟠 High | Silent fail | Executing with no steps → agent should stop | plan-mode.ts:269 | ⏳ |
| 7 | 🟡 Medium | Missing event | No `tool_execution_start`/`end` subscription | plan-mode.ts:772 | ⏸ Irrelevant for now |
| 8 | 🟡 Medium | Missing event | No `input` event subscription | plan-mode.ts | ⏸ Irrelevant for now |
| 9 | 🟡 Medium | Dead data | `persistState` writes unused `restoredTools` | plan-mode.ts:381 | ⏳ |
| 10 | 🟡 Medium | Race condition | `reviewPending` cleared prematurely | plan-mode.ts:107 | ✅ Fixed |
| 11 | 🟢 Low | UX | Non-UI auto-approve silently does nothing | ui.ts:50 | ⚠️ Partially acceptable |
| 12 | 🟢 Low | UX | Non-UI mode never shows plan content | ui.ts:48 | 📝 Design issue later |
| 13 | 🟢 Low | DX | Hardcoded widget key | ui.ts:19 | ✅ Acceptable |

## Priority Ordering for Fixes

1. **Issue 6** — When executing phase has no steps, transition to `idle` (stop execution).
2. **Issue 9** — Remove `restoredTools` from `persistState()` serialization.
4. **Issue 11** — Log to console in non-UI mode instead of calling `ui.notify()`.
5. **Issue 12** — Design issue: add headless approval/denial controls (deferred).

> **Fixed:** Issues 2, 5 (resumePlan restores saved phase, 2026-05-27).
> **Fixed:** Issues 3, 3b, 4 (checkbox widget dismissal across all mode transitions, 2026-05-27).
> **Fixed:** Issue 10 (`reviewPending` race condition, 2026-05-28).
> **Deferred:** Issues 7, 8 (irrelevant for now).
> **Acceptable:** Issues 12 (design issue), 13 (single instance).
