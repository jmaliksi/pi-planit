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
}
