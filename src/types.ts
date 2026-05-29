export type PlanPhase = "idle" | "planning" | "building";

export interface PlanModeConfig {
  /** Tool names allowed in plan mode (intersection with available tools) */
  allowedTools: string[];
  /** Tools that are always blocked regardless of allowedTools */
  blockedTools?: string[];
  /** Where to store plan files: "global" (~/.pi/agent/plans/) or "local" (<cwd>/.pi/plans/) */
  planStorage?: "global" | "local";
}
