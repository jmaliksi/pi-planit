import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import { PlanFile } from "../src/plan-file";

describe("derivePlanName", () => {
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
  let backupHome: string | undefined;

  beforeEach(() => {
    backupHome = process.env.HOME;
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

    it("writes a markdown document starting with a # heading", () => {
      const pf = new PlanFile();
      pf.init("/tmp/test-project", "test plan");

      const content = pf.getContent();
      expect(content).toMatch(/^# /);
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

  describe("hasContent", () => {
    it("returns false for whitespace-only content", () => {
      const pf = new PlanFile();
      pf.init("/tmp/test", "test");
      pf.content = "   ";
      expect(pf.hasContent()).toBe(false);
    });

    it("returns true when content exists", () => {
      const pf = new PlanFile();
      pf.init("/tmp/test", "test");
      expect(pf.hasContent()).toBe(true);
    });
  });

  describe("getTitle", () => {
    it("extracts the title from the first # heading", () => {
      const pf = new PlanFile();
      pf.init("/tmp/test", "test");
      pf.content = "# Refactor auth module\n\nSome details.";
      expect(pf.getTitle()).toBe("Refactor auth module");
    });

    it("falls back to the filename stem when no heading is present", () => {
      const pf = new PlanFile();
      pf.init("/tmp/test", "migrate-auth");
      pf.content = "No heading here";
      const title = pf.getTitle();
      expect(title).toContain("migrate");
    });

    it("returns null when no heading and no file path", () => {
      const pf = new PlanFile();
      pf.content = "No heading here";
      expect(pf.getTitle()).toBeNull();
    });

    it("returns the summary passed to init as heading", () => {
      const pf = new PlanFile();
      pf.init("/tmp/test", "test summary");
      expect(pf.getTitle()).toBe("test summary");
    });
  });

  describe("write", () => {
    it("updates content and writes to disk", () => {
      const pf = new PlanFile();
      pf.init("/tmp/test", "test");
      const newContent = "# Updated Plan\n\nNew content here.";
      pf.write(newContent);
      expect(pf.getContent()).toBe(newContent);
      expect(fs.readFileSync(pf.getFilePath(), "utf-8")).toBe(newContent);
    });
  });

  describe("load", () => {
    it("loads content from disk", () => {
      const pf = new PlanFile();
      pf.init("/tmp/test", "test");
      const filePath = pf.getFilePath();
      const newContent = "# Loaded Plan\n\nLoaded content.";
      fs.writeFileSync(filePath, newContent, "utf-8");

      const pf2 = new PlanFile();
      pf2.load(filePath);
      expect(pf2.getContent()).toBe(newContent);
      expect(pf2.getTitle()).toBe("Loaded Plan");
    });
  });
});
