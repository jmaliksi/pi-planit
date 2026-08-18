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
   * Sets the destination path and in-memory stub content; the file itself is
   * only created on the first `write()`.
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
   * Always reads from disk — never trusts an external snapshot.
   */
  load(filePath: string): void {
    this.filePath = filePath;
    if (fs.existsSync(filePath)) {
      this.content = fs.readFileSync(filePath, "utf-8");
    } else {
      throw new Error(`Plan file not found: ${filePath}`);
    }
  }

  /**
   * Write new content to the plan file.
   *
   * Versioned: before overwriting, the current on-disk content is copied to a
   * sibling backup keyed by seconds since epoch (`<file>.bak-<epoch>`). Backups
   * don't end in `.md`, so they are excluded from `listPlans()`. Restore via
   * `restoreLatestBackup()`. No backup is created when the file doesn't exist
   * yet (first write) or when the content is unchanged. Backups are pruned to
   * the newest `MAX_BACKUPS` on every write.
   */
  write(newContent: string): void {
    if (this.filePath && fs.existsSync(this.filePath)) {
      const current = fs.readFileSync(this.filePath, "utf-8");
      if (current !== newContent) {
        fs.writeFileSync(this.createBackupPath(), current, "utf-8");
        PlanFile.pruneBackups(this.filePath);
      }
    }

    this.content = newContent;
    if (this.filePath) {
      fs.writeFileSync(this.filePath, newContent, "utf-8");
    }
  }

  /**
   * Generate a unique backup path keyed by seconds since epoch, guarding
   * against same-second collisions (e.g. rapid writes) with a numeric suffix.
   * Numeric keys keep `listBackups()` sortable without lexical pitfalls.
   */
  private createBackupPath(): string {
    const timestamp = Math.floor(Date.now() / 1000);
    let backupPath = `${this.filePath}.bak-${timestamp}`;
    let n = 1;
    while (fs.existsSync(backupPath)) {
      backupPath = `${this.filePath}.bak-${timestamp}-${++n}`;
    }
    return backupPath;
  }

  /**
   * List backup files for a plan file, newest first.
   * Backups are siblings named `<file>.bak-<ISO timestamp>`.
   */
  static listBackups(filePath: string): string[] {
    if (!filePath) return [];
    const dir = path.dirname(filePath);
    const base = path.basename(filePath);
    if (!fs.existsSync(dir)) return [];
    return fs
      .readdirSync(dir)
      .filter((f) => f.startsWith(`${base}.bak-`))
      .map((f) => path.join(dir, f))
      .sort((a, b) => {
        const aOrder = PlanFile.backupOrder(a);
        const bOrder = PlanFile.backupOrder(b);
        return bOrder.ts - aOrder.ts || bOrder.seq - aOrder.seq;
      });
  }

  /**
   * Parse the numeric (seconds-since-epoch, optional collision suffix) key
   * from a backup path. Unparseable backups sort as oldest.
   */
  private static backupOrder(filePath: string): { ts: number; seq: number } {
    const match = path.basename(filePath).match(/\.bak-(\d+)(?:-(\d+))?$/);
    if (!match) return { ts: 0, seq: 0 };
    return { ts: parseInt(match[1], 10), seq: match[2] ? parseInt(match[2], 10) : 0 };
  }

  /**
   * Restore the newest backup over the current plan file.
   * The current content is itself backed up first (via `write()`), so an undo
   * is itself reversible. Returns true when a backup was restored.
   */
  restoreLatestBackup(): boolean {
    if (!this.filePath) return false;
    const backups = PlanFile.listBackups(this.filePath);
    if (backups.length === 0) return false;
    const restored = fs.readFileSync(backups[0], "utf-8");
    this.write(restored);
    return true;
  }

  /** Maximum number of timestamped backups retained per plan file. Oldest are pruned. */
  private static readonly MAX_BACKUPS = 10;

  /**
   * Prune backups beyond the retention limit, keeping the newest.
   */
  private static pruneBackups(filePath: string): void {
    const backups = PlanFile.listBackups(filePath);
    if (backups.length <= PlanFile.MAX_BACKUPS) return;
    for (const backup of backups.slice(PlanFile.MAX_BACKUPS)) {
      try {
        fs.unlinkSync(backup);
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  /**
   * Delete the plan file and all of its backups.
   * Returns true when the plan file existed.
   */
  static deleteFile(filePath: string): boolean {
    if (!filePath || !fs.existsSync(filePath)) return false;
    for (const backup of PlanFile.listBackups(filePath)) {
      try {
        fs.unlinkSync(backup);
      } catch {
        // Ignore cleanup errors
      }
    }
    fs.unlinkSync(filePath);
    return true;
  }
}
