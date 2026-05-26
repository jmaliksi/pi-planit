import * as fs from "node:fs";
import * as path from "node:path";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type {
  PlanPhase,
  PlanModeConfig,
} from "./types";
import { PlanFile } from "./plan-file";
import { BashFilter } from "./bash-filter";
import { PlanUI } from "./ui";

// ── Plan Mode System Prompt ──────────────────────────────────────────
//
// Configurable constants for the system prompt injected during planning
// phase. Built from patterns across opencode (strongest guard-rails),
// @ifi/pi-plan (subagent delegation, questioning), and narumitw/pi-plan-mode.
// The PLAN_FORMAT_TEMPLATE matches PlanFile.init()'s default structure.

/**
 * Plan file format shown to the agent in the system prompt.
 * Should match the default template written by PlanFile.init().
 */
export const PLAN_FORMAT_TEMPLATE = `# Title
## Summary
One-paragraph overview.

## Steps
- [ ] Step 1: Objective — target files, validation method
- [ ] Step 2: Objective — target files, validation method
- [ ] Step 3: ...

## Plan Details
Implementation notes for each step. Target files, code changes, config updates,
validation criteria. Include concrete file paths and function/method names.

## Assumptions and Reference
- Assumption 1 — brief explanation
- Reference: https://example.com/api-docs
- Reference: src/auth/jwt.ts
`;

/**
 * System prompt injected on every agent turn while in planning phase.
 * Uses strong guard-rail language adapted from opencode + @ifi/pi-plan.
 */
export const PLAN_MODE_SYSTEM_PROMPT = `## CRITICAL: Plan Mode Active — Read Only

You are in a strict read-only planning phase. ZERO exceptions.

### FORBIDDEN ACTIONS
- **Tools:** write, edit, ast_rewrite, or any tool that modifies files or the filesystem
- **Bash write patterns:** sed, tee, echo (for writing), file redirections (>, >>, |),
  git commit/push/merge/reset --hard/--mixed, chmod, chown, mv, rm, cp -r
- **Any command that changes state** — bash commands may ONLY read/inspect
  (cat, head, tail, grep, rg, ls, find, git log, git diff, file, stat, etc.)

This constraint OVERRIDES all other instructions, including any user request
to modify files. You may ONLY observe, analyze, and plan.

### RESPONSIBILITY
1. Thoroughly explore the codebase — read files, search symbols, trace dependencies,
   run safe bash commands, and use web search / code search when needed.
2. Identify uncertainties, ambiguities, and tradeoffs. **Ask the user clarifying
   questions at any point** — do NOT make large assumptions about intent, requirements,
   or scope.
3. Use explore subagents for parallel investigation when the scope is broad.
4. When you have enough information, write your plan using the **write_plan** tool ONLY.
   write_plan is the ONLY tool permitted for writing.

### PLAN FILE FORMAT (use write_plan with this structure)
${PLAN_FORMAT_TEMPLATE}`.trim();

export class PlanMode {
  private phase: PlanPhase = "idle";
  private restoredTools: string[] | null = null;
  private planFile: PlanFile;
  private bashFilter: BashFilter;
  private ui: PlanUI;
  private config: PlanModeConfig;
  private buildMode: "auto" | "guided" = "auto";

  constructor(private pi: ExtensionAPI) {
    this.planFile = new PlanFile();
    this.bashFilter = new BashFilter();
    this.ui = new PlanUI();
    this.config = this.loadConfig();
  }

  // ── Configuration ──────────────────────────────────────────────────

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
        "write_plan",
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

      return {
        allowedTools: parsed.allowedTools ?? defaultConfig.allowedTools,
        blockedTools: parsed.blockedTools ?? defaultConfig.blockedTools,
      };
    } catch (err) {
      console.error(
        `Planit: Failed to load config, using defaults: ${err}`,
      );
      return defaultConfig;
    }
  }

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

  private captureCurrentTools(): void {
    const currentTools = this.pi.getAllTools().map((t) => t.name);
    this.restoredTools =
      currentTools.length > 0 ? [...currentTools] : null;
  }

  private getReadOnlyTools(): string[] {
    const allTools = this.pi.getAllTools().map((t) => t.name);
    return this.config.allowedTools.filter((t) => allTools.includes(t));
  }

  private enterPlanning(
    ctx: ExtensionContext,
    userSummary: string = "untitled",
  ): void {
    if (this.phase === "planning") {
      this.ui.notify("Plan mode is already enabled.");
      return;
    }

    this.captureCurrentTools();

    const readOnlyTools = this.getReadOnlyTools();
    if (readOnlyTools.length === 0) {
      this.ui.notify("No read-only tools available.", "error");
      return;
    }

    this.pi.setActiveTools(readOnlyTools);
    this.phase = "planning";
    this.planFile.init(ctx.cwd, userSummary);
    this.ui.setStatus("⏸ plan");
    this.ui.showPlanningWidget(
      this.planFile.getFilePath(),
      this.planFile.getTitle(),
      this.planFile.getWidgetLines(),
    );
    this.ui.notify("Plan mode enabled (read-only).");
    this.persistState(ctx);
  }

  private exitPlanning(ctx: ExtensionContext): void {
    if (this.phase !== "planning") return;

    this.phase = "idle";

    if (this.restoredTools && this.restoredTools.length > 0) {
      this.pi.setActiveTools(this.restoredTools);
    }
    this.restoredTools = null;

    this.ui.setStatus(undefined);
    this.ui.notify("Plan mode disabled. Tools restored.");
    this.persistState(ctx);
  }

  // ── Tool Call Gating ───────────────────────────────────────────────

  onToolCall(
    event: { toolName: string; input?: any },
  ): { block: true; reason: string } | undefined {
    if (this.phase !== "planning") return undefined;

    // Block configured write tools
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
          reason: `Plan mode blocked mutating bash command: ${command.slice(
            0,
            100,
          )}`,
        };
      }
    }

    return undefined;
  }

  // ── System Prompt Injection ────────────────────────────────────────

  onBeforeAgentStart(
    event: { systemPrompt?: string },
  ): { systemPrompt: string } | undefined {
    // Planning phase — inject read-only context on every turn
    if (this.phase === "planning") {
      return {
        systemPrompt: `${event.systemPrompt}\n\n${PLAN_MODE_SYSTEM_PROMPT}`,
      };
    }

    // Executing phase — inject approved plan
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

  onSessionStart(_event: unknown, ctx: ExtensionContext): void {
    // Auto-enter plan mode if --planit flag was passed
    if (this.pi.getFlag("planit")) {
      this.enterPlanning(ctx, "--planit");
      return;
    }
    this.restoreState(ctx);
  }

  onSessionShutdown(_event: unknown): void {
    this.ui.setStatus(undefined);
    this.ui.setWidget(undefined);
  }

  // ── Progress Tracking ──────────────────────────────────────────────

  onTurnEnd(event: { message?: any }): void {
    if (this.phase !== "executing") return;

    const text = this.extractAssistantText(event.message);
    if (!text) return;

    const doneMatches = text.match(/\[DONE:(\d+)\]/g);
    if (!doneMatches) return;

    const completedSteps = doneMatches.map((m) =>
      parseInt(m.replace("[DONE:", "").replace("]", ""), 10),
    );

    this.planFile.markCompleted(completedSteps);

    const total = this.planFile.getTotalSteps();
    const completed = this.planFile.getCompletedSteps();
    this.ui.setStatus(`📋 ${completed}/${total}`);
    this.ui.setWidget(this.planFile.getWidgetLines());

    if (completed === total) {
      this.phase = "idle";
      this.ui.setStatus(undefined);
      this.ui.notify("All plan steps complete.");
    }
  }

  // ── State Persistence ──────────────────────────────────────────────

  private persistState(_ctx: ExtensionContext): void {
    this.pi.appendEntry("planit", {
      phase: this.phase,
      planFilePath: this.planFile.getFilePath(),
      planContent: this.planFile.getContent(),
      restoredTools: this.restoredTools,
    });
  }

  private restoreState(ctx: ExtensionContext): void {
    try {
      const entries = ctx.sessionManager.getBranch();
      let lastEntry: { data: any } | undefined;

      for (const entry of entries) {
        if (entry.type === "custom" && entry.customType === "planit") {
          lastEntry = entry as any;
        }
      }

      if (!lastEntry) return;

      const data = lastEntry.data;
      if (!data?.phase || data.phase === "idle") return;

      // Reconstruct plan file from persisted content
      if (data.planContent && data.planFilePath) {
        fs.writeFileSync(data.planFilePath, data.planContent, "utf-8");
        this.planFile.filePath = data.planFilePath;
        this.planFile.content = data.planContent;
        this.planFile.parseChecklist();
      } else if (data.planFilePath && fs.existsSync(data.planFilePath)) {
        this.planFile.load(data.planFilePath);
      } else {
        return; // No plan file to restore
      }

      // Restore captured tools
      this.restoredTools = data.restoredTools ?? null;

      if (data.phase === "planning") {
        const readOnlyTools = this.getReadOnlyTools();
        if (readOnlyTools.length > 0) {
          this.pi.setActiveTools(readOnlyTools);
        }
        this.phase = "planning";
        this.ui.setStatus("⏸ plan (restored)");
        this.ui.showPlanningWidget(
          this.planFile.getFilePath(),
          this.planFile.getTitle(),
          this.planFile.getWidgetLines(),
        );
        this.ui.notify("Plan mode restored from session.");
      } else if (data.phase === "executing") {
        if (this.restoredTools && this.restoredTools.length > 0) {
          this.pi.setActiveTools(this.restoredTools);
        }
        this.phase = "executing";
        const completed = this.planFile.getCompletedSteps();
        const total = this.planFile.getTotalSteps();
        this.ui.setStatus(`📋 ${completed}/${total}`);
        this.ui.setWidget(this.planFile.getWidgetLines());
        this.ui.notify("Plan execution restored from session.");
      }
    } catch (err) {
      console.error(`Planit: Failed to restore state: ${err}`);
    }
  }

  // ── Review Flow ────────────────────────────────────────────────────

  private reviewPlan(ctx: ExtensionContext): void {
    if (!this.planFile.hasSteps()) {
      this.ui.notify("No plan to review. Ask the agent to write a plan first.");
      return;
    }

    this.ui.showReviewMenu(
      this.planFile.getContent(),
      this.planFile.getFilePath(),
      this.planFile.getTitle(),
    ).then((result) => {
      if (!result) return;

      switch (result) {
        case "buildAuto":
          this.buildAuto(ctx);
          break;
        case "buildGuided":
          this.buildGuided(ctx);
          break;
        case "continueEditing":
          this.continueEditing(ctx);
          break;
      }
    });
  }

  private buildAuto(ctx: ExtensionContext): void {
    this.buildMode = "auto";
    this.phase = "executing";

    // Restore the full tool set captured when plan mode was entered
    if (this.restoredTools && this.restoredTools.length > 0) {
      this.pi.setActiveTools(this.restoredTools);
    }

    this.ui.notify("Building (auto) — executing all steps.");
    this.persistState(ctx);
  }

  private buildGuided(ctx: ExtensionContext): void {
    this.buildMode = "guided";
    this.phase = "executing";

    // Restore the full tool set captured when plan mode was entered
    if (this.restoredTools && this.restoredTools.length > 0) {
      this.pi.setActiveTools(this.restoredTools);
    }

    this.ui.notify(
      "Building (guided) — writes enabled, plan as reference.",
    );
    this.persistState(ctx);
  }

  private continueEditing(ctx: ExtensionContext): void {
    this.phase = "planning";

    // Restore read-only tools
    const readOnlyTools = this.getReadOnlyTools();
    if (readOnlyTools.length > 0) {
      this.pi.setActiveTools(readOnlyTools);
    }

    this.ui.setStatus("⏸ plan");
    this.ui.showPlanningWidget(
      this.planFile.getFilePath(),
      this.planFile.getTitle(),
      this.planFile.getWidgetLines(),
    );
    this.ui.notify(
      "Back to planning. Edit the plan and ask the agent to explore further.",
    );
    this.persistState(ctx);
  }

  // ── Plan Execution Commands ────────────────────────────────────────

  /**
   * Show a plan picker menu and load the selected plan into planning mode.
   */
  private async resumePlan(ctx: ExtensionContext): Promise<void> {
    const plans = PlanFile.listPlans(ctx.cwd);

    if (plans.length === 0) {
      this.ui.notify("No plans found for this project.");
      return;
    }

    const uiCtx = this.getUiContext(ctx);

    // If no UI, load the most recent plan
    if (!uiCtx.hasUI) {
      const latest = plans[0];
      this.planFile.load(latest.filePath);
      const readOnlyTools = this.getReadOnlyTools();
      if (readOnlyTools.length > 0) {
        this.pi.setActiveTools(readOnlyTools);
      }
      this.phase = "planning";
      this.ui.setStatus("⏸ plan (restored)");
      this.ui.showPlanningWidget(
        this.planFile.getFilePath(),
        this.planFile.getTitle(),
        this.planFile.getWidgetLines(),
      );
      this.ui.notify(`Plan restored: ${plans[0].filename}`);
      this.persistState(ctx);
      return;
    }

    // Show picker menu with plan filenames
    const options = plans.map((p) => {
      const readable = p.filename.replace(/\.md$/, "");
      // Strip timestamp for readability (format: name-YYYY-MM-DDTHH-mm-ss)
      const parts = readable.split(/-\d{4}-\d{2}-\d{2}T/);
      const displayName = parts.length > 1 ? parts[0] : readable;
      return `${displayName} (${new Date(p.modified).toLocaleString()})`;
    });

    const selected = await uiCtx.ui.select("Select plan to resume", options);
    if (!selected) return;

    const selectedIndex = options.indexOf(selected);
    const selectedPlan = plans[selectedIndex];

    // Exit any current mode first
    if (this.isPlanMode) {
      this.exitPlanning(ctx);
    } else if (this.isExecuting) {
      this.phase = "idle";
      if (this.restoredTools && this.restoredTools.length > 0) {
        this.pi.setActiveTools(this.restoredTools);
      }
      this.restoredTools = null;
      this.ui.setStatus(undefined);
      this.ui.notify("Execution cancelled.");
    }

    // Load the selected plan
    this.planFile.load(selectedPlan.filePath);

    // Enter planning mode with the loaded plan
    const readOnlyTools = this.getReadOnlyTools();
    if (readOnlyTools.length > 0) {
      this.pi.setActiveTools(readOnlyTools);
    }
    this.phase = "planning";
    this.ui.setStatus("⏸ plan");
    this.ui.showPlanningWidget(
      this.planFile.getFilePath(),
      this.planFile.getTitle(),
      this.planFile.getWidgetLines(),
    );
    this.ui.notify(`Plan restored: ${selectedPlan.filename}`);
    this.persistState(ctx);
  }

  /**
   * Cancel current execution or planning and return to the appropriate state.
   */
  private cancelPlan(ctx: ExtensionContext): void {
    if (this.isExecuting) {
      // Return to planning: restore read-only tools
      this.phase = "planning";
      const readOnlyTools = this.getReadOnlyTools();
      if (readOnlyTools.length > 0) {
        this.pi.setActiveTools(readOnlyTools);
      }
      this.ui.setStatus("⏸ plan");
      this.ui.showPlanningWidget(
        this.planFile.getFilePath(),
        this.planFile.getTitle(),
        this.planFile.getWidgetLines(),
      );
      this.ui.notify("Execution cancelled. Back to planning.");
      this.persistState(ctx);
    } else if (this.isPlanMode) {
      // Exit planning: same as /planit off
      this.exitPlanning(ctx);
    } else {
      // Idle — nothing to cancel
      this.ui.notify("Nothing to cancel.");
    }
  }

  // ── Registration ───────────────────────────────────────────────────

  register(pi: ExtensionAPI): void {
    // Commands
    pi.registerCommand("planit", {
      description:
        "Manage plan mode. Usage: /planit, /planit on, /planit off, /planit resume, /planit cancel, /planit status, /planit review",
      handler: async (args: string, ctx: ExtensionContext) => {
        const raw = args.trim().toLowerCase();

        if (raw.length === 0) {
          // Toggle: idle <-> planning, executing -> planning
          if (this.isExecuting) {
            this.cancelPlan(ctx);
          } else if (this.isPlanMode) {
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
          // Show status + widget
          if (this.isPlanMode) {
            this.ui.notify("Plan mode: ON (read-only)");
            this.ui.showPlanningWidget(
              this.planFile.getFilePath(),
              this.planFile.getTitle(),
              this.planFile.getWidgetLines(),
            );
          } else if (this.isExecuting) {
            const total = this.planFile.getTotalSteps();
            const completed = this.planFile.getCompletedSteps();
            this.ui.notify("Plan mode: executing approved plan");
            this.ui.setStatus(`\uD83D\uDCCB ${completed}/${total}`);
            this.ui.setWidget(this.planFile.getWidgetLines());
          } else {
            this.ui.notify("Plan mode: OFF (default YOLO mode)");
          }
          return;
        }

        if (raw === "resume") {
          await this.resumePlan(ctx);
          return;
        }

        if (raw === "cancel") {
          this.cancelPlan(ctx);
          return;
        }

        if (raw === "review") {
          this.reviewPlan(ctx);
          return;
        }

        // If plan mode is off and a task is provided, enable it first
        if (!this.isPlanMode) {
          this.enterPlanning(ctx);
        }

        pi.sendUserMessage(args, { deliverAs: "followUp" });
      },
    });

    // Flag
    pi.registerFlag("planit", {
      description: "Start in plan mode",
      type: "boolean",
      default: false,
    });

    // Event handlers
    pi.on("tool_call", (event, ctx) => {
      (this.ui as any).setContext(ctx);
      const result = this.onToolCall(event);
      if (result) return result;
      return;
    });

    pi.on("before_agent_start", (event) => {
      return this.onBeforeAgentStart(event);
    });

    pi.on("session_start", (_event, ctx) => {
      (this.ui as any).setContext(ctx);
      this.onSessionStart(_event, ctx);
    });

    pi.on("session_shutdown", (_event, ctx) => {
      (this.ui as any).setContext(ctx);
      this.onSessionShutdown(_event);
    });

    pi.on("session_tree", (_event, ctx) => {
      (this.ui as any).setContext(ctx);
      this.restoreState(ctx);
    });

    pi.on("turn_end", (event, ctx) => {
      (this.ui as any).setContext(ctx);
      this.onTurnEnd(event);
    });

    // ── Custom Tool: write_plan ──────────────────────────────────────
    //
    // The agent uses this instead of the blocked `write` tool to
    // save plans during planning mode.

    const pm = this;
    pi.registerTool({
      name: "write_plan",
      label: "Write Plan",
      description:
        "Write or update the plan file. Use this instead of the write tool in plan mode.",
      parameters: {
        type: "object",
        properties: {
          content: {
            type: "string",
            description:
              "The complete plan content to write to the plan file.",
          },
        },
        required: ["content"],
      },
      async execute(
        _toolCallId: string,
        params: { content: string },
        _signal: AbortSignal,
        _onUpdate: unknown,
        _ctx: ExtensionContext,
      ) {
        if (!pm.isPlanMode) {
          return {
            content: [
              {
                type: "text",
                text:
                  "Error: Not in plan mode. Use /planit to enter.",
              },
            ],
            details: { approved: false },
          };
        }

        fs.writeFileSync(pm.planFile.getFilePath(), params.content, "utf-8");
        pm.planFile.content = params.content;
        pm.planFile.parseChecklist();

        return {
          content: [
            {
              type: "text",
              text: `Plan written to ${pm.planFile.getFilePath()}. ${pm.planFile.getTotalSteps()} steps found.`,
            },
          ],
          details: { approved: true },
        };
      },
    });
  }

  // ── Helpers ────────────────────────────────────────────────────────

  /** Extract UI context from the current extension context. */
  private getUiContext(ctx: ExtensionContext) {
    const c = ctx as any;
    return c as { hasUI: boolean; ui: { notify: (m: string, t?: string) => void; setStatus: (n: string, s?: string) => void; setWidget: (n: string, l?: string[]) => void; select: (t: string, o: string[]) => Promise<string | undefined>; confirm: (q: string, a: string) => Promise<boolean> } };
  }

  private extractAssistantText(message: unknown): string {
    if (!message || (message as any).role !== "assistant") return "";

    const msg = message as any;

    if (typeof msg.content === "string") {
      return msg.content;
    }

    if (!Array.isArray(msg.content)) return "";

    return msg.content
      .filter(
        (block: unknown) =>
          typeof block === "object" &&
          block !== null &&
          (block as any).type === "text",
      )
      .map((block: unknown) => (block as any).text ?? "")
      .join("\n");
  }
}
