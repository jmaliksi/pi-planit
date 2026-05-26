# Code Quality Audit

## 🔴 Critical / Logic Bugs

### 1. `ui.ts` — `UiContext` type is fabricated, not from the real API

The `UiContext` interface in `ui.ts` is hand-rolled and almost certainly doesn't
match the real `ExtensionContext` shape. The actual usage of `getUiContext()` in
`plan-mode.ts` uses a `as any` cast that returns an even more hand-rolled type
with a completely different signature for `select` (takes `title, options` vs
`title, options` but the types are duplicated and divergent). This means the
`PlanUI` class and `getUiContext()` are talking to each other over a type-less
bridge. If the real API changes, nothing catches it.

**Location:** `src/ui.ts`, `src/plan-mode.ts:getUiContext()`

---

### 2. `plan-mode.ts` — `getUiContext()` returns `ctx` cast as a completely different shape

```ts
private getUiContext(ctx: ExtensionContext) {
    const c = ctx as any;
    return c as { hasUI: boolean; ui: { ...very long inline type... } };
}
```

This is the worst anti-pattern in the codebase. It casts to `any` then casts
again to an inline type literal that duplicates the `UiContext` interface from
`ui.ts`. Three copies of the same shape. If any change, it silently breaks at
runtime.

**Location:** `src/plan-mode.ts`

---

### 3. `plan-mode.ts` — `(this.ui as any).setContext(ctx)` sprinkled everywhere

The UI context is set with `as any` in every event handler
(`tool_call`, `session_start`, `session_shutdown`, `turn_end`, `session_tree`).
This is because the event signatures from the SDK don't include the UI context,
so `PlanUI.setContext()` expects a different shape. Every single one silently
bypasses type checking. That's 6 instances of the same hack.

**Locations:** `src/plan-mode.ts` — `register()` event handler section

---

### 4. `plan-file.ts` — `updateFile()` uses text matching as a fallback for step lookup

```ts
const item = stepNum
  ? this.items.find((it) => it.step === stepNum)
  : this.items.find((it) => line.includes(it.text));
```

When a step line lacks `Step N:` prefix, it falls back to
`line.includes(it.text)` — a substring match. Two steps with overlapping text
(e.g., "Fix auth" and "Fix auth module") will resolve to the wrong item. This is
a correctness bug waiting to happen.

**Location:** `src/plan-file.ts:updateFile()`

---

### 5. `plan-file.ts` — `getWidgetLines()` produces identical text for completed and incomplete

```ts
const text = item.completed ? `[${item.step}] ${item.text}` : `[${item.step}] ${item.text}`;
```

The `text` variable is identical for both branches. The only difference is the
checkbox prefix. The ternary is dead code.

**Location:** `src/plan-file.ts:getWidgetLines()`

---

## 🟠 Structural Issues

### 6. `plan-mode.ts` is a 500+ line god class

It manages: config loading, tool gating, bash filtering, UI rendering, state
persistence, session lifecycle, system prompt injection, plan file I/O, command
routing, and agent execution coordination. The `register()` method alone is ~80
lines of command routing. This should be split into at least 3-4 classes (e.g.,
`PlanCommandRouter`, `PhaseManager`, `PlanPersistence`).

**Location:** `src/plan-mode.ts`

---

### 7. Command routing is a switch-if cascade in `register()`

```ts
if (raw.length === 0) { ... }
if (["on", "enable", "start"].includes(raw)) { ... }
if (["off", "disable", "stop", "exit"].includes(raw)) { ... }
```

This is fine for now but is a maintenance hazard. A proper command registry with
argument parsing would be cleaner. Not terrible, but brittle.

**Location:** `src/plan-mode.ts:register()`

---

### 8. `plan-mode.ts` — `PLAN_MODE_SYSTEM_PROMPT` is a 60-line template string

It's embedded directly in the source file as a multi-line template string. Any
change requires scrolling past 30 lines of code to see it. Consider extracting
to a separate file or constant.

**Location:** `src/plan-mode.ts`

---

### 9. `bash-filter.ts` — dangerous pattern `/>\\s*\\S/` is too broad

This blocks any `>` followed by a non-whitespace character. It would block things
like:

- `ls > /dev/null` — a legitimate pattern (though you'd want to block file writes
  in plan mode)
- `echo "a > b" | grep c` — string literals containing `>`
- `cat file | tee >(sort)` — process substitution

The safe patterns also have a problem: `/--help\\b/` and `\\s-h\\b` match
*anywhere* in the command, not just at the start. So
`some-weird-tool --help` passes as "safe" even though
`some-weird-tool` isn't whitelisted. The dangerous check runs first, so this is a
false-positive pass, not a security issue, but it means the "whitelist" isn't
actually a whitelist.

**Location:** `src/bash-filter.ts:DANGEROUS_PATTERNS`, `SAFE_PATTERNS`

---

## 🟡 Code Smells

### 10. `plan-file.ts` — `init()` writes then immediately re-reads

```ts
fs.writeFileSync(planPath, this.content, "utf-8");
this.content = fs.readFileSync(planPath, "utf-8");
```

There's no reason for the round-trip. `this.content` already has the template.
This is a defensive read that serves no purpose.

**Location:** `src/plan-file.ts:init()`

---

### 11. `plan-file.ts` — `constructor()` initializes `this.filePath = ""` but it's immediately overwritten by `init()`

```ts
constructor() {
    this.filePath = "";
}
```

The constructor is a no-op. The `filePath` default should just be inline:
`private filePath: string = "";`

**Location:** `src/plan-file.ts:constructor()`

---

### 12. `plan-mode.ts` — `buildAuto()` and `buildGuided()` are identical except for one string

```ts
private buildAuto(ctx) {
    this.buildMode = "auto";
    // ...same 5 lines...
}
private buildGuided(ctx) {
    this.buildMode = "guided";
    // ...same 5 lines...
}
```

These should be one method: `build(mode: "auto" | "guided")`.

**Location:** `src/plan-mode.ts`

---

### 13. `bash-filter.ts` — `SAFE_PATTERNS` has a duplicate `git show` entry

```ts
/^\s*git\s+(status|log|diff|show|branch|tag|rev-parse|...)\b/,
/^\s*git\s+show\b/,  // redundant — already covered above
```

**Location:** `src/bash-filter.ts:SAFE_PATTERNS`

---

### 14. `bash-filter.ts` — `du` and `df` are not read-only

`du` can be very expensive and block an AI agent session for a long time on large
repos. `df` is read-only but irrelevant to code work. Including them in the
whitelist is questionable.

**Location:** `src/bash-filter.ts:SAFE_PATTERNS`

---

### 15. `plan-mode.ts` — `onTurnEnd` does regex matching on raw message text

```ts
const doneMatches = text.match(/\[DONE:(\d+)\]/g);
```

This means the agent has to emit the exact magic string `[DONE:n]` in its
response. There's no structure here — it's grep-based protocol. Fragile and
invisible to type checking.

**Location:** `src/plan-mode.ts:onTurnEnd()`

---

### 16. `plan-mode.ts` — `persistState` serializes the full plan content into session entries

Every state transition writes the entire plan markdown to the session log. For a
50-step plan with detailed descriptions, this bloats the session memory. Consider
whether this is necessary or if just the file path + phase is sufficient.

**Location:** `src/plan-mode.ts:persistState()`

---

## 🟢 Minor

### 17. `types.ts` — `ToolBlockResult` is over-typed

```ts
export interface ToolBlockResult {
    block: true;
    reason: string;
}
```

This can just be `{ block: true; reason: string }`. No one extends this interface.

**Location:** `src/types.ts`

---

### 18. `plan-mode.ts` — `extractAssistantText` does the same thing twice in slightly different ways

The `typeof msg.content === "string"` branch and the array branch could be
unified. Not wrong, just verbose.

**Location:** `src/plan-mode.ts:extractAssistantText()`

---

### 19. Tests — `resumePlan` test uses `void` to silence a promise

```ts
void pm.resumePlan(ctx);
```

This is a test that doesn't actually verify anything. The `void` swallows errors.

**Location:** `test/plan-mode.test.ts`

---

### 20. `tsconfig.json` — `noUnusedLocals: true` is set but `plan-mode.ts` has unused parameters

```ts
async execute(_toolCallId: string, params: { content: string }, _signal: AbortSignal, _onUpdate: unknown, _ctx: ExtensionContext)
```

The underscore prefix convention should satisfy `noUnusedLocals`, but
`_onUpdate: unknown` is a bit loose — it could be typed properly.

**Location:** `tsconfig.json`, `src/plan-mode.ts`

---

## Resolved

| # | Issue | Fix |
|---|-------|-----|
| #5 | Dead ternary in `getWidgetLines` | Removed identical branches |
| #10 | Redundant `readFileSync` in `init()` | Removed round-trip read |
| #11 | No-op constructor in `PlanFile` | Inlined `filePath` default |
| #12 | Duplicate `buildAuto`/`buildGuided` | Merged into `build(mode)` |
| #13 | Duplicate `git show` regex | Removed redundant pattern |
| #17 | Over-typed `ToolBlockResult` | Inlined to type literal |
| #18 | Verbose `extractAssistantText` | Simplified branching |
| #19 | Silent `void` in test | Added proper assertion |

## Summary

| Severity   | Count |
|------------|-------|
| 🔴 Critical | 5     |
| 🟠 Structural | 9   |
| 🟡 Smells  | 6     |
| 🟢 Minor   | 4     |
