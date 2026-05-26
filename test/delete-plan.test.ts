import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { PlanMode } from "../src/plan-mode";

// ── Mocks ────────────────────────────────────────────────────────────

function createMockPI(
  availableTools: { name: string }[] = [],
): { pi: ExtensionAPI; calls: string[][] } {
  const calls: string[][] = [];

  const pi = {
    getAllTools: vi.fn(() => availableTools),
    setActiveTools: vi.fn((tools: string[]) => {
      calls.push([...tools]);
    }),
    getContext: vi.fn(() => ({
      hasUI: false,
      cwd: "/tmp/test-project",
      ui: {
        notify: vi.fn(),
        setStatus: vi.fn(),
        setWidget: vi.fn(),
        select: vi.fn(),
        confirm: vi.fn(),
        showPlanningWidget: vi.fn(),
        editor: vi.fn(),
      },
    })),
    on: vi.fn(),
    registerCommand: vi.fn(),
    registerFlag: vi.fn(),
    registerShortcut: vi.fn(),
    registerTool: vi.fn(),
    sendUserMessage: vi.fn(),
    getFlag: vi.fn(() => undefined),
    appendEntry: vi.fn(),
  } as unknown as ExtensionAPI;

  return { pi, calls };
}

function plansDir(cwd: string): string {
  const home = process.env.HOME!;
  return path.join(home, ".pi", "agent", "plans", cwd.replace(/\//g, "--"));
}

function createPlanFile(cwd: string, filename: string, content: string): string {
  const dir = plansDir(cwd);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, filename);
  fs.writeFileSync(filePath, content);
  return filePath;
}

// ── Tests ────────────────────────────────────────────────────────────

describe("PlanMode — plan deletion and discard", () => {
  let backupHome: string | undefined;
  let tmpHome: string;

  beforeEach(() => {
    vi.restoreAllMocks();
    backupHome = process.env.HOME;
    tmpHome = "/tmp/planit-delete-test-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6);
    process.env.HOME = tmpHome;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (backupHome !== undefined) {
      process.env.HOME = backupHome;
    } else {
      delete process.env.HOME;
    }
    try {
      fs.rmSync(tmpHome, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  // ── deletePlan ─────────────────────────────────────────────────

  describe("deletePlan", () => {
    it("notifies when no plans exist", async () => {
      const { pi } = createMockPI();
      const pm = new PlanMode(pi);
      const ctx = pi.getContext()!;
      (ctx as any).hasUI = true;
      const notify = vi.fn();
      ctx.ui = {
        notify,
        setStatus: vi.fn(),
        setWidget: vi.fn(),
        select: vi.fn(),
        confirm: vi.fn(),
        showPlanningWidget: vi.fn(),
        editor: vi.fn(),
      };

      await (pm as any).deletePlan(ctx);

      expect(notify).toHaveBeenCalledWith("No plans found for this project.", "info");
    });

    it("deletes selected plan with confirmation", async () => {
      const { pi } = createMockPI();
      const cwd = "/tmp/test-project";
      const planPath = createPlanFile(cwd, "test-plan-2026-01-01T00-00-00.md", "# Test Plan\n## Summary\n\n## Steps\n- [ ] Step 1\n");
      const pm = new PlanMode(pi);
      const ctx = pi.getContext()!;
      (ctx as any).hasUI = true;
      const notify = vi.fn();
      ctx.ui = {
        notify,
        setStatus: vi.fn(),
        setWidget: vi.fn(),
        select: vi.fn().mockImplementation((_title: string, opts: string[]) => opts[0]),
        confirm: vi.fn().mockResolvedValue(true),
        showPlanningWidget: vi.fn(),
        editor: vi.fn(),
      };

      await (pm as any).deletePlan(ctx);

      expect(fs.existsSync(planPath)).toBe(false);
      expect(notify).toHaveBeenCalledWith(expect.stringContaining("Plan deleted:"), "info");
    });

    it("cancels deletion when user denies confirmation", async () => {
      const { pi } = createMockPI();
      const cwd = "/tmp/test-project";
      const planPath = createPlanFile(cwd, "test-plan-2026-01-01T00-00-00.md", "# Test Plan\n## Summary\n\n## Steps\n- [ ] Step 1\n");
      const pm = new PlanMode(pi);
      const ctx = pi.getContext()!;
      (ctx as any).hasUI = true;
      const notify = vi.fn();
      ctx.ui = {
        notify,
        setStatus: vi.fn(),
        setWidget: vi.fn(),
        select: vi.fn().mockImplementation((_title: string, opts: string[]) => opts[0]),
        confirm: vi.fn().mockResolvedValue(false),
        showPlanningWidget: vi.fn(),
        editor: vi.fn(),
      };

      await (pm as any).deletePlan(ctx);

      expect(fs.existsSync(planPath)).toBe(true);
      expect(notify).toHaveBeenCalledWith("Deletion cancelled.", "info");
    });

    it("cancels when user backs out of plan selection", async () => {
      const { pi } = createMockPI();
      const cwd = "/tmp/test-project";
      const planPath = createPlanFile(cwd, "test-plan-2026-01-01T00-00-00.md", "# Test Plan\n");
      const pm = new PlanMode(pi);
      const ctx = pi.getContext()!;
      (ctx as any).hasUI = true;
      const notify = vi.fn();
      ctx.ui = {
        notify,
        setStatus: vi.fn(),
        setWidget: vi.fn(),
        select: vi.fn().mockResolvedValue(undefined),
        confirm: vi.fn(),
        showPlanningWidget: vi.fn(),
        editor: vi.fn(),
      };

      await (pm as any).deletePlan(ctx);

      expect(fs.existsSync(planPath)).toBe(true);
      expect(notify).toHaveBeenCalledWith("Deletion cancelled.", "info");
    });

    it("deletes the latest plan in non-UI mode", async () => {
      const { pi } = createMockPI();
      const cwd = "/tmp/test-project";
      const olderPath = createPlanFile(cwd, "older-plan-2026-01-01T00-00-00.md", "# Older\n");
      const newerPath = createPlanFile(cwd, "newer-plan-2026-06-01T00-00-00.md", "# Newer\n");
      const oldTime = new Date("2026-01-01");
      fs.utimesSync(olderPath, oldTime, oldTime);

      const pm = new PlanMode(pi);
      const ctx = pi.getContext()!;
      (ctx as any).hasUI = false;
      ctx.ui = {
        notify: vi.fn(),
        setStatus: vi.fn(),
        setWidget: vi.fn(),
        select: vi.fn(),
        confirm: vi.fn(),
        showPlanningWidget: vi.fn(),
        editor: vi.fn(),
      };

      await (pm as any).deletePlan(ctx);

      expect(fs.existsSync(newerPath)).toBe(false);
      expect(fs.existsSync(olderPath)).toBe(true);
    });
  });

  // ── discardPlan ────────────────────────────────────────────────

  describe("discardPlan", () => {
    it("notifies when no active plan", async () => {
      const { pi } = createMockPI();
      const pm = new PlanMode(pi);
      const ctx = pi.getContext()!;
      (ctx as any).hasUI = true;
      const notify = vi.fn();
      ctx.ui = {
        notify,
        setStatus: vi.fn(),
        setWidget: vi.fn(),
        select: vi.fn(),
        confirm: vi.fn(),
        showPlanningWidget: vi.fn(),
        editor: vi.fn(),
      };

      await (pm as any).discardPlan(ctx);

      expect(notify).toHaveBeenCalledWith("No active plan to discard.", "info");
    });

    it("discards active plan with confirmation", async () => {
      const { pi } = createMockPI();
      const cwd = "/tmp/test-project";
      const planPath = createPlanFile(cwd, "active-plan-2026-01-01T00-00-00.md", "# Active\n## Steps\n- [ ] Step 1\n");
      const pm = new PlanMode(pi);
      const ctx = pi.getContext()!;
      (ctx as any).hasUI = true;
      const notify = vi.fn();
      ctx.ui = {
        notify,
        setStatus: vi.fn(),
        setWidget: vi.fn(),
        select: vi.fn(),
        confirm: vi.fn().mockResolvedValue(true),
        showPlanningWidget: vi.fn(),
        editor: vi.fn(),
      };
      (pm as any).planFile.load(planPath);

      await (pm as any).discardPlan(ctx);

      expect(fs.existsSync(planPath)).toBe(false);
      expect(notify).toHaveBeenCalledWith(expect.stringContaining("Plan discarded:"), "info");
      expect((pm as any).planFile.getFilePath()).toBe("");
    });

    it("cancels discard when user denies confirmation", async () => {
      const { pi } = createMockPI();
      const cwd = "/tmp/test-project";
      const planPath = createPlanFile(cwd, "active-plan-2026-01-01T00-00-00.md", "# Active\n## Steps\n- [ ] Step 1\n");
      const pm = new PlanMode(pi);
      const ctx = pi.getContext()!;
      (ctx as any).hasUI = true;
      const notify = vi.fn();
      ctx.ui = {
        notify,
        setStatus: vi.fn(),
        setWidget: vi.fn(),
        select: vi.fn(),
        confirm: vi.fn().mockResolvedValue(false),
        showPlanningWidget: vi.fn(),
        editor: vi.fn(),
      };
      (pm as any).planFile.load(planPath);

      await (pm as any).discardPlan(ctx);

      expect(fs.existsSync(planPath)).toBe(true);
      expect(notify).toHaveBeenCalledWith("Discard cancelled.", "info");
      expect((pm as any).planFile.getFilePath()).toBe(planPath);
    });

    it("discards without UI (no confirm)", async () => {
      const { pi } = createMockPI();
      const cwd = "/tmp/test-project";
      const planPath = createPlanFile(cwd, "active-plan-2026-01-01T00-00-00.md", "# Active\n## Steps\n- [ ] Step 1\n");
      const pm = new PlanMode(pi);
      const ctx = pi.getContext()!;
      (ctx as any).hasUI = false;
      ctx.ui = {
        notify: vi.fn(),
        setStatus: vi.fn(),
        setWidget: vi.fn(),
        select: vi.fn(),
        confirm: vi.fn(),
        showPlanningWidget: vi.fn(),
        editor: vi.fn(),
      };
      (pm as any).planFile.load(planPath);

      await (pm as any).discardPlan(ctx);

      expect(fs.existsSync(planPath)).toBe(false);
      expect((pm as any).planFile.getFilePath()).toBe("");
    });

    it("discards from executing mode", async () => {
      const { pi, calls } = createMockPI([{ name: "read" }, { name: "edit" }]);
      const cwd = "/tmp/test-project";
      const planPath = createPlanFile(cwd, "exec-plan-2026-01-01T00-00-00.md", "# Exec\n## Steps\n- [ ] Step 1\n");
      const pm = new PlanMode(pi);
      const ctx = pi.getContext()!;
      (ctx as any).hasUI = true;
      const notify = vi.fn();
      ctx.ui = {
        notify,
        setStatus: vi.fn(),
        setWidget: vi.fn(),
        select: vi.fn(),
        confirm: vi.fn().mockResolvedValue(true),
        showPlanningWidget: vi.fn(),
        editor: vi.fn(),
      };
      (pm as any).planFile.load(planPath);
      (pm as any).phase = "executing";
      (pm as any).restoredTools = ["read", "edit"];

      await (pm as any).discardPlan(ctx);

      expect(fs.existsSync(planPath)).toBe(false);
      expect((pm as any).phase).toBe("idle");
      // setActiveTools should have been called to restore full tool set
      expect(calls.length).toBeGreaterThan(0);
    });

    it("throws when plan file on disk is missing", async () => {
      const { pi } = createMockPI();
      const cwd = "/tmp/test-project";
      const ghostPath = path.join(plansDir(cwd), "ghost-plan-2026-01-01T00-00-00.md");
      const pm = new PlanMode(pi);
      const ctx = pi.getContext()!;
      (ctx as any).hasUI = true;
      ctx.ui = {
        notify: vi.fn(),
        setStatus: vi.fn(),
        setWidget: vi.fn(),
        select: vi.fn(),
        confirm: vi.fn().mockResolvedValue(true),
        showPlanningWidget: vi.fn(),
        editor: vi.fn(),
      };
      (pm as any).planFile.filePath = ghostPath;

      await expect((pm as any).discardPlan(ctx)).rejects.toThrow(/ENOENT|no such file|exist/);
    });
  });
});
