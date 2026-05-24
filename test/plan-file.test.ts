import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { PlanFile } from "../src/plan-file";

describe("derivePlanName", () => {
  // derivePlanName is private, so we test it indirectly through PlanFile.init()
  // which calls derivePlanName to generate the filename.
  it("produces a slug from a task description", () => {
    const pf = new PlanFile();
    pf.init("/tmp/test", "migrate auth to jwt");
    expect(pf.getFilePath()).toMatch(/migrate-auth-to-jwt/);
  });

  it("caps at 5 words", () => {
    const pf = new PlanFile();
    pf.init("/tmp/test", "one two three four five six seven");
    expect(pf.getFilePath()).toMatch(/one-two-three-four-five/);
  });

  it("handles empty input", () => {
    const pf = new PlanFile();
    pf.init("/tmp/test", "");
    expect(pf.getFilePath()).toContain("untitled-plan");
  });

  it("adds a timestamp for uniqueness", () => {
    const pf = new PlanFile();
    pf.init("/tmp/test", "same task");
    expect(pf.getFilePath()).toMatch(/same-task-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}/);
  });
});

describe("PlanFile", () => {
  // PlanFile writes to $HOME/.pi/agent/plans/ by default.
  // We override HOME via Object.defineProperty to redirect writes to a temp dir.
  let backupHome: string | undefined;

  beforeEach(() => {
    backupHome = process.env.HOME;
    // Use a real temp directory that PlanFile will create under
    const tmpHome = "/tmp/planit-test-home-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);
    process.env.HOME = tmpHome;
  });

  afterEach(() => {
    if (backupHome !== undefined) {
      process.env.HOME = backupHome;
    } else {
      delete process.env.HOME;
    }
  });

  describe("init", () => {
    it("creates a plan file in the correct directory structure", () => {
      const pf = new PlanFile();
      const cwd = "/home/user/my-project";
      pf.init(cwd, "migrate auth to jwt");

      expect(pf.getFilePath()).toContain(".pi/agent/plans/");
      expect(pf.getFilePath()).toContain("--home--user--my-project/");
      expect(pf.getFilePath()).toMatch(/migrate-auth-to-jwt-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}.md$/);
    });

    it("writes the correct default template", () => {
      const pf = new PlanFile();
      pf.init("/tmp/test-project", "test plan");

      const content = pf.getContent();
      expect(content).toContain("# Plan");
      expect(content).toContain("## Summary");
      expect(content).toContain("## Steps");
      expect(content).toContain("## Plan Details");
      expect(content).toContain("## Assumptions and Reference");
    });

    it("handles empty summary", () => {
      const pf = new PlanFile();
      pf.init("/tmp/test-project", "");

      expect(pf.getFilePath()).toContain("untitled-plan");
    });
  });

  describe("getFilePath / getContent", () => {
    it("returns the correct file path", () => {
      const pf = new PlanFile();
      pf.init("/tmp/test", "test");
      expect(typeof pf.getFilePath()).toBe("string");
      expect(pf.getFilePath()).toMatch(/\.md$/);
    });

    it("returns the file content", () => {
      const pf = new PlanFile();
      pf.init("/tmp/test", "test");
      expect(typeof pf.getContent()).toBe("string");
    });
  });

  describe("hasSteps / getTotalSteps / getCompletedSteps", () => {
    it("returns false and zero for an empty plan", () => {
      const pf = new PlanFile();
      pf.init("/tmp/test", "test");
      expect(pf.hasSteps()).toBe(false);
      expect(pf.getTotalSteps()).toBe(0);
      expect(pf.getCompletedSteps()).toBe(0);
    });

    it("detects steps written to the plan file", () => {
      const pf = new PlanFile();
      pf.init("/tmp/test", "test");

      const withSteps = `# Plan
## Summary

## Steps

- [ ] Step 1: Do thing
- [ ] Step 2: Do other thing
- [x] Step 3: Already done

## Plan Details

## Assumptions and Reference
`;

      pf.content = withSteps;
      pf.parseChecklist();

      expect(pf.hasSteps()).toBe(true);
      expect(pf.getTotalSteps()).toBe(3);
      expect(pf.getCompletedSteps()).toBe(1);
    });
  });

  describe("markCompleted", () => {
    it("marks steps as completed", () => {
      const pf = new PlanFile();
      pf.init("/tmp/test", "test");

      pf.content = `# Plan
## Summary

## Steps

- [ ] Step 1: Do thing
- [ ] Step 2: Other thing

## Plan Details

## Assumptions and Reference
`;
      pf.parseChecklist();

      pf.markCompleted([1]);

      expect(pf.getCompletedSteps()).toBe(1);
      expect(pf.getTotalSteps()).toBe(2);
    });
  });

  describe("getRemainingSteps", () => {
    it("returns only uncompleted steps", () => {
      const pf = new PlanFile();
      pf.init("/tmp/test", "test");

      pf.content = `# Plan
## Summary

## Steps

- [ ] Step 1: Do thing
- [x] Step 2: Done
- [ ] Step 3: Remaining

## Plan Details

## Assumptions and Reference
`;
      pf.parseChecklist();

      const remaining = pf.getRemainingSteps();
      expect(remaining).toContain("Step 1");
      expect(remaining).toContain("Step 3");
      expect(remaining).not.toContain("Step 2");
    });
  });

  describe("getWidgetLines", () => {
    it("returns empty array for no steps", () => {
      const pf = new PlanFile();
      pf.init("/tmp/test", "test");
      expect(pf.getWidgetLines()).toEqual([]);
    });

    it("returns checkbox lines for steps", () => {
      const pf = new PlanFile();
      pf.init("/tmp/test", "test");

      pf.content = `# Plan
## Summary

## Steps

- [ ] Step 1: Do thing
- [x] Step 2: Done

## Plan Details

## Assumptions and Reference
`;
      pf.parseChecklist();

      const lines = pf.getWidgetLines();
      expect(lines.length).toBe(2);
      expect(lines[0]).toMatch(/^☐/);
      expect(lines[1]).toMatch(/^☑/);
    });
  });

  describe("getTitle", () => {
    it("extracts the title from the plan", () => {
      const pf = new PlanFile();
      pf.init("/tmp/test", "test");

      pf.content = `# Refactor auth module
## Summary

## Steps

## Plan Details

## Assumptions and Reference
`;

      expect(pf.getTitle()).toBe("Refactor auth module");
    });

    it("returns the default title", () => {
      const pf = new PlanFile();
      pf.init("/tmp/test", "test");
      // Default template has "# Plan" as title
      expect(pf.getTitle()).toBe("Plan");
    });
  });

  describe("setSteps", () => {
    it("replaces all steps and updates the file", () => {
      const pf = new PlanFile();
      pf.init("/tmp/test", "test");

      pf.setSteps([
        { step: 1, text: "New step 1", completed: false },
        { step: 2, text: "New step 2", completed: true },
      ]);

      expect(pf.getTotalSteps()).toBe(2);
      expect(pf.getCompletedSteps()).toBe(1);
    });
  });
});
