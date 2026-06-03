import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { PlanMode } from "../src/plan-mode";
import { PlanFile, setResolvedPlansDir } from "../src/plan-file";

// ── Helpers ──────────────────────────────────────────────────────────

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

// ── Phase 1 Tests: Tool Restoration ──────────────────────────────────

describe("PlanMode — tool restoration", () => {
  let mockPI: ReturnType<typeof createMockPI>;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("enterPlanning", () => {
    it("restricts tools to read-only set", () => {
      const fullTools = [
        { name: "read" },
        { name: "edit" },
        { name: "write" },
        { name: "bash" },
        { name: "grep" },
      ];
      mockPI = createMockPI(fullTools);

      const pm = new PlanMode(mockPI.pi);
      const ctx = mockPI.pi.getContext()!;

      (pm as any).enterPlanning(ctx);

      const firstCall = mockPI.calls[0];
      expect(firstCall).toContain("read");
      expect(firstCall).toContain("bash");
      expect(firstCall).toContain("grep");
      expect(firstCall).not.toContain("edit");
      expect(firstCall).not.toContain("write");
    });
  });

  describe("exitToIdle", () => {
    it("restores the full captured tool set", () => {
      const fullTools = [
        { name: "read" },
        { name: "edit" },
        { name: "write" },
      ];
      mockPI = createMockPI(fullTools);

      const pm = new PlanMode(mockPI.pi);
      const ctx = mockPI.pi.getContext()!;

      (pm as any).enterPlanning(ctx);

      const callsBefore = mockPI.calls.length;
      (pm as any).exitToIdle(ctx);

      expect(mockPI.calls.length).toBeGreaterThan(callsBefore);

      const lastCall = mockPI.calls[mockPI.calls.length - 1];
      for (const tool of fullTools) {
        expect(lastCall).toContain(tool.name);
      }
    });

    it("transitions to idle from planning", () => {
      const fullTools = [{ name: "read" }, { name: "write" }];
      mockPI = createMockPI(fullTools);

      const pm = new PlanMode(mockPI.pi);
      const ctx = mockPI.pi.getContext()!;

      (pm as any).enterPlanning(ctx);
      expect(pm.isPlanMode).toBe(true);

      (pm as any).exitToIdle(ctx);

      expect(pm.isPlanMode).toBe(false);
      expect(pm.isBuilding).toBe(false);
    });
  });
});

// ── Phase 2 Tests: discardPlan ────────────────────────────────────────

describe("PlanMode — discardPlan", () => {
  let backupHome: string | undefined;
  let tmpHome: string;

  beforeEach(() => {
    vi.restoreAllMocks();
    backupHome = process.env.HOME;
    tmpHome = "/tmp/planit-discard-test-" + Date.now();
    process.env.HOME = tmpHome;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (backupHome !== undefined) {
      process.env.HOME = backupHome;
    } else {
      delete process.env.HOME;
    }
    try { fs.rmSync(tmpHome, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it("notifies nothing to discard from idle", async () => {
    const { pi } = createMockPI();
    const pm = new PlanMode(pi);
    const ctx = pi.getContext()!;
    const notify = vi.fn();
    (ctx as any).hasUI = true;
    (ctx as any).ui = { notify, setStatus: vi.fn(), setWidget: vi.fn(), select: vi.fn(), confirm: vi.fn() };

    await (pm as any).discardPlan(ctx);

    expect(pm.isPlanMode).toBe(false);
    expect(pm.isBuilding).toBe(false);
    expect(notify).toHaveBeenCalledWith("Nothing to discard.", "info");
  });

  it("exits to idle from planning without plan file", async () => {
    const { pi } = createMockPI([{ name: "read" }, { name: "write" }]);
    const pm = new PlanMode(pi);
    const ctx = pi.getContext()!;
    (ctx as any).ui = { notify: vi.fn(), setStatus: vi.fn(), setWidget: vi.fn(), select: vi.fn(), confirm: vi.fn() };

    (pm as any).enterPlanning(ctx);
    expect(pm.isPlanMode).toBe(true);

    await (pm as any).discardPlan(ctx);

    expect(pm.isPlanMode).toBe(false);
  });

  it("asks to delete plan file if one exists during discard", async () => {
    const { pi } = createMockPI([{ name: "read" }]);
    const pm = new PlanMode(pi);
    const ctx = pi.getContext()!;
    const confirm = vi.fn().mockResolvedValue(true);
    (ctx as any).hasUI = true;
    (ctx as any).ui = { notify: vi.fn(), setStatus: vi.fn(), setWidget: vi.fn(), select: vi.fn(), confirm };

    // Set up a plan file
    const planDir = path.join(tmpHome, ".pi", "agent", "plans", "--tmp--test-project");
    fs.mkdirSync(planDir, { recursive: true });
    const planPath = path.join(planDir, "test-plan-2026-01-01T00-00-00.md");
    fs.writeFileSync(planPath, "# Test Plan\n");
    (pm as any).planFile.load(planPath);
    (pm as any).phase = "planning";
    (pm as any).restoredTools = ["read"];

    await (pm as any).discardPlan(ctx);

    expect(confirm).toHaveBeenCalled();
    expect(fs.existsSync(planPath)).toBe(false);
    expect(pm.isPlanMode).toBe(false);
  });

  it("keeps plan file if user declines deletion", async () => {
    const { pi } = createMockPI([{ name: "read" }]);
    const pm = new PlanMode(pi);
    const ctx = pi.getContext()!;
    const confirm = vi.fn().mockResolvedValue(false);
    (ctx as any).hasUI = true;
    (ctx as any).ui = { notify: vi.fn(), setStatus: vi.fn(), setWidget: vi.fn(), select: vi.fn(), confirm };

    const planDir = path.join(tmpHome, ".pi", "agent", "plans", "--tmp--test-project");
    fs.mkdirSync(planDir, { recursive: true });
    const planPath = path.join(planDir, "test-plan-2026-01-01T00-00-00.md");
    fs.writeFileSync(planPath, "# Test Plan\n");
    (pm as any).planFile.load(planPath);
    (pm as any).phase = "planning";
    (pm as any).restoredTools = ["read"];

    await (pm as any).discardPlan(ctx);

    expect(fs.existsSync(planPath)).toBe(true);
    expect(pm.isPlanMode).toBe(false);
  });
});

describe("PlanMode — finishPlan", () => {
  let backupHome: string | undefined;
  let tmpHome: string;

  beforeEach(() => {
    vi.restoreAllMocks();
    backupHome = process.env.HOME;
    tmpHome = "/tmp/planit-finish-test-" + Date.now();
    process.env.HOME = tmpHome;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (backupHome !== undefined) {
      process.env.HOME = backupHome;
    } else {
      delete process.env.HOME;
    }
    try { fs.rmSync(tmpHome, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it("refuses to finish from planning phase", async () => {
    const { pi } = createMockPI([{ name: "read" }]);
    const pm = new PlanMode(pi);
    const ctx = pi.getContext()!;
    const notify = vi.fn();
    (ctx as any).hasUI = true;
    (ctx as any).ui = { notify, setStatus: vi.fn(), setWidget: vi.fn() };

    (pm as any).phase = "planning";

    await (pm as any).finishPlan(ctx);

    expect(notify).toHaveBeenCalledWith(
      "Finish only works from building phase. Use /planit:discard instead.",
      "warning",
    );
    expect(pm.isPlanMode).toBe(true);
  });

  it("finishes and offers to delete from building phase", async () => {
    const { pi } = createMockPI([{ name: "read" }]);
    const pm = new PlanMode(pi);
    const ctx = pi.getContext()!;
    const confirm = vi.fn().mockResolvedValue(true);
    (ctx as any).hasUI = true;
    (ctx as any).ui = { notify: vi.fn(), setStatus: vi.fn(), setWidget: vi.fn(), select: vi.fn(), confirm };

    const planDir = path.join(tmpHome, ".pi", "agent", "plans", "--tmp--test-project");
    fs.mkdirSync(planDir, { recursive: true });
    const planPath = path.join(planDir, "build-plan-2026-01-01T00-00-00.md");
    fs.writeFileSync(planPath, "# Build Plan\n");
    (pm as any).planFile.load(planPath);
    (pm as any).phase = "building";
    (pm as any).restoredTools = ["read"];

    await (pm as any).finishPlan(ctx);

    expect(confirm).toHaveBeenCalled();
    expect(fs.existsSync(planPath)).toBe(false);
    expect(pm.isPlanMode).toBe(false);
    expect(pm.isBuilding).toBe(false);
  });
});

describe("PlanMode — exitPlanMode", () => {
  let backupHome: string | undefined;
  let tmpHome: string;

  beforeEach(() => {
    vi.restoreAllMocks();
    backupHome = process.env.HOME;
    tmpHome = "/tmp/planit-exit-test-" + Date.now();
    process.env.HOME = tmpHome;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (backupHome !== undefined) {
      process.env.HOME = backupHome;
    } else {
      delete process.env.HOME;
    }
    try { fs.rmSync(tmpHome, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it("warns about plan file when exiting from building", async () => {
    const { pi } = createMockPI([{ name: "read" }]);
    const pm = new PlanMode(pi);
    const ctx = pi.getContext()!;
    const notify = vi.fn();
    (ctx as any).hasUI = true;
    (ctx as any).ui = { notify, setStatus: vi.fn(), setWidget: vi.fn() };

    (pm as any).phase = "building";
    (pm as any).restoredTools = ["read"];

    await (pm as any).exitPlanMode(ctx);

    expect(notify).toHaveBeenNthCalledWith(
      1,
      "Plan mode exited from building. Use /planit:discard to delete the plan file.",
      "warning",
    );
    expect(notify).toHaveBeenNthCalledWith(
      2,
      "Plan mode exited. Tools restored.",
      "info",
    );
    expect(pm.isPlanMode).toBe(false);
    expect(pm.isBuilding).toBe(false);
  });

  it("exits silently from planning (no build warning)", async () => {
    const { pi } = createMockPI([{ name: "read" }]);
    const pm = new PlanMode(pi);
    const ctx = pi.getContext()!;
    const notify = vi.fn();
    (ctx as any).hasUI = true;
    (ctx as any).ui = { notify, setStatus: vi.fn(), setWidget: vi.fn() };

    (pm as any).phase = "planning";
    (pm as any).restoredTools = ["read"];

    await (pm as any).exitPlanMode(ctx);

    expect(notify).toHaveBeenCalledWith("Plan mode exited. Tools restored.", "info");
    expect(pm.isPlanMode).toBe(false);
  });
});

// ── Phase 3 Tests: resumePlan ─────────────────────────────────────────

describe("PlanMode — resumePlan", () => {
  let backupHome: string | undefined;
  let tmpHome: string;

  beforeEach(() => {
    vi.restoreAllMocks();
    backupHome = process.env.HOME;
    tmpHome = "/tmp/planit-resume-test-" + Date.now();
    process.env.HOME = tmpHome;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (backupHome !== undefined) {
      process.env.HOME = backupHome;
    } else {
      delete process.env.HOME;
    }
    try { fs.rmSync(tmpHome, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it("notifies when no plans exist", async () => {
    const { pi } = createMockPI();
    const pm = new PlanMode(pi);
    const ctx = pi.getContext()!;
    const notify = vi.fn();
    (ctx as any).hasUI = true;
    (ctx as any).ui = { notify, setStatus: vi.fn(), setWidget: vi.fn(), select: vi.fn().mockResolvedValue(undefined), confirm: vi.fn() };

    await (pm as any).resumePlan(ctx);
    expect(notify).toHaveBeenCalledWith("No plans found for this project.", "info");
  });

  it("loads plan from disk in non-UI mode and enters planning", async () => {
    const projectDir = path.join(tmpHome, ".pi", "agent", "plans", "--tmp--test-project");
    fs.mkdirSync(projectDir, { recursive: true });
    const planPath = path.join(projectDir, "migrate-auth-2026-01-01T00-00-00.md");
    fs.writeFileSync(planPath, "# Migrate Auth\n\nSome plan content.");

    const { pi } = createMockPI([{ name: "read" }, { name: "bash" }]);
    const pm = new PlanMode(pi);
    const ctx = pi.getContext()!;
    (ctx as any).hasUI = false;
    (ctx as any).ui = { notify: vi.fn(), setStatus: vi.fn(), setWidget: vi.fn(), select: vi.fn(), confirm: vi.fn() };

    await (pm as any).resumePlan(ctx);

    expect(pm.isPlanMode).toBe(true);
    expect((pm as any).planFile.getFilePath()).toBe(planPath);
    expect((pm as any).planFile.getTitle()).toBe("Migrate Auth");
  });
});

// ── Phase 4 Tests: restoreState ───────────────────────────────────────

describe("PlanMode — restoreState", () => {
  let backupHome: string | undefined;
  let tmpHome: string;

  beforeEach(() => {
    vi.restoreAllMocks();
    backupHome = process.env.HOME;
    tmpHome = "/tmp/planit-restore-test-" + Date.now();
    process.env.HOME = tmpHome;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (backupHome !== undefined) {
      process.env.HOME = backupHome;
    } else {
      delete process.env.HOME;
    }
    try { fs.rmSync(tmpHome, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it("does nothing when no planit entry exists", () => {
    const { pi } = createMockPI([{ name: "read" }, { name: "edit" }]);
    const pm = new PlanMode(pi);
    const ctx = pi.getContext()!;
    (ctx as any).sessionManager = { getBranch: () => [] };
    (ctx as any).ui = { notify: vi.fn(), setStatus: vi.fn(), setWidget: vi.fn() };

    (pm as any).restoreState(ctx);

    expect(pm.isPlanMode).toBe(false);
    expect(pm.isBuilding).toBe(false);
  });

  it("does nothing when planit entry has idle phase", () => {
    const { pi } = createMockPI([{ name: "read" }]);
    const pm = new PlanMode(pi);
    const ctx = pi.getContext()!;
    (ctx as any).sessionManager = {
      getBranch: () => [{ type: "custom", customType: "planit", data: { phase: "idle" } }],
    };
    (ctx as any).ui = { notify: vi.fn(), setStatus: vi.fn(), setWidget: vi.fn() };

    (pm as any).restoreState(ctx);
    expect(pm.isPlanMode).toBe(false);
  });

  it("restores planning mode from a planit entry", () => {
    const { pi } = createMockPI([{ name: "read" }, { name: "edit" }, { name: "write" }]);

    const projectDir = path.join(tmpHome, ".pi", "agent", "plans", "--tmp--test-project");
    fs.mkdirSync(projectDir, { recursive: true });
    const planPath = path.join(projectDir, "test-plan-2026-01-01T00-00-00.md");
    const planContent = "# Test Plan\n\nSome plan details.";
    fs.writeFileSync(planPath, planContent);

    const pm = new PlanMode(pi);
    const ctx = pi.getContext()!;
    (ctx as any).sessionManager = {
      getBranch: () => [{
        type: "custom",
        customType: "planit",
        data: { phase: "planning", planFilePath: planPath, planContent, restoredTools: ["read", "edit", "write"] },
      }],
    };
    (ctx as any).ui = { notify: vi.fn(), setStatus: vi.fn(), setWidget: vi.fn() };

    (pm as any).restoreState(ctx);

    expect(pm.isPlanMode).toBe(true);
    expect(pm.isBuilding).toBe(false);
    expect((pm as any).planFile.getFilePath()).toBe(planPath);
    expect((pm as any).planFile.getTitle()).toBe("Test Plan");
  });

  it("restores building mode from a planit entry", () => {
    const { pi } = createMockPI([{ name: "read" }, { name: "edit" }, { name: "write" }]);

    const projectDir = path.join(tmpHome, ".pi", "agent", "plans", "--tmp--test-project");
    fs.mkdirSync(projectDir, { recursive: true });
    const planPath = path.join(projectDir, "build-plan-2026-01-01T00-00-00.md");
    const planContent = "# Build Plan\n\nImplementation details.";
    fs.writeFileSync(planPath, planContent);

    const pm = new PlanMode(pi);
    const ctx = pi.getContext()!;
    (ctx as any).sessionManager = {
      getBranch: () => [{
        type: "custom",
        customType: "planit",
        data: { phase: "building", planFilePath: planPath, planContent, restoredTools: ["read", "edit", "write"] },
      }],
    };
    (ctx as any).ui = { notify: vi.fn(), setStatus: vi.fn(), setWidget: vi.fn() };

    (pm as any).restoreState(ctx);

    expect(pm.isBuilding).toBe(true);
    expect(pm.isPlanMode).toBe(false);
    expect((pm as any).planFile.getContent()).toBe(planContent);
  });

  it("falls back to loading plan file from disk when content is missing", () => {
    const { pi } = createMockPI([{ name: "read" }]);

    const projectDir = path.join(tmpHome, ".pi", "agent", "plans", "--tmp--test-project");
    fs.mkdirSync(projectDir, { recursive: true });
    const planPath = path.join(projectDir, "fallback-plan-2026-01-01T00-00-00.md");
    const planContent = "# Fallback Plan\n\nFallback details.";
    fs.writeFileSync(planPath, planContent);

    const pm = new PlanMode(pi);
    const ctx = pi.getContext()!;
    (ctx as any).sessionManager = {
      getBranch: () => [{
        type: "custom",
        customType: "planit",
        data: { phase: "planning", planFilePath: planPath, restoredTools: ["read"] },
      }],
    };
    (ctx as any).ui = { notify: vi.fn(), setStatus: vi.fn(), setWidget: vi.fn() };

    (pm as any).restoreState(ctx);

    expect(pm.isPlanMode).toBe(true);
    expect((pm as any).planFile.hasContent()).toBe(true);
  });
});

// ── Phase 5 Tests: session_tree ───────────────────────────────────────

describe("PlanMode — session_tree", () => {
  let backupHome: string | undefined;
  let tmpHome: string;

  beforeEach(() => {
    vi.restoreAllMocks();
    backupHome = process.env.HOME;
    tmpHome = "/tmp/planit-tree-test-" + Date.now();
    process.env.HOME = tmpHome;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (backupHome !== undefined) {
      process.env.HOME = backupHome;
    } else {
      delete process.env.HOME;
    }
    try { fs.rmSync(tmpHome, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it("reconstructs state on tree navigation", () => {
    const { pi } = createMockPI([{ name: "read" }, { name: "edit" }]);

    const projectDir = path.join(tmpHome, ".pi", "agent", "plans", "--tmp--test-project");
    fs.mkdirSync(projectDir, { recursive: true });
    const planPath = path.join(projectDir, "tree-plan-2026-01-01T00-00-00.md");
    const planContent = "# Tree Plan\n\nTree plan content.";
    fs.writeFileSync(planPath, planContent);

    const pm = new PlanMode(pi);
    const ctx = pi.getContext()!;
    (ctx as any).sessionManager = {
      getBranch: () => [{
        type: "custom",
        customType: "planit",
        data: { phase: "planning", planFilePath: planPath, planContent, restoredTools: ["read"] },
      }],
    };
    (ctx as any).ui = { notify: vi.fn(), setStatus: vi.fn(), setWidget: vi.fn() };

    (pm as any).restoreState(ctx);

    expect(pm.isPlanMode).toBe(true);
  });
});

// ── Phase 6 Tests: PlanFile.listPlans ────────────────────────────────

describe("PlanFile.listPlans", () => {
  let backupHome: string | undefined;
  let tmpHome: string;

  beforeEach(() => {
    vi.restoreAllMocks();
    backupHome = process.env.HOME;
    tmpHome = "/tmp/planit-list-test-" + Date.now();
    process.env.HOME = tmpHome;
    setResolvedPlansDir(path.join(tmpHome, ".pi", "agent", "plans"));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (backupHome !== undefined) {
      process.env.HOME = backupHome;
    } else {
      delete process.env.HOME;
    }
    try { fs.rmSync(tmpHome, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it("returns empty array when no plans exist", () => {
    const plans = PlanFile.listPlans("/tmp/nonexistent-project");
    expect(plans).toEqual([]);
  });

  it("lists available plans sorted by modification time", () => {
    const projectDir = path.join(tmpHome, ".pi", "agent", "plans", "--tmp--test");
    fs.mkdirSync(projectDir, { recursive: true });

    const older = path.join(projectDir, "old-plan-2026-01-01T00-00-00.md");
    const newer = path.join(projectDir, "new-plan-2026-06-01T00-00-00.md");

    fs.writeFileSync(older, "# Old");
    fs.writeFileSync(newer, "# New");

    const oldTime = new Date("2026-01-01");
    fs.utimesSync(older, oldTime, oldTime);

    const plans = PlanFile.listPlans("/tmp/test");
    expect(plans.length).toBe(2);
    expect(plans[0].filename).toBe("new-plan-2026-06-01T00-00-00.md");
    expect(plans[1].filename).toBe("old-plan-2026-01-01T00-00-00.md");
  });
});
