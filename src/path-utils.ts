import * as path from "node:path";

/**
 * Resolve the base agent directory.
 *
 * Honors the PI_CODING_AGENT_DIR environment variable (set by the pi coding
 * agent runtime) which overrides the default ~/.pi/agent location.
 *
 * Falls back to ~/.pi/agent when the env var is not set.
 */
export function getAgentDir(): string {
  const envDir = process.env.PI_CODING_AGENT_DIR;
  if (envDir && path.isAbsolute(envDir)) {
    return envDir;
  }

  const homeDir = process.env.HOME ?? process.env.USERPROFILE ?? "/";
  return path.join(homeDir, ".pi", "agent");
}

/**
 * Resolve a path relative to the agent base directory.
 */
export function agentPath(...segments: string[]): string {
  return path.join(getAgentDir(), ...segments);
}

/**
 * Resolve the plan storage directory based on the configured storage mode.
 * @param cwd - Current working directory (used for local mode)
 * @param planStorage - "global" for ~/.pi/agent/plans/, "local" for <cwd>/.pi/plans/
 */
export function resolvePlansDir(
  cwd: string,
  planStorage: "global" | "local",
): string {
  if (planStorage === "local") {
    return path.join(cwd, ".pi", "plans");
  }
  return agentPath("plans");
}
