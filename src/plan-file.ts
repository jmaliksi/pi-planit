import * as fs from "node:fs";
import * as path from "node:path";
import { agentPath } from "./path-utils";

/**
 * Resolved plan storage directory. Set once via setResolvedPlansDir.
 * Defaults to global storage (~/.pi/agent/plans/).
 */
let resolvedPlansDir: string = agentPath("plans");

/**
 * Set the resolved plan storage directory. Called by PlanMode on startup.
 */
export function setResolvedPlansDir(dir: string): void {
  resolvedPlansDir = dir;
}

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

  /**
   * Initialize plan file in the resolved plans directory.
   */
  init(cwd: string, userSummary: string = "untitled"): void {
    const plansDir = resolvedPlansDir;
    const sanitizedProjectPath = cwd.replace(/\//g, "--");
    const projectPlansDir = path.join(plansDir, sanitizedProjectPath);
    const planName = `${derivePlanName(userSummary)}.md`;
    const planPath = path.join(projectPlansDir, planName);

    this.filePath = planPath;

    if (!fs.existsSync(projectPlansDir)) {
      fs.mkdirSync(projectPlansDir, { recursive: true });
    }

    this.content = `# ${userSummary}\n\n`;
    fs.writeFileSync(planPath, this.content, "utf-8");
  }

  getFilePath(): string {
    return this.filePath;
  }

  getContent(): string {
    return this.content;
  }

  hasContent(): boolean {
    return this.content.trim().length > 0;
  }

  /**
   * Parse the title from the first `# Heading` in the markdown.
   * Falls back to the filename stem if no heading is found.
   */
  getTitle(): string | null {
    const headingMatch = this.content.match(/^#\s+(.+)$/m);
    if (headingMatch) {
      return headingMatch[1].trim();
    }
    if (this.filePath) {
      const stem = path.basename(this.filePath, ".md");
      // Strip trailing timestamp (name-YYYY-MM-DDTHH-mm-ss)
      const parts = stem.split(/-\d{4}-\d{2}-\d{2}T/);
      return parts[0] ?? stem;
    }
    return null;
  }

  /**
   * Extract a human-readable title from plan file content.
   * Falls back to filename stem (sans timestamp) if no heading is found.
   */
  private static extractTitle(content: string, filename: string): string {
    const headingMatch = content.match(/^#\s+(.+)$/m);
    if (headingMatch) {
      return headingMatch[1].trim();
    }
    const stem = path.basename(filename, ".md");
    const parts = stem.split(/-\d{4}-\d{2}-\d{2}T/);
    return parts[0] ?? stem;
  }

  /**
   * List all plan files for a given project directory.
   * Uses the resolved plans directory set via setResolvedPlansDir().
   * @param cwd - Current working directory (used only for path sanitization, not for directory resolution)
   * Returns sorted array of { filename, filePath, modified, title } objects.
   */
  static listPlans(cwd: string): { filename: string; filePath: string; modified: Date; title: string }[] {
    const plansDir = resolvedPlansDir;
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
        const content = fs.readFileSync(filePath, "utf-8");
        return { filename, filePath, modified: stat.mtime, title: this.extractTitle(content, filename) };
      });

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
      throw new Error(`Plan file not found: ${filePath}`);
    }
  }

  /**
   * Write new content to the plan file.
   */
  write(newContent: string): void {
    this.content = newContent;
    if (this.filePath) {
      fs.writeFileSync(this.filePath, newContent, "utf-8");
    }
  }
}
