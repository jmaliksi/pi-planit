export type PlanPhase = "idle" | "planning" | "planned" | "executing";

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

/** Phases where the user has full tool access and control. */
export type UserControlPhase = "planned" | "executing";

