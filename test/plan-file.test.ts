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

    it("writes the correct default template with YAML frontmatter", () => {
      const pf = new PlanFile();
      pf.init("/tmp/test-project", "test plan");

      const content = pf.getContent();
      expect(content).toContain("---");
      expect(content).toContain("title:");
      expect(content).toContain("summary:");
      expect(content).toContain("steps:");
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

    it("detects steps from YAML frontmatter", () => {
      const pf = new PlanFile();
      pf.init("/tmp/test", "test");

      const withSteps = `---
title: "Test Plan"
summary: "A test plan"
steps:
  - index: 1
    text: "Do thing"
    completed: false
  - index: 2
    text: "Do other thing"
    completed: false
  - index: 3
    text: "Already done"
    completed: true
---

## Plan Details

## Assumptions and Reference
`;

      pf.content = withSteps;
      pf.parseFrontmatter();

      expect(pf.hasSteps()).toBe(true);
      expect(pf.getTotalSteps()).toBe(3);
      expect(pf.getCompletedSteps()).toBe(1);
    });

    it("returns empty steps for no frontmatter", () => {
      const pf = new PlanFile();
      pf.init("/tmp/test", "test");
      pf.content = "# No frontmatter here";
      pf.parseFrontmatter();
      expect(pf.getTotalSteps()).toBe(0);
    });

    it("returns empty steps when steps is not an array", () => {
      const pf = new PlanFile();
      pf.init("/tmp/test", "test");
      pf.content = "---\ntitle: \"Test\"\nsteps: {}\n---\n\n## Plan Details\n";
      pf.parseFrontmatter();
      expect(pf.getTotalSteps()).toBe(0);
    });

    it("handles parse errors gracefully", () => {
      const pf = new PlanFile();
      pf.init("/tmp/test", "test");
      pf.content = "---\nthis is: [invalid: yaml: ::\n---\n\n## Plan Details\n";
      pf.parseFrontmatter();
      expect(pf.getTotalSteps()).toBe(0);
    });
  });

  describe("parseFrontmatter", () => {
    it("extracts steps from YAML frontmatter", () => {
      const pf = new PlanFile();
      pf.init("/tmp/test", "test");

      pf.content = `---
title: "Test"
summary: "desc"
steps:
  - index: 1
    text: "Step one"
    completed: false
  - index: 2
    text: "Step two"
    completed: true
---
`;
      pf.parseFrontmatter();

      expect(pf.getTotalSteps()).toBe(2);
      expect(pf.getCompletedSteps()).toBe(1);
      // Verify through public APIs
      expect(pf.getCompletedSteps()).toBe(1);
      expect(pf.getTotalSteps()).toBe(2);
    });

    it("handles missing completed field (defaults to false)", () => {
      const pf = new PlanFile();
      pf.init("/tmp/test", "test");

      pf.content = `---
title: "Test"
summary: "desc"
steps:
  - index: 1
    text: "Step one"
---
`;
      pf.parseFrontmatter();

      // completed defaults to false when not specified
      expect(pf.getCompletedSteps()).toBe(0);
    });

    it("filters out steps with missing index or text", () => {
      const pf = new PlanFile();
      pf.init("/tmp/test", "test");

      pf.content = `---
title: "Test"
summary: "desc"
steps:
  - index: 1
    text: "Valid step"
    completed: false
  - text: "Missing index"
    completed: false
  - index: 2
    completed: false
---
`;
      pf.parseFrontmatter();

      expect(pf.getTotalSteps()).toBe(1);
      expect(pf.getTotalSteps()).toBe(1);
      // Verify widget lines reflect the single valid step
      const lines = pf.getWidgetLines();
      expect(lines.length).toBe(1);
      expect(lines[0]).toContain("Valid step");
    });
  });

  describe("markCompleted", () => {
    it("marks steps as completed and rewrites frontmatter", () => {
      const pf = new PlanFile();
      pf.init("/tmp/test", "test");

      pf.content = `---
title: "Test"
summary: "desc"
steps:
  - index: 1
    text: "Do thing"
    completed: false
  - index: 2
    text: "Other thing"
    completed: false
---

## Plan Details

## Assumptions and Reference
`;
      pf.parseFrontmatter();

      pf.markCompleted([1]);

      expect(pf.getCompletedSteps()).toBe(1);
      expect(pf.getTotalSteps()).toBe(2);

      // Verify file content was rewritten with frontmatter
      const updatedContent = pf.getContent();
      expect(updatedContent).toContain("---");
      expect(updatedContent).toContain("completed: true");
    });

    it("preserves markdown body when rewriting", () => {
      const pf = new PlanFile();
      pf.init("/tmp/test", "test");

      pf.content = `---
title: "Test"
summary: "desc"
steps:
  - index: 1
    text: "Do thing"
    completed: false
---

## Plan Details
Some implementation notes.

## Assumptions and Reference
- Assumption about something.
`;
      pf.parseFrontmatter();

      pf.markCompleted([1]);

      const updatedContent = pf.getContent();
      expect(updatedContent).toContain("## Plan Details");
      expect(updatedContent).toContain("Some implementation notes.");
      expect(updatedContent).toContain("## Assumptions and Reference");
    });
  });

  describe("getRemainingSteps", () => {
    it("returns only uncompleted steps", () => {
      const pf = new PlanFile();
      pf.init("/tmp/test", "test");

      pf.content = `---
title: "Test"
summary: "desc"
steps:
  - index: 1
    text: "Do thing"
    completed: false
  - index: 2
    text: "Done"
    completed: true
  - index: 3
    text: "Remaining"
    completed: false
---

## Plan Details
`;
      pf.parseFrontmatter();

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

      pf.content = `---
title: "Test"
summary: "desc"
steps:
  - index: 1
    text: "Do thing"
    completed: false
  - index: 2
    text: "Done"
    completed: true
---
`;
      pf.parseFrontmatter();

      const lines = pf.getWidgetLines();
      expect(lines.length).toBe(2);
      expect(lines[0]).toMatch(/^☐/);
      expect(lines[1]).toMatch(/^☑/);
    });
  });

  describe("getTitle", () => {
    it("extracts the title from frontmatter", () => {
      const pf = new PlanFile();
      pf.init("/tmp/test", "test");

      pf.content = `---
title: "Refactor auth module"
summary: "desc"
steps: []
---
`;
      pf.parseFrontmatter();

      expect(pf.getTitle()).toBe("Refactor auth module");
    });

    it("returns the default title from init", () => {
      const pf = new PlanFile();
      pf.init("/tmp/test", "test");
      expect(pf.getTitle()).toBe("Plan");
    });

    it("returns null when no frontmatter exists", () => {
      const pf = new PlanFile();
      pf.init("/tmp/test", "test");
      pf.content = "# No frontmatter here";
      pf.parseFrontmatter();
      expect(pf.getTitle()).toBeNull();
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
