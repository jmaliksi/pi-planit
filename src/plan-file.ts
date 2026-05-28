import * as fs from "node:fs";
import * as path from "node:path";
import * as yaml from "yaml";
import type { ChecklistItem } from "./types";
import { agentPath } from "./path-utils";

/**
 * Derive a 3-5 word filename from a user's task description.
 * Example: "migrate auth to JWT" → "migrate-auth-to-jwt" + timestamp
 */
function derivePlanName(userSummary: string): string {
  const words = userSummary
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 5);

  if (words.length === 0) {
    return "untitled-plan";
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  return `${words.join("-")}-${timestamp}`;
}

export class PlanFile {
  private filePath: string = "";
  content: string = "";
  private items: ChecklistItem[] = [];
  private frontmatterData: {
    title?: string;
    summary?: string;
    steps?: Array<{
      index: number;
      text: string;
      completed: boolean;
    }>;
  } = {};

  /**
   * Initialize plan file in agent plans directory.
   * Honors PI_CODING_AGENT_DIR env var; falls back to ~/.pi/agent/plans/.
   */
  init(cwd: string, userSummary: string = "untitled"): void {
    const plansDir = agentPath("plans");
    const sanitizedProjectPath = cwd.replace(/\//g, "--");
    const projectPlansDir = path.join(plansDir, sanitizedProjectPath);
    const planName = `${derivePlanName(userSummary)}.md`;
    const planPath = path.join(projectPlansDir, planName);

    this.filePath = planPath;

    if (!fs.existsSync(projectPlansDir)) {
      fs.mkdirSync(projectPlansDir, { recursive: true });
    }

    this.content = `---
title: "Plan"
summary: ""
steps: []
---

## Plan Details

## Assumptions and Reference
`;
    fs.writeFileSync(planPath, this.content, "utf-8");
    this.parseFrontmatter();
  }

  getFilePath(): string {
    return this.filePath;
  }

  getContent(): string {
    return this.content;
  }

  hasSteps(): boolean {
    return this.items.length > 0;
  }

  getTotalSteps(): number {
    return this.items.length;
  }

  getCompletedSteps(): number {
    return this.items.filter((i) => i.completed).length;
  }

  getRemainingSteps(): string {
    return this.items
      .filter((i) => !i.completed)
      .map((i) => `- [ ] Step ${i.step}: ${i.text}`)
      .join("\n");
  }

  markCompleted(stepNumbers: number[]): void {
    for (const step of stepNumbers) {
      const item = this.items.find((i) => i.step === step);
      if (item) {
        item.completed = true;
      }
    }
    this.updateFile();
  }

  setSteps(steps: ChecklistItem[]): void {
    this.items = steps;
    this.updateFile();
  }

  getWidgetLines(): string[] {
    if (this.items.length === 0) return [];

    return this.items.map((item) => {
      const prefix = item.completed ? "☑ " : "☐ ";
      return `${prefix}[${item.step}] ${item.text}`;
    });
  }

  getTitle(): string | null {
    return this.frontmatterData.title ?? null;
  }

  parseFrontmatter(): void {
    // Extract content between --- delimiters
    const fmMatch = this.content.match(/^---\n([\s\S]*?)\n---/);
    if (!fmMatch) {
      this.items = [];
      this.frontmatterData = {};
      return;
    }

    try {
      const parsed = yaml.parse(fmMatch[1]) as {
        title?: string;
        summary?: string;
        steps?: Array<{
          index: number;
          text: string;
          completed: boolean;
        }>;
      };

      this.frontmatterData = parsed;

      if (!Array.isArray(parsed.steps)) {
        this.items = [];
        return;
      }

      this.items = parsed.steps
        .filter(
          (s) =>
            typeof s.index === "number" &&
            typeof s.text === "string",
        )
        .map((s) => ({
          step: s.index!,
          text: s.text!,
          completed: s.completed === true,
        }));
    } catch {
      this.items = [];
      this.frontmatterData = {};
    }
  }

  /**
   * List all plan files for a given project directory.
   * Returns sorted array of { filename, filePath, modified } objects.
   */
  static listPlans(cwd: string): { filename: string; filePath: string; modified: Date }[] {
    const plansDir = agentPath("plans");
    const sanitizedProjectPath = cwd.replace(/\//g, "--");
    const projectPlansDir = path.join(plansDir, sanitizedProjectPath);

    if (!fs.existsSync(projectPlansDir)) {
      return [];
    }

    const files = fs.readdirSync(projectPlansDir)
      .filter((f) => f.endsWith(".md"))
      .map((filename) => {
        const filePath = path.join(projectPlansDir, filename);
        const stat = fs.statSync(filePath);
        return { filename, filePath, modified: stat.mtime };
      });

    // Sort by modified time, newest first
    return files.sort((a, b) => b.modified.getTime() - a.modified.getTime());
  }

  /**
   * Load an existing plan file from disk into this instance.
   *
   * When `content` is provided, it is used directly (bypassing disk I/O)
   * and also written to disk to keep the file in sync.
   *
   * @throws If the file does not exist and no content is provided.
   */
  load(filePath: string, content?: string): void {
    this.filePath = filePath;

    if (content !== undefined) {
      this.content = content;
      fs.writeFileSync(filePath, content, "utf-8");
    } else if (fs.existsSync(filePath)) {
      this.content = fs.readFileSync(filePath, "utf-8");
    } else {
      throw new Error(
        `Plan file not found: ${filePath}`,
      );
    }

    this.parseFrontmatter();
  }

  private updateFile(): void {
    // Serialize items back to YAML frontmatter
    const title = this.frontmatterData.title ?? "Plan";
    const frontmatter = yaml.stringify({
      title,
      summary: this.frontmatterData.summary ?? "",
      steps: this.items.map((item) => ({
        index: item.step,
        text: item.text,
        completed: item.completed,
      })),
    });

    // Extract markdown body (content after the closing --- delimiter)
    const fmEndMatch = this.content.match(/^---\n[\s\S]*?\n---\n([\s\S]*)$/);
    const markdownBody = fmEndMatch ? fmEndMatch[1].trimEnd() : "";

    // Reconstruct: frontmatter + markdown body
    this.content = `---\n${frontmatter}---\n${
      markdownBody ? `\n\n${markdownBody}` : ""
    }`;
    fs.writeFileSync(this.filePath, this.content, "utf-8");
  }
}
