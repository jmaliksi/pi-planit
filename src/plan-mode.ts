import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawn } from "node:child_process";
import type {
  ExtensionAPI,
  ExtensionContext,
  ToolCallEvent,
  BeforeAgentStartEvent,
  AgentEndEvent,
} from "@earendil-works/pi-coding-agent";
import type {
  PlanPhase,
  PlanModeConfig,
} from "./types";
import { PlanFile, setResolvedPlansDir } from "./plan-file";
import { BashFilter } from "./bash-filter";
import { PlanUI } from "./ui";
import { agentPath, resolvePlansDir } from "./path-utils";
import { Container, Text } from "@earendil-works/pi-tui";

// ── Bundled default prompt paths ─────────────────────────────────────

const bundledPromptDir = path.join(__dirname, "prompts");

export class PlanMode {
  private phase: PlanPhase = "idle";
  private restoredTools: string[] | null = null;
  private cwd: string = "";
  private planFile: PlanFile;
  private bashFilter: BashFilter;
  private ui: PlanUI;
  private config: PlanModeConfig;

  /** Cached system prompts loaded from files or bundled defaults. */
  private planningPrompt: string = "";
  private buildingPrompt: string = "";
  private writingPrompt: string = "";
  private promptsLoaded: boolean = false;

  /** Set when /planit:write is pending an agent response to capture and write. */
  private pendingPlanWrite: boolean = false;

  constructor(
    private pi: ExtensionAPI,
    planFile: PlanFile = new PlanFile(),
    bashFilter: BashFilter = new BashFilter(),
  ) {
    this.planFile = planFile;
    this.bashFilter = bashFilter;
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
      ],
      blockedTools: ["edit", "write", "ast_rewrite"],
      planStorage: "global",
    };

    try {
      const configDir = agentPath("extensions", "pi-planit");
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
        planStorage: parsed.planStorage ?? defaultConfig.planStorage,
        systemPromptDir: parsed.systemPromptDir,
      };
    } catch (err) {
      console.error(`Planit: Failed to load config, using defaults: ${err}`);
      return defaultConfig;
    }
  }

  getConfig(): PlanModeConfig {
    return this.config;
  }

  get isPlanMode(): boolean {
    return this.phase === "planning";
  }

  get isBuilding(): boolean {
    return this.phase === "building";
  }

  // ── System Prompt Loading ──────────────────────────────────────────

  private loadPrompt(_ctx: ExtensionContext, name: string): string {
    // Try custom directory first
    if (this.config.systemPromptDir) {
      const customPath = path.join(this.config.systemPromptDir, `${name}.md`);
      if (fs.existsSync(customPath)) {
        return fs.readFileSync(customPath, "utf-8").trim();
      }
      console.warn(
        `Planit: Custom prompt not found at ${customPath}, falling back to bundled default.`,
      );
    }

    // Fall back to bundled default
    const bundledPath = path.join(bundledPromptDir, `${name}.md`);
    if (fs.existsSync(bundledPath)) {
      return fs.readFileSync(bundledPath, "utf-8").trim();
    }

    console.error(`Planit: Bundled prompt not found at ${bundledPath}`);
    return "";
  }

  private ensurePromptsLoaded(ctx: ExtensionContext): void {
    if (this.promptsLoaded) return;
    this.planningPrompt = this.loadPrompt(ctx, "planning");
    this.buildingPrompt = this.loadPrompt(ctx, "building");
    this.writingPrompt = this.loadPrompt(ctx, "writing");
    this.promptsLoaded = true;
  }

  // ── Tool Switching ─────────────────────────────────────────────────

  private captureCurrentTools(): void {
    const currentTools = this.pi.getAllTools().map((t) => t.name);
    this.restoredTools = currentTools.length > 0 ? [...currentTools] : null;
  }

  private getReadOnlyTools(): string[] {
    const allTools = this.pi.getAllTools().map((t) => t.name);
    return this.config.allowedTools.filter((t) => allTools.includes(t));
  }

  private enterPlanning(ctx: ExtensionContext): void {
    if (this.phase === "planning") {
      this.ui.notify("Plan mode is already enabled.", "info", ctx.hasUI, ctx.ui);
      return;
    }

    this.cwd = ctx.cwd;
    setResolvedPlansDir(resolvePlansDir(this.cwd, this.config.planStorage ?? "global"));
    this.captureCurrentTools();

    const readOnlyTools = this.getReadOnlyTools();
    if (readOnlyTools.length === 0) {
      this.ui.notify("No read-only tools available.", "error", ctx.hasUI, ctx.ui);
      return;
    }

    this.pi.setActiveTools(readOnlyTools);
    this.phase = "planning";
    this.ui.setStatus("⏸ planning", ctx.hasUI, ctx.ui);
    this.ui.showPlanningWidget(
      this.planFile.getFilePath() || undefined,
      this.planFile.getTitle(),
      ctx.hasUI,
      ctx.ui,
    );
    this.ui.notify("Plan mode enabled (read-only). Explore and discuss. Use /planit:write to save a plan.", "info", ctx.hasUI, ctx.ui);
    this.persistState(ctx);
  }

  /** Exit to idle without any delete prompt. General escape hatch. */
  private exitToIdle(ctx: ExtensionContext): void {
    if (this.phase === "idle") {
      this.ui.notify("Already idle.", "info", ctx.hasUI, ctx.ui);
      return;
    }

    this.phase = "idle";
    this.pendingPlanWrite = false;

    if (this.restoredTools && this.restoredTools.length > 0) {
      this.pi.setActiveTools(this.restoredTools);
    }
    this.restoredTools = null;

    this.ui.setWidget(undefined, ctx.hasUI, ctx.ui);
    this.ui.setStatus(undefined, ctx.hasUI, ctx.ui);
    this.ui.notify("Plan mode exited. Tools restored.", "info", ctx.hasUI, ctx.ui);
    this.persistState(ctx);
  }

  /** Exit to idle with a warning about plan file safety when coming from building. */
  private async exitToIdleWithBuildWarning(ctx: ExtensionContext): Promise<void> {
    if (this.phase === "building") {
      this.ui.notify(
        "Plan mode exited from building. Use /planit:discard to delete the plan file.",
        "warning",
        ctx.hasUI,
        ctx.ui,
      );
    }
    this.exitToIdle(ctx);
  }

  // ── Tool Call Gating ───────────────────────────────────────────────

  onToolCall(event: ToolCallEvent): { block: true; reason: string } | undefined {
    if (this.phase !== "planning") return undefined;

    if (this.config.blockedTools?.includes(event.toolName)) {
      return {
        block: true,
        reason: "Plan mode is read-only. Write tools are blocked.",
      };
    }

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

    return undefined;
  }

  // ── System Prompt Injection ────────────────────────────────────────

  onBeforeAgentStart(event: BeforeAgentStartEvent): { systemPrompt: string } | undefined {
    if (this.phase === "planning") {
      return {
        systemPrompt: `${event.systemPrompt}\n\n${this.planningPrompt}`,
      };
    }

    if (this.phase === "building" && this.planFile.hasContent()) {
      const fileRef = this.planFile.getFilePath()
        ? `\nPlan file: ${this.planFile.getFilePath()}\n`
        : "";
      const interpolated = this.buildingPrompt
        .replaceAll("{planFilePath}", fileRef)
        .replaceAll("{planContent}", this.planFile.getContent());
      return {
        systemPrompt: `${event.systemPrompt}\n\n${interpolated}`,
      };
    }

    return undefined;
  }

  // ── Session Lifecycle ──────────────────────────────────────────────

  onSessionStart(_event: unknown, ctx: ExtensionContext): void {
    this.ensurePromptsLoaded(ctx);

    if (this.pi.getFlag("planit")) {
      this.enterPlanning(ctx);
      return;
    }
    this.restoreState(ctx);
  }

  // ── Agent End: capture plan write if pending ────────────────────────

  onAgentEnd(event: AgentEndEvent, ctx: ExtensionContext): void {
    if (!this.pendingPlanWrite) return;
    this.pendingPlanWrite = false;

    // Find the last assistant text message
    const messages = event.messages ?? [];
    let lastAssistantText = "";
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i] as any;
      if (msg.role === "assistant") {
        const content = msg.content;
        if (typeof content === "string") {
          lastAssistantText = content;
          break;
        } else if (Array.isArray(content)) {
          const textParts = content
            .filter((c: any) => c.type === "text")
            .map((c: any) => c.text as string);
          if (textParts.length > 0) {
            lastAssistantText = textParts.join("\n");
            break;
          }
        }
      }
    }

    if (!lastAssistantText) {
      this.ui.notify("Could not capture plan summary from agent response.", "warning", ctx.hasUI, ctx.ui);
      return;
    }

    // Initialize file on first write
    if (!this.planFile.getFilePath()) {
      this.planFile.init(this.cwd, "plan");
    }

    this.planFile.write(lastAssistantText);
    this.ui.notify(`Plan saved to ${this.planFile.getFilePath()}`, "info", ctx.hasUI, ctx.ui);
    this.ui.showPlanningWidget(
      this.planFile.getFilePath(),
      this.planFile.getTitle(),
      ctx.hasUI,
      ctx.ui,
    );
    this.persistState(ctx);
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

      if (data.planFilePath) {
        this.planFile.load(data.planFilePath, data.planContent);
      }

      this.restoredTools = this.pi.getAllTools().map((t) => t.name);

      if (data.phase === "planning") {
        const readOnlyTools = this.getReadOnlyTools();
        if (readOnlyTools.length > 0) {
          this.pi.setActiveTools(readOnlyTools);
        }
        this.phase = "planning";
        this.cwd = ctx.cwd;
        setResolvedPlansDir(resolvePlansDir(this.cwd, this.config.planStorage ?? "global"));
        this.ui.setStatus("⏸ planning (restored)", ctx.hasUI, ctx.ui);
        this.ui.showPlanningWidget(
          this.planFile.getFilePath() || undefined,
          this.planFile.getTitle(),
          ctx.hasUI,
          ctx.ui,
        );
        this.ui.notify("Plan mode restored from session.", "info", ctx.hasUI, ctx.ui);
      } else if (data.phase === "building") {
        if (this.restoredTools && this.restoredTools.length > 0) {
          this.pi.setActiveTools(this.restoredTools);
        }
        this.phase = "building";
        this.cwd = ctx.cwd;
        setResolvedPlansDir(resolvePlansDir(this.cwd, this.config.planStorage ?? "global"));
        this.ui.setStatus("🔨 building (restored)", ctx.hasUI, ctx.ui);
        this.ui.showBuildingWidget(
          this.planFile.getFilePath() || undefined,
          this.planFile.getTitle(),
          ctx.hasUI,
          ctx.ui,
        );
        this.ui.notify("Build mode restored from session.", "info", ctx.hasUI, ctx.ui);
      }
    } catch (err) {
      console.error(`Planit: Failed to restore state: ${err}`);
    }
  }

  // ── Plan Commands ──────────────────────────────────────────────────

  /**
   * Trigger the LLM to summarize the chat and write/merge the plan file.
   */
  private writePlan(ctx: ExtensionContext, title?: string): void {
    if (this.phase !== "planning") {
      this.ui.notify("Not in planning mode. Use /planit to start.", "warning", ctx.hasUI, ctx.ui);
      return;
    }

    // Initialize file path if this is the first write
    if (!this.planFile.getFilePath()) {
      this.planFile.init(this.cwd, title ?? "plan");
    }

    this.pendingPlanWrite = true;

    const existingContent = this.planFile.hasContent()
      ? `\n\nExisting plan file content to merge with:\n\`\`\`\n${this.planFile.getContent()}\n\`\`\``
      : "";

    const instruction = `${this.writingPrompt}${existingContent}`;

    this.pi.sendUserMessage(instruction, { deliverAs: "followUp" });
  }

  /**
   * Exit to idle from any phase.
   */
  private async exitPlanMode(ctx: ExtensionContext): Promise<void> {
    if (this.phase === "idle") {
      this.ui.notify("Already idle.", "info", ctx.hasUI, ctx.ui);
      return;
    }

    if (this.phase === "building") {
      await this.exitToIdleWithBuildWarning(ctx);
    } else {
      this.exitToIdle(ctx);
    }
  }

  /**
   * Transition to building phase: restore full tools, inject plan as context.
   */
  private async startBuild(ctx: ExtensionContext): Promise<void> {
    if (this.phase !== "planning") {
      this.ui.notify("Not in planning mode.", "warning", ctx.hasUI, ctx.ui);
      return;
    }

    const mode = await this.ui.showBuildPrompt(ctx.hasUI, ctx.ui);
    if (mode === null) {
      this.ui.notify("Build cancelled.", "info", ctx.hasUI, ctx.ui);
      return;
    }

    // Restore full tools
    if (this.restoredTools && this.restoredTools.length > 0) {
      this.pi.setActiveTools(this.restoredTools);
    }

    this.phase = "building";
    this.ui.setStatus("🔨 building", ctx.hasUI, ctx.ui);
    this.ui.showBuildingWidget(
      this.planFile.getFilePath() || undefined,
      this.planFile.getTitle(),
      ctx.hasUI,
      ctx.ui,
    );
    this.persistState(ctx);

    if (mode === "auto") {
      this.ui.notify("Building — agent will execute the plan.", "info", ctx.hasUI, ctx.ui);
      this.pi.sendUserMessage(
        "Write tools restored. Start implementing the plan we discussed. Follow it step by step using available tools.",
        { deliverAs: "followUp" },
      );
    } else {
      this.ui.notify("Building — full tools restored. Plan injected as context.", "info", ctx.hasUI, ctx.ui);
    }
  }

  /**
   * Discard: exit to idle and offer to delete the plan file. Works from any phase.
   */
  private async discardPlan(ctx: ExtensionContext): Promise<void> {
    if (this.phase === "idle") {
      this.ui.notify("Nothing to discard.", "info", ctx.hasUI, ctx.ui);
      return;
    }

    const filePath = this.planFile.getFilePath();
    const fileExists = filePath && fs.existsSync(filePath);

    if (fileExists && ctx.hasUI) {
      const shouldDelete = await ctx.ui.confirm(
        "Delete plan file?",
        `A plan file exists at ${filePath}. Delete it?`,
      );
      if (shouldDelete) {
        fs.unlinkSync(filePath);
        this.planFile = new PlanFile();
        this.ui.notify("Plan file deleted.", "info", ctx.hasUI, ctx.ui);
      }
    }

    this.exitToIdle(ctx);
  }

  /**
   * Finish: same as discard but only works from building phase.
   */
  private async finishPlan(ctx: ExtensionContext): Promise<void> {
    if (this.phase !== "building") {
      this.ui.notify("Finish only works from building phase. Use /planit:discard instead.", "warning", ctx.hasUI, ctx.ui);
      return;
    }
    await this.discardPlan(ctx);
  }

  /**
   * Show a plan picker and resume planning from a saved file.
   */
  private async resumePlan(ctx: ExtensionContext): Promise<void> {
    setResolvedPlansDir(resolvePlansDir(ctx.cwd, this.config.planStorage ?? "global"));
    const plans = PlanFile.listPlans(ctx.cwd);

    if (plans.length === 0) {
      this.ui.notify("No plans found for this project.", "info", ctx.hasUI, ctx.ui);
      return;
    }

    const options = plans.map((p) => `${p.title}  (${p.filename.replace(/\.md$/, "")})`);

    let selectedPlan = plans[0];

    if (ctx.hasUI) {
      const selected = await ctx.ui.select("Select plan to resume", options);
      if (!selected) return;
      const idx = options.indexOf(selected);
      selectedPlan = plans[idx];
    }

    // Exit current mode first
    if (this.phase !== "idle") {
      this.exitToIdle(ctx);
    }

    this.planFile.load(selectedPlan.filePath);
    this.captureCurrentTools();

    const readOnlyTools = this.getReadOnlyTools();
    if (readOnlyTools.length > 0) {
      this.pi.setActiveTools(readOnlyTools);
    }
    this.phase = "planning";
    this.cwd = ctx.cwd;

    this.ui.setStatus("⏸ planning (restored)", ctx.hasUI, ctx.ui);
    this.ui.showPlanningWidget(
      this.planFile.getFilePath(),
      this.planFile.getTitle(),
      ctx.hasUI,
      ctx.ui,
    );
    this.ui.notify(`Plan resumed: ${selectedPlan.filename}`, "info", ctx.hasUI, ctx.ui);
    this.persistState(ctx);
  }

  /**
   * Show a plan picker and delete a saved file.
   */
  private async deletePlan(ctx: ExtensionContext): Promise<void> {
    setResolvedPlansDir(resolvePlansDir(ctx.cwd, this.config.planStorage ?? "global"));
    const plans = PlanFile.listPlans(ctx.cwd);

    if (plans.length === 0) {
      this.ui.notify("No plans found for this project.", "info", ctx.hasUI, ctx.ui);
      return;
    }

    if (!ctx.hasUI) {
      const latest = plans[0];
      fs.unlinkSync(latest.filePath);
      this.ui.notify(`Plan deleted: ${latest.filename}`, "info", ctx.hasUI, ctx.ui);
      return;
    }

    const options = plans.map((p) => `${p.title}  (${p.filename.replace(/\.md$/, "")})`);

    const selected = await ctx.ui.select("Select plan to delete", options);
    if (!selected) {
      this.ui.notify("Deletion cancelled.", "info", ctx.hasUI, ctx.ui);
      return;
    }

    const idx = options.indexOf(selected);
    const selectedPlan = plans[idx];

    const confirmed = await ctx.ui.confirm(
      "Delete plan?",
      `Delete "${selectedPlan.filename}"? This cannot be undone.`,
    );

    if (!confirmed) {
      this.ui.notify("Deletion cancelled.", "info", ctx.hasUI, ctx.ui);
      return;
    }

    fs.unlinkSync(selectedPlan.filePath);
    this.ui.notify(`Plan deleted: ${selectedPlan.filename}`, "info", ctx.hasUI, ctx.ui);
  }

  // ── Plan Review ────────────────────────────────────────────────────

  /**
   * Open the current plan file in the user's external editor ($VISUAL/$EDITOR).
   * Pi's TUI suspends while the editor is active. Changes are written back on exit.
   * Works from any phase (idle, planning, building).
   */
  private async reviewPlan(ctx: ExtensionContext): Promise<void> {
    const filePath = this.planFile.getFilePath();
    const content = this.planFile.getContent();

    if (!filePath || !content.trim()) {
      this.ui.notify(
        "No plan written yet. Use `/planit:write` to create one first.",
        "info",
        ctx.hasUI,
        ctx.ui,
      );
      return;
    }

    const editorCmd = process.env.VISUAL || process.env.EDITOR;
    if (!editorCmd) {
      this.ui.notify(
        "External editor not set. Set `$VISUAL` or `$EDITOR` to edit.",
        "info",
        ctx.hasUI,
        ctx.ui,
      );
      return;
    }

    const tmpFile = path.join(os.tmpdir(), `pi-plan-review-${Date.now()}.md`);

    // ctx.ui.custom() is the only way to get a TUI handle for stop/start.
    // We use it purely as a vehicle — the editor opens immediately, no overlay.
    await ctx.ui.custom<undefined>(async (tui, _theme, _kb, done) => {
      try {
        // Write plan content to temp file
        fs.writeFileSync(tmpFile, content, "utf-8");

        // Stop TUI to release terminal to the editor
        tui.stop();

        const [editor, ...editorArgs] = editorCmd.split(" ");
        process.stdout.write(
          `Launching external editor: ${editorCmd}\nPi will resume when the editor exits.\n`,
        );

        await new Promise<void>((resolve) => {
          const child = spawn(editor, [...editorArgs, tmpFile], {
            stdio: "inherit",
            shell: process.platform === "win32",
          });
          child.on("error", () => resolve());
          child.on("close", () => resolve());
        });

        // Read back — user may have saved or not
        const newContent = fs.readFileSync(tmpFile, "utf-8").replace(/\n$/, "");

        // Write back to the plan file if content changed
        if (newContent !== content) {
          fs.writeFileSync(filePath, newContent, "utf-8");
          this.planFile.content = newContent;
          this.ui.notify(
            `Plan updated (${this.planFile.getFilePath()})`,
            "info",
            ctx.hasUI,
            ctx.ui,
          );
        }
      } finally {
        // Clean up temp file
        try {
          fs.unlinkSync(tmpFile);
        } catch {
          // Ignore cleanup errors
        }
        // Restart TUI (force full re-render since editor uses alternate screen)
        tui.start();
        tui.requestRender(true);
      }

      done(undefined);
      return {
        render: () => {
          const c = new Container();
          c.addChild(new Text("", 0, 0));
          return c.render(80);
        },
        invalidate: () => {},
        handleInput: () => {},
      };
    });
  }

  // ── Registration ───────────────────────────────────────────────────

  register(pi: ExtensionAPI): void {
    // ── Bare /planit: enter planning (optionally forward args as message) ──
    pi.registerCommand("planit", {
      description: "Enter planning mode. With arguments, enter planning and forward the message.",
      handler: async (args: string, ctx: ExtensionContext) => {
        const rawArgs = args.trim();

        // No arguments: phase-dependent behavior
        if (!rawArgs) {
          if (this.phase === "idle") {
            this.enterPlanning(ctx);
          } else if (this.phase === "planning") {
            this.ui.notify("Plan mode is already enabled.", "info", ctx.hasUI, ctx.ui);
          } else {
            this.ui.notify(
              "Already in building phase. Use /planit:exit, /planit:discard, or /planit:finish to leave.",
              "warning",
              ctx.hasUI,
              ctx.ui,
            );
          }
          return;
        }

        // Has arguments: enter planning + forward as follow-up (unless already in planning/building)
        if (this.phase === "planning") {
          this.ui.notify("Plan mode is already enabled.", "info", ctx.hasUI, ctx.ui);
          return;
        }
        if (this.phase === "building") {
          this.ui.notify(
            "Already in building phase. Use /planit:exit, /planit:discard, or /planit:finish to leave.",
            "warning",
            ctx.hasUI,
            ctx.ui,
          );
          return;
        }
        // idle with args: enter planning, then forward
        this.enterPlanning(ctx);
        this.pi.sendUserMessage(rawArgs, { deliverAs: "followUp" });
      },
    });

    // ── Colon-prefixed subcommands ──
    pi.registerCommand("planit:build", {
      description: "Restore full tools, inject plan as context, optionally auto-execute",
      handler: async (_args: string, ctx: ExtensionContext) => {
        await this.startBuild(ctx);
      },
    });

    pi.registerCommand("planit:discard", {
      description: "Exit to idle; prompts to delete the plan file if one exists",
      handler: async (_args: string, ctx: ExtensionContext) => {
        await this.discardPlan(ctx);
      },
    });

    pi.registerCommand("planit:exit", {
      description: "Exit plan mode and restore full tool access",
      handler: async (_args: string, ctx: ExtensionContext) => {
        await this.exitPlanMode(ctx);
      },
    });

    pi.registerCommand("planit:finish", {
      description: "Like discard but only works from building phase",
      handler: async (_args: string, ctx: ExtensionContext) => {
        await this.finishPlan(ctx);
      },
    });

    pi.registerCommand("planit:resume", {
      description: "Browse and resume a saved plan file",
      handler: async (_args: string, ctx: ExtensionContext) => {
        await this.resumePlan(ctx);
      },
    });

    pi.registerCommand("planit:review", {
      description: "Open the current plan in your external editor ($VISUAL/$EDITOR)",
      handler: async (_args: string, ctx: ExtensionContext) => {
        await this.reviewPlan(ctx);
      },
    });

    pi.registerCommand("planit:write", {
      description: "Ask the LLM to summarize the chat and save/merge a plan file",
      handler: async (_args: string, ctx: ExtensionContext) => {
        this.writePlan(ctx);
      },
    });

    pi.registerCommand("planit:delete", {
      description: "Delete a plan file via picker and confirmation",
      handler: async (_args: string, ctx: ExtensionContext) => {
        await this.deletePlan(ctx);
      },
    });

    // Flag
    pi.registerFlag("planit", {
      description: "Start in plan mode",
      type: "boolean",
      default: false,
    });

    // Event handlers
    pi.on("tool_call", (event, _ctx) => {
      const result = this.onToolCall(event);
      if (result) return result;
      return;
    });

    pi.on("before_agent_start", (event) => {
      return this.onBeforeAgentStart(event);
    });

    pi.on("session_start", (_event, ctx) => {
      this.onSessionStart(_event, ctx);
    });

    pi.on("session_tree", (_event, ctx) => {
      this.restoreState(ctx);
    });

    pi.on("agent_end", (event: AgentEndEvent, ctx: ExtensionContext) => {
      this.onAgentEnd(event, ctx);
    });
  }
}
