/**
 * Bash command whitelist filter for plan mode.
 * Adapted from @devkade/pi-plan's isSafeReadOnlyCommand() pattern.
 * Only explicitly whitelisted commands are allowed during planning.
 */
export class BashFilter {
  private readonly SAFE_PATTERNS: RegExp[] = [
    // File inspection
    /^\s*cat\s+/,
    /^\s*head\s+/,
    /^\s*tail\s+/,
    /^\s*less\s+/,
    /^\s*more\s+/,
    /^\s*wc\s+/,
    /^\s*file\s+/,
    /^\s*stat\s+/,
    /^\s*du\s+/,
    /^\s*df\s+/,

    // Directory listing
    /^\s*ls(\s|$)/,
    /^\s*find\s+/,
    /^\s*tree\s+/,

    // Text search
    /^\s*grep\s+/,
    /^\s*rg\s+/,
    /^\s*ag\s+/,
    /^\s*fgrep\s+/,
    /^\s*egrep\s+/,

    // Git read-only
    /^\s*git\s+(status|log|diff|show|branch|tag|rev-parse|describe|name-rev|for-each-ref|ls-files|shortlog|blame|annotate)\b/,
    /^\s*git\s+diff\s+(--staged|HEAD|--cached)\b/,

    // Process/info
    /^\s*ps(\s|$)/,
    /^\s*top(\s|$)/,
    /^\s*htop(\s|$)/,
    /^\s*env(\s|$)/,
    /^\s*printenv\s+/,
    /^\s*uname\s+/,
    /^\s*whoami(\s|$)/,
    /^\s*id(\s|$)/,

    // Package info (read-only)
    /^\s*npm\s+(list|info|show|view|help)\b/,
    /^\s*yarn\s+(list|info|help)\b/,
    /^\s*pip\s+(list|show|help|freeze)\b/,

    // Documentation
    /^\s*man\s+/,
    /--help\b/,
    /\s-h\b/,
  ];

  private readonly DANGEROUS_PATTERNS: RegExp[] = [
    // Destructive commands
    /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*)?\b/,
    /\bunlink\b/,
    /\btruncate\b/,
    /\bshred\b/,

    // Redirects (writes to files)
    />\s*(?!\/dev\/null\b)\S/,
    />>\s*(?!\/dev\/null\b)\S/,
    /\|\s*>\s*(?!\/dev\/null\b)\S/,

    // Git mutations
    /\bgit\s+(commit|push|pull|merge|rebase|reset\s+(--hard|--mixed)|checkout\s+-b|push\s+--force|push\s+-f)\b/,

    // Package installation
    /\bnpm\s+install\b/,
    /\byarn\s+(add|remove|global)\b/,
    /\bpip\s+(install|uninstall)\b/,
    /\bsudo\b/,

    // File modification
    /\bmv\s+/,
    /\bcp\s+-[a-zA-Z]*r/,
    /\bchmod\s+/,
    /\bchown\s+/,

    // Network writes
    /\bcurl\s+-[a-zA-Z]*X\s+(POST|PUT|DELETE|PATCH)\b/,
    /\bwget\s+-[a-zA-Z]*O\b/,
  ];

  /**
   * Check if a bash command is safe to execute in plan mode.
   * Returns true only if the command matches a whitelist pattern
   * and does NOT match any dangerous patterns.
   */
  isSafe(command: string): boolean {
    if (!command.trim()) return true;

    // Check dangerous patterns first (these always block)
    for (const pattern of this.DANGEROUS_PATTERNS) {
      if (pattern.test(command)) {
        return false;
      }
    }

    // Check safe patterns (whitelist)
    for (const pattern of this.SAFE_PATTERNS) {
      if (pattern.test(command)) {
        return true;
      }
    }

    // Default to blocking — only whitelisted commands pass
    return false;
  }
}
