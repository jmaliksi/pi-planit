import * as fs from "node:fs";
import * as path from "node:path";
import type { ChecklistItem } from "./types";

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

  /**
   * Initialize plan file in ~/.pi/agent/plans/--project-path--/ mirror structure.
   */
  init(cwd: string, userSummary: string = "untitled"): void {
    const homeDir = process.env.HOME ?? process.env.USERPROFILE ?? "/";
    const plansDir = path.join(homeDir, ".pi", "agent", "plans");
    const sanitizedProjectPath = cwd.replace(/\//g, "--");
    const projectPlansDir = path.join(plansDir, sanitizedProjectPath);
    const planName = `${derivePlanName(userSummary)}.md`;
    const planPath = path.join(projectPlansDir, planName);

    this.filePath = planPath;

    if (!fs.existsSync(projectPlansDir)) {
      fs.mkdirSync(projectPlansDir, { recursive: true });
    }

    this.content = `# Plan
## Summary

## Steps

## Plan Details

## Assumptions and Reference
`;
    fs.writeFileSync(planPath, this.content, "utf-8");
    this.parseChecklist();
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
    const match = this.content.match(/^#\s+(.+)$/m);
    return match ? match[1].trim() : null;
  }

  parseChecklist(): void {
    const stepRegex = /-\s+\[([ x])\]\s+(?:Step\s+(\d+):\s*)?(.+)$/gm;
    const newItems: ChecklistItem[] = [];
    let stepNum = 0;
    let match;

    while ((match = stepRegex.exec(this.content)) !== null) {
      const completed = match[1] === "x";
      const step = match[2] ? parseInt(match[2], 10) : ++stepNum;
      const text = match[3].trim();
      newItems.push({ step, text, completed });
      if (!match[2]) stepNum++;
    }

    this.items = newItems;
  }

  /**
   * List all plan files for a given project directory.
   * Returns sorted array of { filename, filePath, modified } objects.
   */
  static listPlans(cwd: string): { filename: string; filePath: string; modified: Date }[] {
    const homeDir = process.env.HOME ?? process.env.USERPROFILE ?? "/";
    const plansDir = path.join(homeDir, ".pi", "agent", "plans");
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
   */
  load(filePath: string): void {
    this.filePath = filePath;
    if (fs.existsSync(filePath)) {
      this.content = fs.readFileSync(filePath, "utf-8");
      this.parseChecklist();
    } else {
      this.content = "";
      this.items = [];
    }
  }

  private updateFile(): void {
    const lines = this.content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const stepMatch = line.match(/(-\s+\[([ x])\]\s+(?:Step\s+(\d+):\s*)?(.+))/);
      if (stepMatch) {
        const stepNum = stepMatch[3] ? parseInt(stepMatch[3], 10) : null;
        if (!stepNum) continue; // Require "Step N:" prefix for matching
        const item = this.items.find((it) => it.step === stepNum);
        if (item) {
          const checkbox = item.completed ? "x" : " ";
          lines[i] = line.replace(`[${stepMatch[2]}]`, `[${checkbox}]`);
        }
      }
    }

    this.content = lines.join("\n");
    fs.writeFileSync(this.filePath, this.content, "utf-8");
  }
}
