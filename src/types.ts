export type PlanPhase = "idle" | "planning" | "executing";

export interface PlanModeConfig {
  /** Tool names allowed in plan mode (intersection with available tools) */
  allowedTools: string[];
  /** Tools that are always blocked regardless of allowedTools */
  blockedTools?: string[];
}

export interface ChecklistItem {
  step: number;
  text: string;
  completed: boolean;
}

