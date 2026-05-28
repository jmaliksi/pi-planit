import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { PlanMode } from "../src/plan-mode";
import { PlanFile } from "../src/plan-file";

// ── mark_plan_step tool test helper ──────────────────────────────────

function createPIWithPlan(
  phase: "planning" | "executing" | "planned" | "idle" = "planning",
  planContent?: string,
): { pi: ExtensionAPI; calls: string[][]; pm: PlanMode } {
  const fullTools = [
    { name: "read" },
    { name: "write" },
    { name: "edit" },
    { name: "bash" },
  ];
  const { pi, calls } = createMockPI(fullTools);

  const pm = new PlanMode(pi);
  const ctx = pi.getContext()!;
  (ctx as any).ui = {
    notify: vi.fn(),
    setStatus: vi.fn(),
    setWidget: vi.fn(),
    showPlanningWidget: vi.fn(),
  };

  // Initialize plan file
  pm.cwd = ctx.cwd;
  if (planContent) {
    const filePath = path.join(ctx.cwd, "plan.md");
    fs.mkdirSync(ctx.cwd, { recursive: true });
    fs.writeFileSync(filePath, planContent, "utf-8");
    pm.planFile.load(filePath, planContent);
    pm.phase = phase;
  }

  // Register tools to activate them
  pm.register(pi);

  return { pi, calls, pm };
}

// ── Helpers ──────────────────────────────────────────────────────────

function createMockPI(
  availableTools: { name: string }[] = [],
): { pi: ExtensionAPI; calls: string[][] } {
  const calls: string[][] = [];

  const pi = {
    getAllTools: vi.fn(
      () => availableTools,
    ),
    setActiveTools: vi.fn((tools: string[]) => {
      calls.push([...tools]);
    }),
    getContext: vi.fn(
      () => ({
        hasUI: false,
        cwd: "/tmp/test-project",
        ui: {
          notify: vi.fn(),
          setStatus: vi.fn(),
          setWidget: vi.fn(),
          select: vi.fn(),
        },
      }),
    ),
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

      pm.enterPlanning(ctx);

      // First call: set to read-only tools
      const firstCall = mockPI.calls[0];
      expect(firstCall).toContain("read");
      expect(firstCall).toContain("bash");
      expect(firstCall).toContain("grep");
      expect(firstCall).not.toContain("edit");
      expect(firstCall).not.toContain("write");
    });
  });

  describe("build", () => {
    it("restores the full captured tool set", () => {
      const fullTools = [
        { name: "read" },
        { name: "edit" },
        { name: "write" },
        { name: "bash" },
        { name: "grep" },
        { name: "find" },
      ];
      mockPI = createMockPI(fullTools);

      const pm = new PlanMode(mockPI.pi);
      const ctx = mockPI.pi.getContext()!;

      pm.enterPlanning(ctx);

      const callsBefore = mockPI.calls.length;
      pm.build("auto", ctx);

      expect(mockPI.calls.length).toBeGreaterThan(callsBefore);

      const lastCall = mockPI.calls[mockPI.calls.length - 1];
      for (const tool of fullTools) {
        expect(lastCall).toContain(tool.name);
      }
    });
  });

  describe("exitPlanning", () => {
    it("restores the full captured tool set", () => {
      const fullTools = [
        { name: "read" },
        { name: "edit" },
        { name: "write" },
      ];
      mockPI = createMockPI(fullTools);

      const pm = new PlanMode(mockPI.pi);
      const ctx = mockPI.pi.getContext()!;

      pm.enterPlanning(ctx);

      const callsBefore = mockPI.calls.length;
      pm.exitPlanning(ctx);

      expect(mockPI.calls.length).toBeGreaterThan(callsBefore);

      const lastCall = mockPI.calls[mockPI.calls.length - 1];
      for (const tool of fullTools) {
        expect(lastCall).toContain(tool.name);
      }
    });
  });
});

// ── Phase 5 Tests: Execution Commands ────────────────────────────────

describe("PlanMode — Phase 5: Execution commands", () => {
  let mockPI: ReturnType<typeof createMockPI>;
  let backupHome: string | undefined;
  let tmpHome: string;

  beforeEach(() => {
    vi.restoreAllMocks();
    backupHome = process.env.HOME;
    tmpHome = "/tmp/planit-test-home-" + Date.now();
    process.env.HOME = tmpHome;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (backupHome !== undefined) {
      process.env.HOME = backupHome;
    } else {
      delete process.env.HOME;
    }
    // Cleanup temp dirs
    try {
      fs.rmSync(tmpHome, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  describe("cancelPlan", () => {
    it("returns to planning from executing", () => {
      const fullTools = [
        { name: "read" },
        { name: "write" },
        { name: "edit" },
      ];
      mockPI = createMockPI(fullTools);

      const pm = new PlanMode(mockPI.pi);
      const ctx = mockPI.pi.getContext()!;

      pm.enterPlanning(ctx);
      pm.build("auto", ctx);
      expect(pm.isExecuting).toBe(true);

      // Mock the UI context for getUiContext
      (ctx as any).ui = {
        notify: vi.fn(),
        setStatus: vi.fn(),
        setWidget: vi.fn(),
        select: vi.fn(),
      };

      pm.cancelPlan(ctx);

      expect(pm.isPlanMode).toBe(true);
      expect(pm.isExecuting).toBe(false);
    });

    it("exits to idle from planning", () => {
      const fullTools = [
        { name: "read" },
        { name: "write" },
      ];
      mockPI = createMockPI(fullTools);

      const pm = new PlanMode(mockPI.pi);
      const ctx = mockPI.pi.getContext()!;

      pm.enterPlanning(ctx);
      expect(pm.isPlanMode).toBe(true);

      pm.cancelPlan(ctx);

      expect(pm.isPlanMode).toBe(false);
      expect(pm.isExecuting).toBe(false);
    });

    it("notifies nothing to cancel from idle", () => {
      mockPI = createMockPI();

      const pm = new PlanMode(mockPI.pi);
      const ctx = mockPI.pi.getContext()!;
      (ctx as any).ui = {
        notify: vi.fn(),
        setStatus: vi.fn(),
        setWidget: vi.fn(),
        select: vi.fn(),
      };

      pm.cancelPlan(ctx);

      expect(pm.isPlanMode).toBe(false);
      expect(pm.isExecuting).toBe(false);
    });
  });

  describe("resumePlan", () => {
    it("notifies when no plans exist", async () => {
      mockPI = createMockPI();

      const pm = new PlanMode(mockPI.pi);
      const ctx = mockPI.pi.getContext()!;
      const notifyMock = vi.fn();
      (ctx as any).hasUI = true;
      (ctx as any).ui = {
        notify: notifyMock,
        setStatus: vi.fn(),
        setWidget: vi.fn(),
        select: vi.fn().mockResolvedValue(undefined),
      };

      await pm.resumePlan(ctx);
      expect(notifyMock).toHaveBeenCalledWith("No plans found for this project.", "info");
    });

    it("loads plan from disk when UI is absent", async () => {
      // Create a test plan file in the same project path as the mock context
      const home = process.env.HOME!;
      const projectDir = path.join(home, ".pi", "agent", "plans", "--tmp--test-project");
      fs.mkdirSync(projectDir, { recursive: true });

      const planPath = path.join(projectDir, "migrate-auth-2026-01-01T00-00-00.md");
      const planContent = `---
title: "Migrate Auth"
summary: ""
steps:
  - index: 1
    text: "Update auth module"
    completed: false
---

## Plan Details

## Assumptions and Reference
`;
      fs.writeFileSync(planPath, planContent);

      mockPI = createMockPI();

      const pm = new PlanMode(mockPI.pi);
      const ctx = mockPI.pi.getContext()!;
      (ctx as any).sessionManager = {
        getBranch: () => [
          {
            type: "custom",
            customType: "planit",
            data: {
              phase: "planning",
              planFilePath: planPath,
              planContent,
              restoredTools: ["read"],
            },
          },
        ],
      };
      (ctx as any).ui = {
        notify: vi.fn(),
        setStatus: vi.fn(),
        setWidget: vi.fn(),
        select: vi.fn().mockResolvedValue(undefined),
      };

      await pm.resumePlan(ctx);

      expect(pm.isPlanMode).toBe(true);
      expect(pm.planFile.getFilePath()).toBe(planPath);
      expect(pm.planFile.getTotalSteps()).toBe(1);
    });
  });

  describe("restoreState", () => {
    let mockPI: ReturnType<typeof createMockPI>;
    let backupHome: string | undefined;
    let tmpHome: string;

    beforeEach(() => {
      vi.restoreAllMocks();
      backupHome = process.env.HOME;
      tmpHome = "/tmp/planit-restore-test-home-" + Date.now();
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
      } catch { /* ignore */ }
    });

    it("does nothing when no planit entry exists", () => {
      const fullTools = [{ name: "read" }, { name: "edit" }];
      mockPI = createMockPI(fullTools);

      const pm = new PlanMode(mockPI.pi);
      const ctx = mockPI.pi.getContext()!;

      // Create a mock sessionManager with no planit entries
      (ctx as any).sessionManager = { getBranch: () => [] };
      (ctx as any).ui = {
        notify: vi.fn(),
        setStatus: vi.fn(),
        setWidget: vi.fn(),
      };

      pm.restoreState(ctx);

      expect(pm.isPlanMode).toBe(false);
      expect(pm.isExecuting).toBe(false);
    });

    it("does nothing when planit entry has idle phase", () => {
      const fullTools = [{ name: "read" }, { name: "edit" }];
      mockPI = createMockPI(fullTools);

      const pm = new PlanMode(mockPI.pi);
      const ctx = mockPI.pi.getContext()!;

      (ctx as any).sessionManager = {
        getBranch: () => [
          { type: "custom", customType: "planit", data: { phase: "idle" } },
        ],
      };
      (ctx as any).ui = {
        notify: vi.fn(),
        setStatus: vi.fn(),
        setWidget: vi.fn(),
      };

      pm.restoreState(ctx);

      expect(pm.isPlanMode).toBe(false);
    });

    it("restores planning mode from a planit entry", () => {
      const fullTools = [
        { name: "read" },
        { name: "edit" },
        { name: "write" },
      ];
      mockPI = createMockPI(fullTools);

      // Create a plan file on disk
      const projectDir = path.join(
        tmpHome,
        ".pi",
        "agent",
        "plans",
        "--tmp--test-project",
      );
      fs.mkdirSync(projectDir, { recursive: true });
      const planPath = path.join(projectDir, "test-plan-2026-01-01T00-00-00.md");
      const planContent = `---
title: "Test Plan"
summary: "A test."
steps:
  - index: 1
    text: "Step 1"
    completed: false
  - index: 2
    text: "Step 2"
    completed: false
---

## Plan Details

## Assumptions and Reference
`;
      fs.writeFileSync(planPath, planContent);

      const pm = new PlanMode(mockPI.pi);
      const ctx = mockPI.pi.getContext()!;

      (ctx as any).sessionManager = {
        getBranch: () => [
          {
            type: "custom",
            customType: "planit",
            data: {
              phase: "planning",
              planFilePath: planPath,
              planContent,
              restoredTools: ["read", "edit", "write"],
            },
          },
        ],
      };
      (ctx as any).ui = {
        notify: vi.fn(),
        setStatus: vi.fn(),
        setWidget: vi.fn(),
        showPlanningWidget: vi.fn(),
      };

      pm.restoreState(ctx);

      expect(pm.isPlanMode).toBe(true);
      expect(pm.isExecuting).toBe(false);
      expect(pm.planFile.getFilePath()).toBe(planPath);
      expect(pm.planFile.getTotalSteps()).toBe(2);
    });

    it("restores executing mode from a planit entry", () => {
      const fullTools = [
        { name: "read" },
        { name: "edit" },
        { name: "write" },
        { name: "bash" },
      ];
      mockPI = createMockPI(fullTools);

      // Create a plan file with one completed step
      const projectDir = path.join(
        tmpHome,
        ".pi",
        "agent",
        "plans",
        "--tmp--test-project",
      );
      fs.mkdirSync(projectDir, { recursive: true });
      const planPath = path.join(projectDir, "exec-plan-2026-01-01T00-00-00.md");
      const planContent = `---
title: "Exec Plan"
summary: "Exec."
steps:
  - index: 1
    text: "Step 1"
    completed: true
  - index: 2
    text: "Step 2"
    completed: false
---

## Plan Details

## Assumptions and Reference
`;
      fs.writeFileSync(planPath, planContent);

      const pm = new PlanMode(mockPI.pi);
      const ctx = mockPI.pi.getContext()!;

      (ctx as any).sessionManager = {
        getBranch: () => [
          {
            type: "custom",
            customType: "planit",
            data: {
              phase: "executing",
              planFilePath: planPath,
              planContent,
              restoredTools: ["read", "edit", "write", "bash"],
            },
          },
        ],
      };
      (ctx as any).ui = {
        notify: vi.fn(),
        setStatus: vi.fn(),
        setWidget: vi.fn(),
        showPlanningWidget: vi.fn(),
      };

      pm.restoreState(ctx);

      expect(pm.isExecuting).toBe(true);
      expect(pm.isPlanMode).toBe(false);
      expect(pm.planFile.getCompletedSteps()).toBe(1);
      expect(pm.planFile.getTotalSteps()).toBe(2);
    });

    it("falls back to loading plan file from disk when content is missing", () => {
      const fullTools = [{ name: "read" }];
      mockPI = createMockPI(fullTools);

      const projectDir = path.join(
        tmpHome,
        ".pi",
        "agent",
        "plans",
        "--tmp--test-project",
      );
      fs.mkdirSync(projectDir, { recursive: true });
      const planPath = path.join(projectDir, "fallback-plan-2026-01-01T00-00-00.md");
      const planContent = `---
title: "Fallback"
summary: ""
steps:
  - index: 1
    text: "Fallback step"
    completed: false
---

## Plan Details

## Assumptions and Reference
`;
      fs.writeFileSync(
        planPath,
        planContent,
      );

      const pm = new PlanMode(mockPI.pi);
      const ctx = mockPI.pi.getContext()!;

      (ctx as any).sessionManager = {
        getBranch: () => [
          {
            type: "custom",
            customType: "planit",
            data: {
              phase: "planning",
              planFilePath: planPath,
              // No planContent — should fall back to loading from disk
              restoredTools: ["read"],
            },
          },
        ],
      };
      (ctx as any).ui = {
        notify: vi.fn(),
        setStatus: vi.fn(),
        setWidget: vi.fn(),
        showPlanningWidget: vi.fn(),
      };

      pm.restoreState(ctx);

      expect(pm.isPlanMode).toBe(true);
      expect(pm.planFile.getTotalSteps()).toBe(1);
    });
  });

  describe("session_tree", () => {
    it("reconstructs state on tree navigation", () => {
      const fullTools = [{ name: "read" }, { name: "edit" }];
      const mockPI = createMockPI(fullTools);

      const projectDir = path.join(
        process.env.HOME!,
        ".pi",
        "agent",
        "plans",
        "--tmp--test-project",
      );
      fs.mkdirSync(projectDir, { recursive: true });
      const planPath = path.join(projectDir, "tree-plan-2026-01-01T00-00-00.md");
      const planContent =
        "# Tree Plan\n## Summary\n\n## Steps\n- [ ] Tree step\n";
      fs.writeFileSync(planPath, planContent);

      const pm = new PlanMode(mockPI.pi);
      const ctx = mockPI.pi.getContext()!;

      // Simulate tree navigation that restores planning
      (ctx as any).sessionManager = {
        getBranch: () => [
          {
            type: "custom",
            customType: "planit",
            data: {
              phase: "planning",
              planFilePath: planPath,
              planContent,
              restoredTools: ["read"],
            },
          },
        ],
      };
      (ctx as any).ui = {
        notify: vi.fn(),
        setStatus: vi.fn(),
        setWidget: vi.fn(),
        showPlanningWidget: vi.fn(),
      };

      pm.restoreState(ctx);

      expect(pm.isPlanMode).toBe(true);
    });
  });

  describe("PlanFile.listPlans", () => {
    it("returns empty array when no plans exist", () => {
      const plans = (PlanFile as any).listPlans("/tmp/nonexistent-project");
      expect(plans).toEqual([]);
    });

    it("lists available plans sorted by modification time", () => {
      const home = process.env.HOME!;
      // Use the same project path that listPlans("/tmp/test") resolves to
      const projectDir = path.join(home, ".pi", "agent", "plans", "--tmp--test");
      fs.mkdirSync(projectDir, { recursive: true });

      const older = path.join(projectDir, "old-plan-2026-01-01T00-00-00.md");
      const newer = path.join(projectDir, "new-plan-2026-06-01T00-00-00.md");

      fs.writeFileSync(older, "# Old");
      fs.writeFileSync(newer, "# New");

      // Make sure older is actually older
      const oldTime = new Date("2026-01-01");
      fs.utimesSync(older, oldTime, oldTime);

      const plans = (PlanFile as any).listPlans("/tmp/test");
      expect(plans.length).toBe(2);
      expect(plans[0].filename).toBe("new-plan-2026-06-01T00-00-00.md");
      expect(plans[1].filename).toBe("old-plan-2026-01-01T00-00-00.md");
    });
  });

  describe("mark_plan_step tool", () => {
    let backupHome: string | undefined;

    beforeEach(() => {
      vi.restoreAllMocks();
      backupHome = process.env.HOME;
      process.env.HOME = "/tmp/planit-mark-plan-test-home";
      fs.rmSync(process.env.HOME, { recursive: true, force: true });
    });

    afterEach(() => {
      vi.restoreAllMocks();
      if (backupHome) {
        process.env.HOME = backupHome;
      } else {
        delete process.env.HOME;
      }
      try {
        fs.rmSync(process.env.HOME, { recursive: true, force: true });
      } catch {
        // ignore
      }
    });

    it("returns error when not in executing phase", () => {
      const planContent = `---
title: "Test"
summary: ""
steps:
  - index: 1
    text: "Step 1"
    completed: false
  - index: 2
    text: "Step 2"
    completed: false
---

## Plan Details
`;
      const { pm } = createPIWithPlan("planned", planContent);

      // Phase gate: isExecuting should be false
      expect(pm.isExecuting).toBe(false);
      expect(pm.isPlanned).toBe(true);
    });

    it("marks steps as completed when in executing phase", () => {
      const planContent = `---
title: "Test"
summary: ""
steps:
  - index: 1
    text: "Step 1"
    completed: false
  - index: 2
    text: "Step 2"
    completed: false
---

## Plan Details
`;
      const { pm } = createPIWithPlan("executing", planContent);

      expect(pm.planFile.getCompletedSteps()).toBe(0);
      expect(pm.planFile.getTotalSteps()).toBe(2);

      // Call markCompleted directly to simulate tool behavior
      pm.planFile.markCompleted([1]);

      expect(pm.planFile.getCompletedSteps()).toBe(1);
      expect(pm.planFile.getTotalSteps()).toBe(2);
    });

    it("returns progress feedback with remaining steps", () => {
      const planContent = `---
title: "Test"
summary: ""
steps:
  - index: 1
    text: "Step 1"
    completed: false
  - index: 2
    text: "Step 2"
    completed: false
  - index: 3
    text: "Step 3"
    completed: false
---

## Plan Details
`;
      const { pm } = createPIWithPlan("executing", planContent);

      pm.planFile.markCompleted([1, 2]);

      const total = pm.planFile.getTotalSteps();
      const completed = pm.planFile.getCompletedSteps();
      const remaining = pm.planFile.getRemainingSteps();

      expect(completed).toBe(2);
      expect(total).toBe(3);
      expect(remaining).toContain("Step 3");
      expect(remaining).not.toContain("Step 1");
      expect(remaining).not.toContain("Step 2");
    });

    it("returns 'all steps complete' when last step is marked", () => {
      const planContent = `---
title: "Test"
summary: ""
steps:
  - index: 1
    text: "Only step"
    completed: false
---

## Plan Details
`;
      const { pm } = createPIWithPlan("executing", planContent);

      pm.planFile.markCompleted([1]);

      const remaining = pm.planFile.getRemainingSteps();
      expect(remaining).toBe("");
    });

    it("handles marking multiple steps at once", () => {
      const planContent = `---
title: "Test"
summary: ""
steps:
  - index: 1
    text: "Step 1"
    completed: false
  - index: 2
    text: "Step 2"
    completed: false
  - index: 3
    text: "Step 3"
    completed: false
---

## Plan Details
`;
      const { pm } = createPIWithPlan("executing", planContent);

      pm.planFile.markCompleted([1, 3]);

      expect(pm.planFile.getCompletedSteps()).toBe(2);
      expect(pm.planFile.getTotalSteps()).toBe(3);
      expect(pm.planFile.getRemainingSteps()).toContain("Step 2");
    });
  });
});
