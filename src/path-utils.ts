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
