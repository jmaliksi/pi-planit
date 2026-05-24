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

## Phase 1: Skeleton & Tool Gating (1–2 hours)

**Goal:** A working extension that toggles plan mode and blocks write tools.

### 1.1 Project Structure

```
pi-planit/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts          # Extension entry point
│   ├── plan-mode.ts      # Core state machine & gating
│   ├── plan-file.ts      # Plan file creation & parsing
│   ├── bash-filter.ts    # Read-only bash command filtering
│   ├── ui.ts             # TUI menus & status updates
│   └── types.ts          # Shared type definitions
└── README.md
```

### 1.2 Package Manifest (`package.json`)

```json
{
  "name": "pi-planit",
  "version": "0.1.0",
  "description": "Headless plan mode for Pi — file-based planning with TUI approval",
  "pi": {
    "extensions": ["./src/index.ts"]
  },
  "dependencies": {},
  "devDependencies": {
    "@earendil-works/pi-coding-agent": "latest",
    "@earendil-works/pi-ai": "latest",
    "@earendil-works/pi-tui": "latest",
    "typebox": "latest",
    "typescript": "latest"
  }
}
```

**Reference:** Extension locations ([extensions.md](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md#extension-locations))

### 1.3 Extension Entry Point (`src/index.ts`)

```typescript
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { PlanMode } from "./plan-mode";

export default function (pi: ExtensionAPI): void {
  const planMode = new PlanMode(pi);

  // Register commands, tools, flags, shortcuts
  planMode.register(pi);
}
```

**Reference:** Writing an extension ([extensions.md](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md#writing-an-extension))

### 1.4 Core State Machine (`src/plan-mode.ts`)

```typescript
import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { PlanFile } from "./plan-file";
import { BashFilter } from "./bash-filter";
import { PlanUI } from "./ui";

export type PlanPhase = "idle" | "planning" | "review" | "executing";

export interface PlanModeConfig {
  /** Tool names allowed in plan mode (intersection with available tools) */
  allowedTools: string[];
  /** Tools that are always blocked regardless of allowedTools */
  blockedTools?: string[];
}

export class PlanMode {
  private phase: PlanPhase = "idle";
  private restoredTools: string[] | null = null;
  private planFile: PlanFile;
  private bashFilter: BashFilter;
  private ui: PlanUI;
  private config: PlanModeConfig;

  constructor(private pi: ExtensionAPI) {
    this.planFile = new PlanFile();
    this.bashFilter = new BashFilter();
    this.ui = new PlanUI(pi);
    this.config = this.loadConfig();
  }

  // ── Configuration ──────────────────────────────────────────────────
  //
  // Load extension config from ~/.pi/agent/extensions/pi-planit/config.json
  // Falls back to defaults if config doesn't exist or is invalid.
  // This lets users add their MCP tools, web search, and other extensions
  // to the plan mode tool set.
  //
  // NOTE: Config path is read once at construction. For hot-reload,
  // call loadConfig() explicitly or listen for file changes.

  private loadConfig(): PlanModeConfig {
    const defaultConfig: PlanModeConfig = {
      allowedTools: [
        "read",
        "bash",
        "grep",
        "find",
        "ls",
        "lsp",
        "ast_search",
        "web_search",
        "fetch_content",
        "get_search_content",
        "code_search",
      ],
      blockedTools: ["edit", "write", "ast_rewrite"],
    };

    try {
      const configDir = path.join(
        process.env.HOME ?? process.env.USERPROFILE ?? "/",
        ".pi",
        "agent",
        "extensions",
        "pi-planit",
      );
      const configPath = path.join(configDir, "config.json");

      if (!fs.existsSync(configPath)) {
        // No config file — write defaults so the directory structure exists
        fs.mkdirSync(configDir, { recursive: true });
        fs.writeFileSync(
          configPath,
          JSON.stringify(defaultConfig, null, 2),
          "utf-8",
        );
        return defaultConfig;
      }

      const raw = fs.readFileSync(configPath, "utf-8");
      const parsed = JSON.parse(raw) as PlanModeConfig;

      // Merge with defaults for any missing fields
      return {
        allowedTools: parsed.allowedTools ?? defaultConfig.allowedTools,
        blockedTools: parsed.blockedTools ?? defaultConfig.blockedTools,
      };
    } catch (err) {
      console.error(`Planit: Failed to load config, using defaults: ${err}`);
      return defaultConfig;
    }
  }

  /** Get the current effective config (useful for hot-reload or testing) */
  getConfig(): PlanModeConfig {
    return this.config;
  }

  get isPlanMode(): boolean {
    return this.phase === "planning";
  }

  get isExecuting(): boolean {
    return this.phase === "executing";
  }

  // ── Tool Switching ─────────────────────────────────────────────────
  //
  // NOTE: PlanUI is defined in Phase 3.1 (ui.ts). This scaffold calls
  // ui.notify(), ui.setStatus(), ui.setWidget() — all exist in the
  // Phase 3 definition. Keep this dependency in mind when implementing.
  //
  // Reference: pi.setActiveTools() switches the LLM's visible tool set.
  // See: https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md#tool-events
  //
  // WARNING: Issue #4147 notes that `pi.setActiveTools()` silently fails
  // if called during a running agent loop. We only call it in command
  // handlers (user-initiated) and lifecycle events, never mid-turn.
  // See: https://github.com/earendil-works/pi/issues/4147

  private captureCurrentTools(ctx: ExtensionContext): void {
    // Reference: pi.getAllTools() returns { name, description, parameters }
    // Issue #4265 adds label/execute in newer versions
    // See: https://github.com/earendil-works/pi/issues/4265
    const currentTools = this.pi.getAllTools().map(t => t.name);
    this.restoredTools = currentTools.length > 0 ? [...currentTools] : null;
  }

  private getReadOnlyTools(): string[] {
    // Intersection of config-allowed tools and actually available tools
    // This lets users add MCP tools to the allowed list without breaking
    // if those tools aren't registered yet.
    const allTools = this.pi.getAllTools().map(t => t.name);
    return this.config.allowedTools.filter(t => allTools.includes(t));
  }

  private enterPlanning(ctx: ExtensionContext, userSummary: string = "untitled"): void {
    if (this.phase === "planning") {
      this.ui.notify("Plan mode is already enabled.");
      return;
    }

    this.captureCurrentTools(ctx);

    const readOnlyTools = this.getReadOnlyTools();
    if (readOnlyTools.length === 0) {
      this.ui.notify("No read-only tools available.", "error");
      return;
    }

    // Switch to read-only tools
    this.pi.setActiveTools(readOnlyTools);

    this.phase = "planning";
    // NOTE: userSummary comes from command arg (e.g., /planit refactor auth)
    // or last user message. Falls back to "untitled" for now.
    this.planFile.init(ctx.cwd, userSummary);
    this.ui.setStatus("⏸ plan");
    this.ui.notify("Plan mode enabled (read-only).");
    this.persistState(ctx);
  }

  private exitPlanning(ctx: ExtensionContext, resetProgress = false): void {
    if (this.phase !== "planning") return;

    this.phase = "idle";

    // Restore original tools
    if (this.restoredTools && this.restoredTools.length > 0) {
      this.pi.setActiveTools(this.restoredTools);
    }
    this.restoredTools = null;

    this.ui.setStatus(undefined);
    this.ui.notify("Plan mode disabled. Tools restored.");
    this.persistState(ctx);
  }

  // ── Tool Call Gating ───────────────────────────────────────────────
  //
  // NOTE: Only gates during "planning" phase. During "review" (transient
  // menu state), the agent isn't active. During "executing", tools are
  // intentionally unblocked.
  //
  // Reference: tool_call event fires before tool executes. Can block via
  // { block: true, reason: string }. Use isToolCallEventType() for type safety.
  // See: https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md#tool_call
  //
  // NOTE: Issue #2543 notes tool_execution_start fires before tool_call hook,
  // so the UI briefly shows the blocked tool as "running" before rejection.
  // This is cosmetic only — the tool never executes.
  // See: https://github.com/earendil-works/pi/issues/2543

  onToolCall(event: any, ctx: ExtensionContext): { block: true; reason: string } | void {
    // Only gate during planning phase
    if (this.phase !== "planning") return;

    // Block configured write tools (editable via config.json)
    // Reference: narumitw/pi-plan-mode blocks these by name
    if (this.config.blockedTools?.includes(event.toolName)) {
      return {
        block: true,
        reason: "Plan mode is read-only. Write tools are blocked.",
      };
    }

    // Gate bash through whitelist
    if (event.toolName === "bash") {
      const command = typeof event.input?.command === "string"
        ? event.input.command
        : "";
      if (!this.bashFilter.isSafe(command)) {
        return {
          block: true,
          reason: `Plan mode blocked mutating bash command: ${command.slice(0, 100)}`,
        };
      }
    }
  }

  // ── System Prompt Injection ────────────────────────────────────────
  //
  // Reference: before_agent_start fires after user prompt, before agent loop.
  // Return { systemPrompt: string } to inject/replace the system prompt for this turn.
  // Handlers chain — later handlers see earlier modifications.
  // See: https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md#before_agent_start

  onBeforeAgentStart(event: any): { systemPrompt: string } | undefined {
    // NOTE: This handler fires every turn. Planning-mode system prompt
    // is injected on every agent turn while phase === "planning".
    if (this.phase === "planning") {
      return {
        systemPrompt: `${event.systemPrompt}

[PLAN MODE ACTIVE — READ ONLY]
You are in planning mode. You may explore the codebase but cannot modify files.

WORKFLOW:
1. Inspect files, symbols, and structure before proposing changes.
2. Identify uncertainties and assumptions explicitly.
3. When ready, write your plan to the plan file using the write_plan tool.

To submit your plan for review, call the write_plan tool with your plan content.
The plan file will be saved to ${this.planFile.getFilePath()} (added to .gitignore).

PLAN FILE FORMAT:
# Title
## Summary
One-paragraph overview.

## Steps
- [ ] Step 1: Objective — target files, validation method
- [ ] Step 2: Objective — target files, validation method
- [ ] Step 3: ...

## Risks & Rollback
- Risk 1
- Risk 2

## Assumptions
- Assumption 1
`.trim(),
      };
    }

    // NOTE: When phase is "executing" (set by buildAuto or buildGuided),
    // inject the plan as system prompt so it persists across turns.
    if (this.phase === "executing" && this.planFile.hasSteps()) {
      const remaining = this.planFile.getRemainingSteps();
      const planContent = this.planFile.getContent();
      const isGuided = this.buildMode === "guided";

      const modeContext = isGuided
        ? `Build (guided) mode: The plan below is a reference, not a hard constraint.
You may deviate, iterate, or refactor as needed. The user is in the loop.`
        : `Execute the remaining steps from the approved plan exactly.`;

      return {
        systemPrompt: `${event.systemPrompt}

[APPROVED PLAN EXECUTION — ${isGuided ? "GUIDED" : "AUTO"} MODE]
${modeContext}

Remaining steps:
${remaining}

After completing each step, include [DONE:n] where n is the step number.

Full plan reference:
${planContent}
`.trim(),
      };
    }

    return undefined;
  }

  // ── Session Lifecycle ──────────────────────────────────────────────
  //
  // Reference: session_start fires on startup/reload/new/resume/fork.
  // session_shutdown fires before extension teardown.
  // See: https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md#session-events

  onSessionStart(_event: any, ctx: ExtensionContext): void {
    // Restore persisted state if resuming
    this.restoreState(ctx);
  }

  onSessionShutdown(_event: any, _ctx: ExtensionContext): void {
    this.ui.setStatus(undefined);
    this.ui.setWidget(undefined);
  }

  // ── Progress Tracking ──────────────────────────────────────────────
  //
  // Reference: turn_end fires after each LLM turn (message + tool calls).
  // Extract [DONE:n] markers from assistant response to track progress.
  // See: https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md#turn_end

  onTurnEnd(event: any, ctx: ExtensionContext): void {
    if (this.phase !== "executing") return;

    // Extract [DONE:n] markers from assistant message
    const text = this.extractAssistantText(event.message);
    if (!text) return;

    const doneMatches = text.match(/\[DONE:(\d+)\]/g);
    if (!doneMatches) return;

    const completedSteps = doneMatches.map(m => {
      const num = parseInt(m.replace("[DONE:", "").replace("]", ""), 10);
      return num;
    });

    // Mark steps as complete in the plan file
    this.planFile.markCompleted(completedSteps);

    // Update widget and status
    const total = this.planFile.getTotalSteps();
    const completed = this.planFile.getCompletedSteps();
    this.ui.setStatus(`📋 ${completed}/${total}`);
    this.ui.setWidget(this.planFile.getWidgetLines());

    // Check if all done
    if (completed === total) {
      this.phase = "idle";
      this.ui.setStatus(undefined);
      this.ui.notify("All plan steps complete.");
    }
  }

  // ── State Persistence ──────────────────────────────────────────────
  //
  // Reference: pi.appendEntry(customType, data) stores data in the session
  // that survives restarts. Data is accessible via session entries.
  // See: https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md
  //
  // Session format: JSONL with append-only trees. Entries include custom types.
  // See: https://pi.dev/docs/latest/sessions

  private persistState(ctx: ExtensionContext): void {
    this.pi.appendEntry("planit", {
      phase: this.phase,
      planFilePath: this.planFile.getFilePath(),
      planContent: this.planFile.getContent(),
      restoredTools: this.restoredTools,
    });
  }

  private restoreState(ctx: ExtensionContext): void {
    // In a full implementation, read the last "planit" entry from the session
    // For now, this is a stub — the plan file on disk is the source of truth
    // The file path is persisted via appendEntry for recovery
  }

  // ── Registration ───────────────────────────────────────────────────
  //
  // NOTE: This registerCommand handles toggle/on/off/status (Phase 1).
  // Phase 3.2 adds review logic. The final implementation should
  // combine both into a single registration.

  register(pi: ExtensionAPI): void {
    // Commands
    pi.registerCommand("planit", {
      description: "Toggle plan mode. Usage: /planit, /planit on, /planit off, /planit status",
      handler: async (args: string, ctx: ExtensionContext) => {
        const raw = args.trim().toLowerCase();

        if (raw.length === 0) {
          // Toggle
          if (this.isPlanMode) {
            this.exitPlanning(ctx);
          } else {
            this.enterPlanning(ctx);
          }
          return;
        }

        if (["on", "enable", "start"].includes(raw)) {
          this.enterPlanning(ctx);
          return;
        }

        if (["off", "disable", "stop", "exit"].includes(raw)) {
          this.exitPlanning(ctx);
          return;
        }

        if (["status", "state"].includes(raw)) {
          const state = this.isPlanMode ? "Plan mode: ON (read-only)"
            : this.isExecuting ? "Plan mode: OFF (executing approved plan)"
            : "Plan mode: OFF (default YOLO mode)";
          this.ui.notify(state);
          return;
        }

        // If plan mode is off and a task is provided, enable it first
        if (!this.isPlanMode) {
          this.enterPlanning(ctx);
        }

        // Send the task as user message
        pi.sendUserMessage(args, { deliverAs: "followUp" });
      },
    });

    // Flag — use "planit" to match the command name
    pi.registerFlag("planit", {
      description: "Start in plan mode",
      type: "boolean",
      default: false,
    });

    // Event handlers
    pi.on("tool_call", (event, ctx) => {
      const result = this.onToolCall(event, ctx);
      if (result) return result;
    });

    pi.on("before_agent_start", (event) => {
      return this.onBeforeAgentStart(event);
    });

    pi.on("session_start", (_event, ctx) => {
      this.onSessionStart(_event, ctx);
    });

    pi.on("session_shutdown", (_event, ctx) => {
      this.onSessionShutdown(_event, ctx);
    });

    pi.on("turn_end", (event, ctx) => {
      this.onTurnEnd(event, ctx);
    });
  }

  private extractAssistantText(message: any): string {
    if (message?.role !== "assistant") return "";

    if (typeof message.content === "string") {
      return message.content;
    }

    if (!Array.isArray(message.content)) return "";

    return message.content
      .filter((block: any) =>
        typeof block === "object" && block !== null && block.type === "text"
      )
      .map((block: any) => block.text ?? "")
      .join("\n");
  }
}
```

### 1.7 Testing

**Tier 1 — Unit tests** (`tests/unit/bash-filter.test.ts`): Plain vitest, no harness.
- `BashFilter.isSafe()` — assert SAFE_PATTERNS match: `cat`, `ls`, `grep`, `git status`, `find`, `npm list`, etc.
- `BashFilter.isSafe()` — assert DANGEROUS_PATTERNS block: `rm`, `git commit`, `npm install`, `sudo`, `mv`, file redirects (`>`)
- Edge case: empty / whitespace-only commands allowed

**Tier 2 — Integration tests** (`tests/integration/plan-mode.test.ts`): `@itzrnvr/pi-test-harness` + vitest.
- Extension loads without errors
- In plan mode: `write`/`edit` tools are blocked (check `t.events.blockedCalls()`)
- In plan mode: read tools (`read`, `bash` safe commands) are NOT blocked
- In plan mode: dangerous bash commands are blocked
- Out of plan mode: no tools are blocked

**Reference:**
- Extension factory pattern ([extensions.md](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md#writing-an-extension))
- `registerCommand`, `registerFlag`, `registerShortcut` ([extensions.md](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md#writing-an-extension))
- Event registration (`pi.on()`) ([extensions.md](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md#events))

---

## Phase 2: Plan File Management (1–2 hours)

**Goal:** The agent can write a plan file that persists on disk, survives sessions, and is structured for parsing.

### 2.1 Plan File Class (`src/plan-file.ts`)

```typescript
import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";

export interface ChecklistItem {
  step: number;
  text: string;
  completed: boolean;
}

/**
 * Derive a 3-5 word filename from a user's task description.
 * Example: "migrate auth to JWT" → "migrate-auth-to-jwt" + timestamp + UUID
 */
function derivePlanName(userSummary: string): string {
  const words = userSummary
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")  // strip non-alphanumeric
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 5);  // max 5 words

  if (words.length === 0) {
    return "untitled-plan";
  }

  // Add timestamp for uniqueness (same summary can produce multiple plans)
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  return `${words.join("-")}-${timestamp}`;
}

export class PlanFile {
  private filePath: string;
  private content: string = "";
  private items: ChecklistItem[] = [];

  constructor() {
    this.filePath = "";
  }

  /**
   * Initialize plan file in ~/.pi/agent/plans/--project-path--/ mirror structure.
   * Mirrors the session directory pattern used by pi.dev.
   *
   * @param cwd - Current working directory of the project
   * @param userSummary - User's initial task description (used to derive filename)
   */
  init(cwd: string, userSummary: string = "untitled"): void {
    // Mirror structure: ~/.pi/agent/plans/--project-path--/
    // Same pattern as sessions: ~/.pi/agent/sessions/--project-path--/
    const homeDir = process.env.HOME ?? process.env.USERPROFILE ?? "/";
    const plansDir = path.join(homeDir, ".pi", "agent", "plans");

    // Sanitize project path for use as a directory name
    // Replace / with -- (same as pi.dev session naming)
    const sanitizedProjectPath = cwd.replace(/\//g, "--");
    const projectPlansDir = path.join(plansDir, sanitizedProjectPath);

    // Create unique filename from user summary
    const planName = `${derivePlanName(userSummary)}.md`;
    const planPath = path.join(projectPlansDir, planName);

    this.filePath = planPath;

    // Ensure ~/.pi/agent/plans/--project-path--/ directory exists
    if (!fs.existsSync(projectPlansDir)) {
      fs.mkdirSync(projectPlansDir, { recursive: true });
    }

    // Initialize file with default structure
    this.content = `# Plan\n## Summary\n\n## Steps\n\n## Risks & Rollback\n\n## Assumptions\n`;
    fs.writeFileSync(planPath, this.content, "utf-8");

    // Ensure plans directory is gitignored
    this.ensureGitignore(cwd);

    // Load content (already written, but ensures consistency)
    this.content = fs.readFileSync(planPath, "utf-8");
    this.parseChecklist();
  }

  getFilePath(): string {
    return this.filePath;
  }

  getContent(): string {
    return this.content;
  }

  hasSteps(): boolean {
    return this.items.length > 0;
  }

  getTotalSteps(): number {
    return this.items.length;
  }

  getCompletedSteps(): number {
    return this.items.filter(i => i.completed).length;
  }

  getRemainingSteps(): string {
    return this.items
      .filter(i => !i.completed)
      .map(i => `- [ ] Step ${i.step}: ${i.text}`)
      .join("\n");
  }

  markCompleted(stepNumbers: number[]): void {
    for (const step of stepNumbers) {
      const item = this.items.find(i => i.step === step);
      if (item) {
        item.completed = true;
      }
    }
    this.updateFile();
  }

  setSteps(steps: ChecklistItem[]): void {
    this.items = steps;
    this.updateFile();
  }

  getWidgetLines(): string[] {
    if (this.items.length === 0) return [];

    // Theme-aware widget lines (reference: plannotator's widget rendering)
    // In print mode, strip ANSI codes
    return this.items.map(item => {
      const prefix = item.completed ? "☑ " : "☐ ";
      const text = item.completed ? `[${item.step}] ${item.text}` : `[${item.step}] ${item.text}`;
      return `${prefix}${text}`;
    });
  }

  // ── Title Extraction ──────────────────────────────────────────────
  //
  // Extracts the first "# <title>" heading from plan content.
  // Returns null if no title section exists.

  getTitle(): string | null {
    const match = this.content.match(/^#\s+(.+)$/m);
    return match ? match[1].trim() : null;
  }

  // ── Checklist Parsing ─────────────────────────────────────────────
  //
  // Reference: Adapted from @plannotator/pi-extension's parseChecklist()
  // which parses markdown checkbox lists from plan file content.
  // See: https://github.com/backnotprop/plannotator/blob/main/apps/pi-extension/generated/checklist.ts

  private parseChecklist(): void {
    // Match lines like "- [ ] Step 1: description" or "- [x] Step 2: description"
    // Also match "- [ ] description" without step numbers
    const stepRegex = /-\s+\[([ x])\]\s+(?:Step\s+(\d+):\s*)?(.+)$/gm;
    const newItems: ChecklistItem[] = [];
    let stepNum = 0;
    let match;

    while ((match = stepRegex.exec(this.content)) !== null) {
      const completed = match[1] === "x";
      const step = match[2] ? parseInt(match[2], 10) : ++stepNum;
      const text = match[3].trim();
      newItems.push({ step, text, completed });
      if (!match[2]) stepNum++;
    }

    this.items = newItems;
  }

  private updateFile(): void {
    // Rebuild content with updated checkbox states
    // NOTE: Match by step number (not string containment) to avoid
    // ambiguous matches when two steps share similar text.
    const lines = this.content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const stepMatch = line.match(/(-\s+\[([ x])\]\s+(?:Step\s+(\d+):\s*)?(.+))/);
      if (stepMatch) {
        const stepNum = stepMatch[3] ? parseInt(stepMatch[3], 10) : null;
        const item = stepNum
          ? this.items.find(item => item.step === stepNum)
          : this.items.find(item => line.includes(item.text));
        if (item) {
          const checkbox = item.completed ? "x" : " ";
          lines[i] = line.replace(`[${stepMatch[2]}]`, `[${checkbox}]`);
        }
      }
    }

    this.content = lines.join("\n");
    fs.writeFileSync(this.filePath, this.content, "utf-8");
  }

  private ensureGitignore(cwd: string): void {
    const gitignorePath = path.join(cwd, ".gitignore");
    const piEntry = ".pi/";

    if (fs.existsSync(gitignorePath)) {
      const content = fs.readFileSync(gitignorePath, "utf-8");
      if (!content.includes(piEntry)) {
        fs.appendFileSync(gitignorePath, `\n# Planit\n${piEntry}\n`, "utf-8");
      }
    } else {
      fs.writeFileSync(gitignorePath, `# Planit\n${piEntry}\n`, "utf-8");
    }
  }
}
```

### 2.2 Custom Tool: `write_plan`

**Goal:** The agent writes the plan to the file using a custom tool (not `write` which is blocked).

```typescript
// This tool is registered in PlanMode.register()

pi.registerTool({
  name: "write_plan",
  label: "Write Plan",
  description: "Write or update the plan file. Use this instead of the write tool in plan mode.",
  parameters: Type.Object({
    content: Type.String({
      description: "The complete plan content to write to ~/.pi/agent/plans/--project-path--/<plan-name>.md",
    }),
  }),
  async execute(_toolCallId: string, params: { content: string }, _signal: AbortSignal, _onUpdate: any, ctx: ExtensionContext) {
    if (!this.isPlanMode) {
      return {
        content: [{ type: "text", text: "Error: Not in plan mode. Use /planit to enter." }],
        details: { approved: false },
      };
    }

    // Write to the plan file
    fs.writeFileSync(this.planFile.getFilePath(), params.content, "utf-8");
    this.planFile.content = params.content;
    this.planFile.parseChecklist();

    return {
      content: [{
        type: "text",
        text: `Plan written to ${this.planFile.getFilePath()}. ${this.planFile.items.length} steps found.`,
      }],
      details: { approved: true },
    };
  },
});
```

**Reference:** Custom tool registration ([extensions.md](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md#writing-an-extension))

### 2.7 Testing

**Tier 1 — Unit tests** (`tests/unit/plan-file.test.ts`): Plain vitest with fs mocking.
- `PlanFile.init()` — creates file in `~/.pi/agent/plans/--project-path--/` mirror structure
- `derivePlanName()` — derives 3-5 word filename from user summary (e.g., "migrate auth to jwt" → `migrate-auth-to-jwt`)
- Same summary produces unique filenames (different timestamps)
- Checklist parsing: `- [ ]` and `- [x]` markers correctly parsed
- `markCompleted()` — updates checkbox state correctly
- `getWidgetLines()` — returns correct checkbox prefix (`☐` / `☑`)

**Tier 2 — Integration tests** (`tests/integration/plan-file.test.ts`):
- `write_plan` tool succeeds in plan mode (not blocked)
- Plan file written to correct path under `~/.pi/agent/plans/`

---

## Phase 3: Review Flow (2–3 hours)

**Goal:** User explicitly triggers review via `/planit review`. Full plan displayed in widget with three execution options.

### 3.1 Review Menu (`src/ui.ts`)

```typescript
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { PlanFile } from "./plan-file";

export type ReviewAction = "buildAuto" | "buildGuided" | "continueEditing";

export class PlanUI {
  constructor(private pi: ExtensionAPI) {}

  notify(message: string, type: "info" | "warning" | "error" = "info"): void {
    if (this.pi.getContext()?.hasUI) {
      this.pi.getContext()!.ui.notify(message, type);
    }
  }

  setStatus(status: string | undefined): void {
    if (this.pi.getContext()?.hasUI) {
      this.pi.getContext()!.ui.setStatus("planit", status);
    }
  }

  setWidget(lines: string[] | undefined): void {
    if (this.pi.getContext()?.hasUI) {
      if (lines) {
        this.pi.getContext()!.ui.setWidget("planit-todos", lines);
      } else {
        this.pi.getContext()!.ui.setWidget("planit-todos", undefined);
      }
    }
  }

  /** Show plan checklist + file path in widget (used during planning) */
  showPlanningWidget(planFile: PlanFile): void {
    const lines = [
      `📋 Plan: ${planFile.getTitle() ?? "untitled"}`,
      `   [path: ${planFile.getFilePath()}]`,
      "",
      ...planFile.getWidgetLines(),
    ];
    this.setWidget(lines);
  }

  /** Show full plan content + review menu (used during review) */
  async showReviewMenu(planFile: PlanFile): Promise<ReviewAction | null> {
    if (!this.pi.getContext()?.hasUI) {
      this.notify("Plan mode requires interactive TUI. Auto-approving.");
      return "buildAuto";
    }

    const ctx = this.pi.getContext()!;

    // Display full plan content in widget
    const planContent = planFile.getContent();
    const lines = [
      `📋 Plan: ${planFile.getTitle() ?? "untitled"}`,
      `   [path: ${planFile.getFilePath()}]`,
      "",
      planContent,
      "",
      "── Review Options ──",
    ];
    this.setWidget(lines);

    const options = [
      { label: "↺ Build (auto)" },
      { label: "✓ Build (guided)" },
      { label: "↻ Continue editing" },
    ];

    const result = await ctx.ui.select(
      "Plan Review",
      options.map(o => o.label),
    );

    if (!result) return null;

    const actionMap: Record<string, ReviewAction> = {
      [options[0].label]: "buildAuto",
      [options[1].label]: "buildGuided",
      [options[2].label]: "continueEditing",
    };

    return actionMap[result];
  }
}
```

**Reference:**
- `ctx.ui.select()` for menus ([extensions.md](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md#custom-ui))
- `ctx.ui.setWidget()` for plan display ([extensions.md](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md#extensioncontext))

### 3.2 Review Integration in PlanMode

Add to `PlanMode`:

```typescript
// No auto-menu on agent_end. Review is explicitly triggered by user.

private reviewPlan(ctx: ExtensionContext): void {
  if (!this.planFile.hasSteps()) {
    this.ui.notify("No plan to review. Ask the agent to write a plan first.");
    return;
  }

  this.phase = "review";
  this.persistState(ctx);

  this.ui.showReviewMenu(this.planFile).then((result) => {
    if (!result) return;

    switch (result) {
      case "buildAuto":
        this.buildAuto(ctx);
        break;

      case "buildGuided":
        // NOTE: onToolCall does NOT gate during "review" phase because
        // review is a brief, user-facing state (menu interaction). The
        // agent isn't running during this time.
        this.buildGuided(ctx);
        break;

      case "continueEditing":
        this.continueEditing(ctx);
        break;
    }
  });
}

  // buildMode tracks which build path was taken from the review menu.
  // Used by onBeforeAgentStart to inject appropriate context.
  private buildMode: "auto" | "guided" = "auto";

private buildAuto(ctx: ExtensionContext): void {
  this.buildMode = "auto";
  this.phase = "executing";
  this.ui.notify("Building (auto) — executing all steps.");
  this.persistState(ctx);

  // NOTE: The plan is injected into the system prompt via
  // onBeforeAgentStart() which persists across turns. No need
  // for sendUserMessage — the system prompt carries the context.
}

private buildGuided(ctx: ExtensionContext): void {
  // Unblock write tools but keep plan as reference
  this.buildMode = "guided";
  this.phase = "executing";
  this.ui.notify("Building (guided) — writes enabled, plan as reference.");
  this.persistState(ctx);

  // NOTE: The full plan is injected into the system prompt via
  // onBeforeAgentStart() (see plan-mode.ts) which persists across turns.
  // The buildMode flag tells onBeforeAgentStart which context to inject.
}

private continueEditing(ctx: ExtensionContext): void {
  // Back to planning: read-only, agent can update plan
  this.phase = "planning";
  this.ui.setStatus("⏸ plan");
  this.ui.showPlanningWidget(this.planFile);
  this.ui.notify("Back to planning. Edit the plan and ask the agent to explore further.");
  this.persistState(ctx);
}

// Register /planit review command — adds to the Phase 1 registration
pi.registerCommand("planit", {
  description: "Manage plan mode. Usage: /planit, /planit on, /planit off, /planit status, /planit review",
  handler: async (args: string, ctx: ExtensionContext) => {
    const raw = args.trim().toLowerCase();

    if (raw === "review") {
      this.reviewPlan(ctx);
      return;
    }

    // ... existing toggle logic ...
  },
});
```

**Reference:**
- `ctx.ui.select()` for menus ([extensions.md](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md#custom-ui))
- `ctx.ui.setWidget()` for plan display ([extensions.md](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md#extensioncontext))
- `pi.sendUserMessage()` for injection ([extensions.md](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md#input-events))

### 3.7 Testing

**Tier 1 — Unit tests** (`tests/unit/ui.test.ts`): Plain vitest with mocked `ctx.ui`.
- `PlanUI.showReviewMenu()` — mocked `ctx.ui.select()` returns "↺ Build (auto)" → assert `"buildAuto"` returned
- `PlanUI.showReviewMenu()` — "✓ Build (guided)" → assert `"buildGuided"` returned
- `PlanUI.showReviewMenu()` — "↻ Continue editing" → assert `"continueEditing"` returned
- `PlanUI.showReviewMenu()` — non-UI mode (`ctx.hasUI === false`) → auto returns `"buildAuto"`
- `PlanUI.showReviewMenu()` — user cancels (null) → null returned
- `PlanUI.showPlanningWidget()` — renders checklist + file path lines correctly

**Tier 2 — Integration tests** (`tests/integration/review-flow.test.ts`): pi-test-harness + vitest.
- `/planit review` → review menu appears → "Build (auto)" → phase transitions to `executing`, full execution starts
- `/planit review` → "Build (guided)" → phase transitions to `executing`, writes unblocked, plan injected as reference
- `/planit review` → "Continue editing" → phase returns to `planning`, read-only restored, plan visible in widget
- `/planit review` with no plan → notifies "No plan to review"
- Agent writes plan while in planning → widget updates to show new plan content

---

## Phase 4: Improved Bash Filtering (1 hour)

**Goal:** More robust bash filtering inspired by `@devkade/pi-plan`.

### 4.1 Bash Filter Class (`src/bash-filter.ts`)

```typescript
export class BashFilter {
  // Reference: Adapted from @devkade/pi-plan's isSafeReadOnlyCommand()
  // See: https://github.com/devkade/pi-plan/blob/main/src/utils.ts

  private readonly SAFE_PATTERNS: RegExp[] = [
    // File inspection
    /^\s*cat\s+/,
    /^\s*head\s+/,
    /^\s*tail\s+/,
    /^\s*less\s+/,
    /^\s*more\s+/,
    /^\s*wc\s+/,
    /^\s*file\s+/,
    /^\s*stat\s+/,
    /^\s*du\s+/,
    /^\s*df\s+/,

    // Directory listing
    /^\s*ls\s+/,
    /^\s*find\s+/,
    /^\s*tree\s+/,

    // Text search
    /^\s*grep\s+/,
    /^\s*rg\s+/,
    /^\s*ag\s+/,
    /^\s*fgrep\s+/,
    /^\s*egrep\s+/,

    // Git read-only
    /^\s*git\s+(status|log|diff|show|branch|tag|rev-parse|describe|tag|name-rev|for-each-ref|ls-files|shortlog|blame|annotate)\b/,
    /^\s*git\s+show\b/,
    /^\s*git\s+diff\s+(--staged|HEAD|--cached)\b/,

    // Process/info
    /^\s*ps\s+/,
    /^\s*top\s+/,
    /^\s*htop\s+/,
    /^\s*env\s+/,
    /^\s*printenv\s+/,
    /^\s*uname\s+/,
    /^\s*whoami\s+/,
    /^\s*id\s+/,

    // Package info (read-only)
    /^\s*npm\s+(list|info|show|view|help)\b/,
    /^\s*yarn\s+(list|info|help)\b/,
    /^\s*pip\s+(list|show|show|help|freeze)\b/,

    // Documentation
    /^\s*man\s+/,
    /^\s*--help\b/,
    /^\s*-h\b/,
  ];

  private readonly DANGEROUS_PATTERNS: RegExp[] = [
    // Destructive commands
    /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*)?\b/,
    /\bunlink\b/,
    /\btruncate\b/,
    /\bshred\b/,

    // Redirects
    />\s*$/,
    />>\s*$/,
    /\|\s*>\s*$/,

    // Git mutations
    /\bgit\s+(commit|push|pull|merge|rebase|reset\s+(--hard|--mixed)|checkout\s+-b|push\s+--force|push\s+-f)\b/,

    // Package installation
    /\bnpm\s+install\b/,
    /\byarn\s+(add|remove|global)\b/,
    /\bpip\s+(install|uninstall)\b/,
    /\bsudo\b/,

    // File modification
    /\bmv\s+/,
    /\bcp\s+-[a-zA-Z]*r/,
    /\bchmod\s+/,
    /\bchown\s+/,

    // Network writes
    /\bcurl\s+-[a-zA-Z]*X\s+(POST|PUT|DELETE|PATCH)\b/,
    /\bwget\s+-[a-zA-Z]*O\b/,
  ];

  isSafe(command: string): boolean {
    if (!command.trim()) return true;

    // Check dangerous patterns first (these always block)
    for (const pattern of this.DANGEROUS_PATTERNS) {
      if (pattern.test(command)) {
        return false;
      }
    }

    // Check safe patterns
    for (const pattern of this.SAFE_PATTERNS) {
      if (pattern.test(command)) {
        return true;
      }
    }

    // If no pattern matched, default to blocking (whitelist approach)
    return false;
  }
}
```

**Reference:** Adapted from `@devkade/pi-plan`'s whitelist approach ([src/utils.ts](https://github.com/devkade/pi-plan/blob/main/src/utils.ts))

### 4.7 Testing

Tests covered by Phase 1's `BashFilter` unit tests. Phase 4 adds expanded patterns — the same test structure applies:
- Git mutation patterns blocked: `git commit`, `git push`, `git reset --hard`, `git rebase`, etc.
- Network write patterns blocked: `curl -X POST`, `wget -O`
- File modification patterns blocked: `chmod`, `chown`, `cp -r`
- Destructive patterns blocked: `shred`, `truncate`, `unlink`
- Package install patterns blocked: `yarn add`, `yarn remove`, `pip install`, `pip uninstall`

---

## Phase 5: Plan Execution Commands (1 hour)

**Goal:** Allow manual execution triggers outside the auto-flow.

### 5.1 Additional Commands

```typescript
// In PlanMode.register():

pi.registerCommand("planit", {
  description: "Execute plan from file. Usage: /planit, /planit resume, /planit status",
  handler: async (args: string, ctx: ExtensionContext) => {
    const raw = args.trim().toLowerCase();

    if (raw.length === 0) {
      // Execute current plan
      if (!this.planFile.hasSteps()) {
        this.ui.notify("No plan found. Create a plan in plan mode first.");
        return;
      }

      if (this.isExecuting) {
        this.ui.notify("Already executing a plan.");
        return;
      }

      this.phase = "executing";
      this.ui.notify("Executing plan...");
      this.persistState(ctx);

      const remaining = this.planFile.getRemainingSteps();
      this.pi.sendUserMessage(
        `Execute the plan:\n\n${remaining}\n\nInclude [DONE:n] after each step.`,
        { deliverAs: "followUp" }
      );
      return;
    }

    if (["resume", "continue"].includes(raw)) {
      // Resume from persisted state
      this.restoreState(ctx);
      if (this.isExecuting && this.planFile.hasSteps()) {
        const remaining = this.planFile.getRemainingSteps();
        this.pi.sendUserMessage(
          `Resuming plan execution:\n\n${remaining}`,
          { deliverAs: "followUp" }
        );
      }
      return;
    }

    if (["status", "state", "progress"].includes(raw)) {
      if (!this.planFile.hasSteps()) {
        this.ui.notify("No plan tracked.");
        return;
      }

      const total = this.planFile.getTotalSteps();
      const completed = this.planFile.getCompletedSteps();
      const remaining = total - completed;

      const status = `Plan: ${completed}/${total} steps (${remaining} remaining)`;
      this.ui.notify(status);
      this.ui.setWidget(this.planFile.getWidgetLines());
      return;
    }

    if (["cancel", "stop"].includes(raw)) {
      if (this.isExecuting) {
        this.phase = "idle";
        this.ui.notify("Plan execution cancelled.");
      }
      return;
    }

    // If plan mode is off, enable it
    if (!this.isPlanMode) {
      this.enterPlanning(ctx);
    }

    // Treat as task to plan
    this.pi.sendUserMessage(args, { deliverAs: "followUp" });
  },
});

// Add /planit-file to open/view the plan file
pi.registerCommand("planit-file", {
  description: "Show the plan file content",
  handler: async (_args: string, ctx: ExtensionContext) => {
    const content = this.planFile.getContent();
    if (!content.trim()) {
      this.ui.notify("Plan file is empty. Create a plan in plan mode first.");
      return;
    }
    // Use sendMessage to display in TUI
    this.pi.sendMessage(
      {
        customType: "planit-file",
        content: `### Plan File (${this.planFile.getFilePath()})\n\n\`\`\`\n${content}\n\`\`\``,
        display: true,
      },
      { deliverAs: "followUp" }
    );
  },
});
```

**Reference:**
- `pi.sendMessage()` for custom messages ([extensions.md](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md#extensionapi-methods))
- `deliverAs: "followUp"` for background messages ([extensions.md](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md#input-events))

### 5.7 Testing

**Tier 2 — Integration tests** (`tests/integration/planit-commands.test.ts`): pi-test-harness + vitest.
- `/planit` (empty) with no plan → notifies "No plan found"
- `/planit` (empty) with existing plan → phase transitions to `executing`, follow-up sent
- `/planit resume` — restores from persisted state, continues execution
- `/planit status` — shows step count, renders widget with checklist lines
- `/planit cancel` — sets phase back to `idle`
- `/planit-file` with empty plan → notifies "Plan file is empty"
- `/planit-file` with content → displays plan content in TUI

---

## Phase 6: Session Persistence & Edge Cases (1–2 hours)

**Goal:** State survives session restarts; handle edge cases gracefully.

### 6.1 State Persistence Implementation

```typescript
// In PlanMode.restoreState():

private restoreState(ctx: ExtensionContext): void {
  // Reference: pi.appendEntry() stores data in session entries.
  // On resume, read the last "planit" entry to recover state.
  // See: https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md

  const sessionFile = ctx.sessionManager.getSessionFile();
  if (!sessionFile) return;

  try {
    // Read session file (JSONL format)
    const content = fs.readFileSync(sessionFile, "utf-8");
    const lines = content.split("\n").filter(Boolean);

    // Find last "planit" entry
    let lastPlanitEntry: any = null;
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const entry = JSON.parse(lines[i]);
        if (entry.type === "custom" && entry.customType === "planit") {
          lastPlanitEntry = entry;
          break;
        }
      } catch {
        // Skip malformed lines
      }
    }

    if (!lastPlanitEntry) return;

    const data = lastPlanitEntry.data;
    if (!data) return;

    // Restore phase
    if (data.phase) {
      this.phase = data.phase as PlanPhase;
    }

    // Restore plan file path
    if (data.planFilePath) {
      this.planFile.filePath = data.planFilePath;
      if (fs.existsSync(data.planFilePath)) {
        this.planFile.content = fs.readFileSync(data.planFilePath, "utf-8");
        this.planFile.parseChecklist();
      }
    }

    // NOTE: We intentionally do NOT restore "review" phase — it's
    // transient. If a session restarts during review, the user simply
    // sees the last state (planning or executing) and can re-trigger
    // /planit review.

    // Restore tools if we were in planning
    if (this.phase === "planning" && data.restoredTools) {
      this.restoredTools = data.restoredTools;
    }

    // Update UI
    if (this.phase === "planning") {
      this.ui.setStatus("⏸ plan (restored)");
    } else if (this.phase === "executing") {
      const completed = this.planFile.getCompletedSteps();
      const total = this.planFile.getTotalSteps();
      this.ui.setStatus(`📋 ${completed}/${total}`);
      this.ui.setWidget(this.planFile.getWidgetLines());
    }

  } catch (err) {
    console.error(`Planit: Failed to restore state: ${err}`);
  }
}
```

**Reference:**
- Session file format (JSONL, append-only) ([pi.dev docs](https://pi.dev/docs/latest/sessions))
- `ctx.sessionManager.getSessionFile()` ([extensions.md](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md#session-start))
- Custom entry types in sessions (`customType` field)

### 6.2 Edge Case: Agent Tries to Write Plan File Directly

Since `write` is blocked during planning, we need the custom `write_plan` tool. But the agent might not know about it. We handle this in `before_agent_start`:

```typescript
// In the system prompt injection (Phase 1):
// Already included: "To submit your plan for review, call the write_plan tool."

// Additionally, in tool_call handler:
onToolCall(event: any, ctx: ExtensionContext): { block: true; reason: string } | void {
  // ... existing gating ...
  // NOTE: Only gates during "planning" phase. Review is transient
  // (user-facing menu). Executing intentionally unblocks tools.

  // If agent tries write on plan file path, redirect to write_plan
  if (event.toolName === "write" && this.isPlanMode) {
    const targetPath = event.input?.path;
    if (targetPath === this.planFile.getFilePath()) {
      return {
        block: true,
        reason: "Cannot use write tool. Use write_plan tool instead.",
      };
    }

    // Block all writes in planning (existing logic)
    return {
      block: true,
      reason: "Plan mode is read-only. Use write_plan for the plan file.",
    };
  }
}
```

### 6.7 Testing

**Tier 2 — Integration tests** (`tests/integration/persistence.test.ts`): pi-test-harness + vitest.
- State persisted via `pi.appendEntry("planit", ...)` — verify entry written to session
- Phase restoration: plan mode state survives session restart (restoreState reads last entry)
- Plan file path recovery from persisted data
- Agent writes to plan file path directly via `write` tool → blocked, redirected to use `write_plan`
- Plan mode entry/exit: tools correctly restored on exit

---

## Phase 7: Polish & Manual QA (1 hour)

**Goal:** Final verification of all flows end-to-end.

### 7.1 Manual Testing Checklist

- [ ] `/planit` toggles plan mode (enter/exit planning), blocks configured write tools
- [ ] `--plan` flag starts in plan mode
- [ ] Configurable tools: adding MCP tool name to config allows it in plan mode
- [ ] Configurable tools: default blocked list blocks `edit`/`write`/`ast_rewrite`
- [ ] Bash whitelist blocks `rm`, `git commit`, `npm install`, etc.
- [ ] Bash whitelist allows `cat`, `ls`, `grep`, `git status`, etc.
- [ ] Agent can call `write_plan` to write plan file
- [ ] Plan file created at `~/.pi/agent/plans/--project-path--/unique-name.md`
- [ ] Checklist parsing works (`- [ ]` and `- [x]`)
- [ ] Widget shows checklist + file path during planning
- [ ] `/planit review` shows full plan content in widget + menu
- [ ] "Build (auto)" → full execution, `[DONE:n]` tracking
- [ ] "Build (guided)" → writes enabled, plan as reference
- [ ] "Continue editing" → back to planning, read-only
- [ ] `/planit review` with no plan → notifies "No plan to review"
- [ ] No auto-menu on `agent_end` (review is explicit)
- [ ] Status shows progress `📋 n/total` during auto build
- [ ] `/planit` triggers execution manually (legacy compat)
- [ ] `/planit status` shows progress
- [ ] `/planit resume` — stub (picker to go through plans deferred to later phase)
- [ ] Session persistence survives restart (plan mode + review + executing)
- [ ] Works in `-p` (print) mode (auto-approve fallback)
- [ ] Option text in menus < 80 chars (avoids Issue #4435)
- [ ] No crashes on empty plans
- [ ] No crashes on malformed sessions
- [ ] Default `config.json` written on first load

### 7.2 Common Issues to Watch For

1. **`pi.setActiveTools()` during agent loop** — Issue #4147. Only call in command handlers and lifecycle events.
2. **tool_execution_start before tool_call block** — Issue #2543. Cosmetic only, tool never executes.
3. **Menu option text overflow** — Issue #4435. Keep option labels < 80 chars.
4. **Plan file path resolution** — Use `ctx.cwd` relative paths, resolve with `path.resolve()`.
5. **Concurrent tool calls** — In parallel mode, `tool_call` may not see sibling results. Plan gating doesn't depend on this.
6. **Non-UI modes** — Always check `ctx.hasUI` before calling `ctx.ui.*` methods.

---

## Implementation Status

**Source files implemented:** `src/` (960 lines total)

| File | Status |
|------|--------|
| `index.ts` | ✅ Entry point |
| `types.ts` | ✅ Shared types |
| `bash-filter.ts` | ✅ Bash whitelist/denylist |
| `plan-file.ts` | ✅ Plan file I/O, checklist parsing |
| `ui.ts` | ✅ TUI menus, status, widgets |
| `plan-mode.ts` | ✅ Core state machine, tool gating, event hooks, `write_plan` tool |

**Phases completed in source:**
- ✅ **Phase 1** — Skeleton, config, tool gating (`/planit on/off/toggle`, `--planit` flag, blocked tools, bash filtering)
- ✅ **Phase 2** — Plan file management (`write_plan` tool, checklist parsing, gitignore)
- ✅ **Phase 3** — Review flow (`/planit review` → menu → build auto/guided/continue editing)
- ✅ **Phase 4** — Bash filtering (SAFE/DANGEROUS pattern lists)
- ❌ **Phase 5** — Execution commands (`/planit resume`, `/planit status`, `/planit cancel`, `/planit-file`) — not yet implemented
- ❌ **Phase 6** — Session persistence (`restoreState` reads session file, `persistState` via `appendEntry`) — stub only
- ❌ **Phase 7** — Polish & manual QA
- ❌ **Phase 8** — Delete plans — not yet implemented

---

## File Structure Summary

```
pi-planit/
├── package.json          # Extension manifest
├── tsconfig.json         # TypeScript config
├── src/
│   ├── index.ts          # Entry point — creates PlanMode, registers with pi
│   ├── plan-mode.ts      # Core state machine: enter/exit, tool gating, system prompts
│   ├── plan-file.ts      # Plan file I/O, checklist parsing
│   ├── bash-filter.ts    # Read-only bash command whitelist/denylist
│   ├── ui.ts             # TUI menus, status, widgets, approval flow
│   └── types.ts          # Shared types (ChecklistItem, PlanPhase, etc.)
├── tests/
│   ├── unit/             # Plain vitest: BashFilter, PlanFile, derivePlanName()
│   └── integration/      # pi-test-harness: extension hooks, tool gating, plan execution
├── examples/
│   └── test-plan.md      # Sample plan file for manual testing
└── README.md             # Usage documentation
```

---

## Estimated Total Effort: 7–10 hours

| Phase | Description | Time |
|-------|-------------|------|
| 1 | Skeleton, config & tool gating | 1–2h |
| 2 | Plan file management | 1–2h |
| 3 | Approval flow | 2–3h |
| 4 | Bash filtering | 1h |
| 5 | Execution commands | 1h |
| 6 | Persistence & edge cases | 1–2h |
| 7 | Polish & manual QA | ~1h |

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
- **Plan file discovery** — Allow user to specify or search for existing plan files. Sub: make the plan directory configurable so users can pick where plans live.
- **Plan export** — Copy plan content to clipboard, send to chat, or write to arbitrary file path.
- **Plan versioning** — Track plan revisions over time.

---

## Phase 8: Delete Plans (0.5–1 hour)

**Goal:** User can delete plan files via `/planit delete`.

### 8.1 Delete Command (`src/plan-mode.ts`)

Add to `PlanMode.register()` under the existing `planit` command handler:

```typescript
if (raw === "delete") {
  await this.deletePlan(ctx);
  return;
}

// If plan mode is off and a task is provided, enable it first
```

And the handler method:

```typescript
private async deletePlan(ctx: ExtensionContext): Promise<void> {
  if (!this.planFile.getFilePath()) {
    this.ui.notify("No active plan to delete.");
    return;
  }

  if (this.isPlanMode || this.isExecuting) {
    this.ui.notify("Cannot delete while plan mode is active. Exit plan mode first.");
    return;
  }

  if (!this.pi.getContext()?.hasUI) {
    // Non-UI mode: delete without confirmation
    fs.unlinkSync(this.planFile.getFilePath());
    this.ui.notify(`Plan deleted: ${this.planFile.getFilePath()}`);
    this.planFile = new PlanFile(); // Reset to fresh state
    return;
  }

  const ctx2 = this.pi.getContext()!;
  const confirmed = await ctx2.ui.confirm(
    "Delete plan?",
    "This will permanently remove the plan file and cannot be undone.",
  );

  if (!confirmed) {
    this.ui.notify("Deletion cancelled.");
    return;
  }

  fs.unlinkSync(this.planFile.getFilePath());
  this.ui.notify(`Plan deleted: ${this.planFile.getFilePath()}`);
  this.planFile = new PlanFile(); // Reset to fresh state
}
```

**Reference:**
- `ctx.ui.confirm()` for confirmation dialog ([extensions.md](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md#custom-ui))
- `fs.unlinkSync()` for file deletion

### 8.2 Delete by Name (Deferred)

Allow deleting a specific plan by name or listing all plans in a project:

```typescript
pi.registerCommand("planit-list", {
  description: "List all plan files for this project",
  handler: async (_args: string, ctx: ExtensionContext) => {
    const plansDir = path.join(
      process.env.HOME ?? "/",
      ".pi", "agent", "plans",
      cwd.replace(/\//g, "--"),
    );
    const files = fs.existsSync(plansDir)
      ? fs.readdirSync(plansDir).filter(f => f.endsWith(".md"))
      : [];
    if (files.length === 0) {
      this.ui.notify("No plans found for this project.");
      return;
    }
    const options = files.map(f => ({ label: f }));
    const selected = await ctx.ui.select("Select plan to delete", options.map(o => o.label));
    if (!selected) return;
    fs.unlinkSync(path.join(plansDir, selected));
    this.ui.notify(`Plan deleted: ${selected}`);
  },
});
```

### 8.7 Testing

**Tier 2 — Integration tests** (`tests/integration/delete-plan.test.ts`):
- `/planit delete` with no active plan → notifies "No active plan to delete"
- `/planit delete` while plan mode is active → notifies error, no deletion
- `/planit delete` with active plan → confirmation dialog → file removed
- `/planit delete` cancelled → no deletion
- Non-UI mode → deletes without confirmation
- Plan file state reset after deletion

---

## Future Enhancements (Out of Scope)

- **Plan diff** — Show changes when plan is revised (inspired by plannotator)
- **Per-step approval** — Approve each step individually during execution
- **Plan templates** — Pre-built plan structures for common workflows
- **Multi-file plans** — Support multiple plan files
- **Plan sharing** — Export plan to clipboard or file path
- **Plan versioning** — Track plan revisions over time
- **Inline plan editing** — Edit plan file from within TUI
- **Plan validation** — Check plan file for required sections before approval
- **Plan metrics** — Track how many plans were approved vs. revised vs. discarded
- **Plan picker** — Browse and select from list of past plans
- **Plan archive** — Move old plans to archive directory instead of deleting
