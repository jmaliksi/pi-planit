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
  /** Model to use during planning phase. Set to "provider/model-id" (e.g., "anthropic/claude-sonnet-4-20250514") to use a specific model, or "auto" (default) to use the currently active model. */
  planningModel?: string;
  /** Model to use during building phase. Set to "provider/model-id" (e.g., "anthropic/claude-sonnet-4-20250514") to use a specific model, or "auto" (default) to use the currently active model. */
  buildingModel?: string;
}
