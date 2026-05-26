import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { PlanMode } from "../src/plan-mode";

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

  describe("buildAuto", () => {
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
      pm.buildAuto(ctx);

      expect(mockPI.calls.length).toBeGreaterThan(callsBefore);

      const lastCall = mockPI.calls[mockPI.calls.length - 1];
      for (const tool of fullTools) {
        expect(lastCall).toContain(tool.name);
      }
    });
  });

  describe("buildGuided", () => {
    it("restores the full captured tool set", () => {
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

      const callsBefore = mockPI.calls.length;
      pm.buildGuided(ctx);

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
