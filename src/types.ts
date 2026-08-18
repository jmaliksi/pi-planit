export type PlanPhase = "idle" | "planning" | "building";

export interface PlanModeConfig {
  /** Tool names allowed in plan mode (intersection with available tools) */
  allowedTools: string[];
  /** Tools that are always blocked regardless of allowedTools */
  blockedTools?: string[];
  /** Where to store plan files: "global" (~/.pi/agent/plans/) or "local" (<cwd>/.pi/plans/) */
  planStorage?: "global" | "local";
  /** Directory containing custom system prompt .md files (planning.md, building.md, writing.md). Falls back to bundled defaults if not set. */
  systemPromptDir?: string;
  /** When building, drop the /planit:write exchange from LLM context (the plan is injected via the system prompt). Only active when a plan file has content. */
  avoidPlanDuplication?: boolean;
  /** When enabled (default), follow-up plan writes show a diff preview and require confirmation before overwriting the plan file. Skipped on first writes and in headless sessions (no UI). */
  previewDiff?: boolean;
  /** Custom instruction injected into the system prompt during manual/user-driven build. Overrides the bundled default. Falls back to building-manual.md in systemPromptDir when unset. */
  manualBuildPause?: string;
}
