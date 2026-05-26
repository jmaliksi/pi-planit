import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";

/** Review action returned from the plan review menu. */
export type ReviewAction = "buildAuto" | "buildGuided" | "continueEditing";

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
    ui.setWidget("planit-todos", lines);
  }

  /** Show plan checklist + file path in widget (used during planning). */
  showPlanningWidget(
    planFilePath: string,
    title: string | null,
    lines: string[],
    hasUI: boolean,
    ui: ExtensionUIContext,
  ): void {
    const rendered = [
      `📋 Plan: ${title ?? "untitled"}`,
      `   [path: ${planFilePath}]`,
      "",
      ...lines,
    ];
    this.setWidget(rendered, hasUI, ui);
  }

  /** Show plan in a scrollable editor, then prompt for review action. */
  async showReviewMenu(
    planContent: string,
    planFilePath: string,
    title: string | null,
    hasUI: boolean,
    ui: ExtensionUIContext,
  ): Promise<ReviewAction | null> {
    if (!hasUI) {
      this.notify("Plan mode requires interactive TUI. Auto-approving.", "info", hasUI, ui);
      return "buildAuto";
    }

    const header = `📋 Plan: ${title ?? "untitled"}\n   [path: ${planFilePath}]\n\n`;

    // Show the plan in a proper scrollable editor
    // Enter = approve, Esc = cancel (continue editing)
    const result = await ui.editor("Plan Review", header + planContent);
    if (result === undefined) {
      // User pressed Escape — return to planning
      return "continueEditing";
    }

    // User pressed Enter — ask which build mode
    const options = [
      "↺ Build (auto)",
      "✓ Build (guided)",
      "↻ Continue editing",
    ];

    const choice = await ui.select("Build mode", options);
    if (!choice) return null;

    const actionMap: Record<string, ReviewAction> = {
      [options[0]]: "buildAuto",
      [options[1]]: "buildGuided",
      [options[2]]: "continueEditing",
    };

    return actionMap[choice];
  }
}
