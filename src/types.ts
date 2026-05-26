export type PlanPhase = "idle" | "planning" | "review" | "executing";

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

export interface ToolEvent {
  toolName: string;
  input?: any;
}

export interface ContextEvent {
  systemPrompt?: string;
}

