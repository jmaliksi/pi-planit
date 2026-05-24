/** Review action returned from the plan review menu. */
export type ReviewAction = "buildAuto" | "buildGuided" | "continueEditing";

/** Minimal UI context — what we actually need from ExtensionContext. */
interface UiContext {
  hasUI: boolean;
  ui: {
    notify: (message: string, type?: "info" | "warning" | "error") => void;
    setStatus: (name: string, status?: string) => void;
    setWidget: (name: string, lines?: string[]) => void;
    select: (title: string, options: string[]) => Promise<string | undefined>;
  };
}

export class PlanUI {
  private uiContext: UiContext | undefined;

  /** Attach the current UI context (called from event handlers that receive ctx). */
  setContext(ctx: UiContext): void {
    this.uiContext = ctx;
  }

  notify(message: string, type: "info" | "warning" | "error" = "info"): void {
    if (this.uiContext?.hasUI) {
      this.uiContext.ui.notify(message, type);
    }
  }

  setStatus(status: string | undefined): void {
    if (this.uiContext?.hasUI) {
      this.uiContext.ui.setStatus("planit", status);
    }
  }

  setWidget(lines: string[] | undefined): void {
    if (this.uiContext?.hasUI) {
      if (lines && lines.length > 0) {
        this.uiContext.ui.setWidget("planit-todos", lines);
      } else {
        this.uiContext.ui.setWidget("planit-todos", undefined);
      }
    }
  }

  /** Show plan checklist + file path in widget (used during planning). */
  showPlanningWidget(planFilePath: string, title: string | null, lines: string[]): void {
    const rendered = [
      `📋 Plan: ${title ?? "untitled"}`,
      `   [path: ${planFilePath}]`,
      "",
      ...lines,
    ];
    this.setWidget(rendered);
  }

  /** Show full plan content + review menu (used during review). */
  async showReviewMenu(
    planContent: string,
    planFilePath: string,
    title: string | null,
  ): Promise<ReviewAction | null> {
    if (!this.uiContext?.hasUI) {
      this.notify("Plan mode requires interactive TUI. Auto-approving.");
      return "buildAuto";
    }

    const rendered = [
      `📋 Plan: ${title ?? "untitled"}`,
      `   [path: ${planFilePath}]`,
      "",
      planContent,
      "",
      "── Review Options ──",
    ];
    this.setWidget(rendered);

    const options = [
      { label: "↺ Build (auto)" },
      { label: "✓ Build (guided)" },
      { label: "↻ Continue editing" },
    ];

    const result = await this.uiContext.ui.select("Plan Review", options.map((o) => o.label));
    if (!result) return null;

    const actionMap: Record<string, ReviewAction> = {
      [options[0].label]: "buildAuto",
      [options[1].label]: "buildGuided",
      [options[2].label]: "continueEditing",
    };

    return actionMap[result];
  }
}
