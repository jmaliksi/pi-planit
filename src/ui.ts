import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";

/**
 * Lightweight UI helper that delegates to ExtensionUIContext.
 * All methods are no-ops when hasUI is false (print/RPC mode).
 */
export class PlanUI {
  notify(message: string, type: "info" | "warning" | "error" = "info", hasUI: boolean, ui: ExtensionUIContext): void {
    if (!hasUI) return;
    ui.notify(message, type);
  }

  setStatus(status: string | undefined, hasUI: boolean, ui: ExtensionUIContext): void {
    if (!hasUI) return;
    ui.setStatus("planit", status);
  }

  setWidget(lines: string[] | undefined, hasUI: boolean, ui: ExtensionUIContext): void {
    if (!hasUI) return;
    ui.setWidget("planit-plan", lines);
  }

  /** Show plan file path and title in widget (used during planning). */
  showPlanningWidget(
    planFilePath: string | undefined,
    title: string | null,
    hasUI: boolean,
    ui: ExtensionUIContext,
  ): void {
    if (!planFilePath) {
      this.setWidget(["📋 Planning — no file written yet (use /planit:write to save)"], hasUI, ui);
      return;
    }
    this.setWidget([
      `📋 Plan: ${title ?? "untitled"}`,
      `   ${planFilePath}`,
    ], hasUI, ui);
  }

  /** Show plan file path in widget during building phase. */
  showBuildingWidget(
    planFilePath: string | undefined,
    title: string | null,
    hasUI: boolean,
    ui: ExtensionUIContext,
  ): void {
    if (!planFilePath) {
      this.setWidget(["🔨 Building — plan in chat"], hasUI, ui);
      return;
    }
    this.setWidget([
      `🔨 Building: ${title ?? "untitled"}`,
      `   ${planFilePath}`,
    ], hasUI, ui);
  }

  /**
   * Ask the user how they want to execute the plan.
   * Returns "auto" if the agent should execute autonomously,
   * "manual" if the user will drive, or null if cancelled.
   */
  async showBuildPrompt(hasUI: boolean, ui: ExtensionUIContext): Promise<"auto" | "manual" | null> {
    if (!hasUI) return "auto";

    const choice = await ui.select(
      "How do you want to build?",
      ["Agent executes automatically", "I'll drive (plan injected as context)"],
    );

    if (!choice) return null;
    return choice.startsWith("Agent") ? "auto" : "manual";
  }
}
