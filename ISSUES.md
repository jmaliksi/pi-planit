# Issues — pi-planit

> **Goal:** Track bugs, missing behaviors, and gaps found during extension code review against [pi.dev extension docs](https://pi.dev/docs/extensions).
> **Last audited:** 2026-05-26

---

## 🔴 Critical — Agent Loop Stalls

### Issue 1: `continueEditing` transitions to planning but never resumes the agent
- **Location:** `src/plan-mode.ts:499`
- **Flow:** `/planit review` → "↻ Continue editing" → `continueEditing()` sets `phase = "planning"`, restores read-only tools
- **Problem:** This path is called from `onAgentEnd`, meaning the agent has already finished its turn. After the dialog closes, the agent sits idle — no new turn is triggered. Same bug class as the auto-build `sendUserMessage()` fix.
- **Per docs:** The `sendUserMessage` API is the documented way to trigger a new turn from an extension context. The agent loop doesn't auto-resume after `ui.select()`/`ui.editor()` dialogs.
- **Fix:** After setting up planning UI, call:
  ```ts
  this.pi.sendUserMessage(
    "The plan is ready for editing. Explore the codebase and revise the plan.",
    { deliverAs: "followUp" },
  );
  ```

### Issue 2: `resumePlan` loads a plan but doesn't start a new agent turn
- **Location:** `src/plan-mode.ts:567`
- **Flow:** `/planit resume` → picker → loads plan file → sets `phase = "planning"` → shows widget
- **Problem:** The `session_tree` handler fires when the user navigates `/tree`. After navigation, the agent is idle. The restored planning state is invisible to the agent unless a new turn is triggered. The user sees the widget but the agent does nothing until they type something.
- **Per docs:** `before_agent_start` is the right hook for injecting context, but the agent must first enter a turn.
- **Fix:** After restoring planning state, call:
  ```ts
  this.pi.sendUserMessage(
    "Plan restored: " + title,
    { deliverAs: "followUp" },
  );
  ```

---

## 🟠 High — Missing UI / State Visibility

### Issue 3: `/planit cancel` from executing has no widget/status update
- **Location:** `src/plan-mode.ts:627`
- **Flow:** `/planit cancel` while executing → `cancelPlan()` sets `phase = "planning"`, restores tools
- **Problem:** Unlike `continueEditing()`, `cancelPlan()` doesn't call `showPlanningWidget()` or `setStatus()`. The user gets a notification but the footer widget still shows the old `📋 n/total` status, and the working indicator may linger.
- **Per docs:** `setStatus(key, text | undefined)` and `setWidget(key, content)` should be used to update the footer.

### Issue 4: `exitPlanning` clears status to `undefined` but doesn't clear the widget
- **Location:** `src/plan-mode.ts:203`
- **Flow:** `/planit off` → `exitPlanning()` → `setStatus(undefined)`
- **Problem:** The widget (`planit-todos`) is never cleared. If the user was executing a plan with a checklist widget, that stale widget remains visible after exiting plan mode.
- **Per docs:** `setWidget(key, undefined)` clears the widget.

### Issue 5: `resumePlan` (no-UI fallback) doesn't restore the widget/status
- **Location:** `src/plan-mode.ts:536`
- **Flow:** `/planit resume` with `ctx.hasUI === false` → loads plan → enters planning
- **Problem:** In print/RPC mode, the code sets `phase = "planning"` and calls `showPlanningWidget` but passes `hasUI: false` so it's a no-op. That's fine, but the agent is never kicked off to process the loaded plan. Same root cause as Issue 2.

---

## 🟠 High — `before_agent_start` Edge Case

### Issue 6: Executing phase with no steps returns `undefined`, silently doing nothing
- **Location:** `src/plan-mode.ts:269-272`
- **Flow:** Agent is in executing phase → next turn starts → `onBeforeAgentStart` checks `this.planFile.hasSteps()` → if `false`, returns `undefined`
- **Problem:** The system prompt injected by this handler contains the approved plan, step instructions, and `[DONE:n]` requirements. Without it, the agent has no idea it's supposed to be executing anything. It will just respond normally, ignore the plan, and the user sees no `[DONE:n]` markers. This is a silent failure path.
- **Trigger:** If the agent deletes or truncates the plan file while executing, or if `parseChecklist()` fails to match the step format.
- **Fix:** When `phase === "executing"` and `!planFile.hasSteps()`, return an error prompt like:
  ```
  The approved plan has no steps. Review the plan file and either create steps or cancel execution.
  ```
  Or transition to a more appropriate phase (e.g., idle).

---

## 🟡 Medium — Event Handling Gaps

### Issue 7: `tool_execution_start` / `tool_execution_end` events not subscribed
- **Location:** `src/plan-mode.ts:772-778` (registration section)
- **Problem:** The extension subscribes to `tool_call` but not to `tool_execution_start` or `tool_execution_end`. If the user wants to track tool execution progress during auto-build, they can't. This is minor since `turn_end` already tracks `[DONE:n]`, but it means the extension can't distinguish between a tool call being preflighted vs actually executing.
- **Per docs:** These events are available and fire before/after each tool execution.

### Issue 8: `input` event not subscribed
- **Location:** `src/plan-mode.ts`
- **Problem:** The extension doesn't subscribe to the `input` event. This means it can't intercept or transform user messages before the agent sees them. For example, if the user types `/planit` during agent execution, the current code checks `this.isExecuting` in the command handler, but an `input` handler could provide earlier interception (e.g., auto-cancel, or transforming `/planit` into a custom message).
- **Per docs:** `input` fires after extension commands are checked but before skill/template expansion. Returning `{ action: "handled" }` skips the agent entirely.

---

## 🟡 Medium — State Management Issues

### Issue 9: `persistState` serializes `restoredTools` but `restoreState` doesn't use it
- **Location:** `src/plan-mode.ts:381` vs `389-419`
- **Problem:** `persistState` writes `restoredTools` to the session entry. `restoreState` ignores the persisted value and calls `this.pi.getAllTools()` to re-capture the current tool set. This is actually a conscious design (stale persisted tools could differ from current session tools), but it means `restoredTools` in the persisted state is dead data. The comment in `restoreState` says "Capture the current session's tool set (not stale persisted ones)" — so this is intentional, but misleading.
- **Severity:** Low. No functional bug, just confusing.

### Issue 10: `reviewPending` flag has a race condition
- **Location:** `src/plan-mode.ts:107, 359, 468`
- **Problem:** `reviewPending` is set to `true` in `reviewPlan()` and cleared in `onAgentEnd()`. But `onAgentEnd` fires for *every* agent end, not just the one after writing a plan. If the agent ends a turn for any other reason (e.g., user sent a follow-up, or the agent hit max turns), `reviewPending` would be cleared prematurely. If the agent then writes a plan in a subsequent turn, `reviewPending` would be `false` so `onAgentEnd` would return early and never show the review menu.
- **Trigger:** User types a follow-up message while plan is being written.
- **Fix:** Set `reviewPending` closer to the event that triggers plan writing (e.g., in `write_plan` tool execution, or check `planFile.hasSteps()` in `onAgentEnd` instead of relying on the flag).

---

## 🟢 Low — Cosmetic / DX

### Issue 11: Non-UI mode auto-approves with `buildAuto` instead of notifying user
- **Location:** `src/ui.ts:50-52`
- **Problem:** In print/RPC mode (`hasUI === false`), `showReviewMenu()` returns `buildAuto` and calls `notify()` — which is also a no-op in non-UI mode. So the user gets no feedback at all that the plan was auto-approved. They just see the agent start executing.
- **Per docs:** In non-UI mode, the extension should at minimum log to console. Currently it only calls `this.ui.notify()` which silently returns.

### Issue 12: `showReviewMenu` doesn't show the plan in non-UI mode
- **Location:** `src/ui.ts:48-53`
- **Problem:** In non-UI mode, the plan content is never shown to the user. It just auto-approves. In a headless context, there's no way to review the plan.
- **Suggestion:** Log the plan content to stdout or `console.log` before auto-approving.

### Issue 13: Widget key `"planit-todos"` is hardcoded
- **Location:** `src/ui.ts:19`
- **Problem:** The widget key is hardcoded. If multiple instances of the extension were somehow loaded, they'd conflict. Minor, since there's only one instance.

---

## Summary Matrix

| # | Severity | Category | Issue | Location |
|---|----------|----------|-------|----------|
| 1 | 🔴 Critical | Agent stall | `continueEditing` doesn't resume agent | plan-mode.ts:499 |
| 2 | 🔴 Critical | Agent stall | `resumePlan` doesn't resume agent | plan-mode.ts:567 |
| 3 | 🟠 High | Missing UI | `cancelPlan` doesn't set widget/status | plan-mode.ts:627 |
| 4 | 🟠 High | Missing UI | `exitPlanning` doesn't clear widget | plan-mode.ts:203 |
| 5 | 🟠 High | Agent stall | `resumePlan` non-UI doesn't trigger agent | plan-mode.ts:536 |
| 6 | 🟠 High | Silent fail | Executing with no steps → no prompt injected | plan-mode.ts:269 |
| 7 | 🟡 Medium | Missing event | No `tool_execution_start`/`end` subscription | plan-mode.ts:772 |
| 8 | 🟡 Medium | Missing event | No `input` event subscription | plan-mode.ts |
| 9 | 🟡 Medium | Dead data | `persistState` writes unused `restoredTools` | plan-mode.ts:381 |
| 10 | 🟡 Medium | Race condition | `reviewPending` cleared prematurely | plan-mode.ts:107 |
| 11 | 🟢 Low | UX | Non-UI auto-approve silently does nothing | ui.ts:50 |
| 12 | 🟢 Low | UX | Non-UI mode never shows plan content | ui.ts:48 |
| 13 | 🟢 Low | DX | Hardcoded widget key | ui.ts:19 |

## Priority Ordering for Fixes

1. **Issues 1, 2** — Same root cause as the auto-build fix. Add `sendUserMessage()` calls to resume the agent.
2. **Issue 6** — Prevents execution from working at all when steps are missing.
3. **Issues 3, 4** — UI inconsistency that confuses users.
4. **Issue 10** — Race condition that could silently break the review flow.
5. **Issues 11, 12** — Non-UX improvements for headless/CI use cases.
