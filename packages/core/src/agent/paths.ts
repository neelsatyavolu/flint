import { homedir } from "node:os";
import { join } from "node:path";

/** Same location the desktop app uses for its data (FLINT_DATA_DIR overrides). */
export function defaultDataDir(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string {
  if (env.FLINT_DATA_DIR) return env.FLINT_DATA_DIR;
  if (platform === "darwin") return join(homedir(), "Library", "Application Support", "Flint");
  if (platform === "win32") return join(env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "Flint");
  return join(homedir(), ".config", "Flint");
}

export function agentPaths(dataDir: string): { socketPath: string; tokenPath: string } {
  return { socketPath: join(dataDir, "agent.sock"), tokenPath: join(dataDir, "agent-token") };
}

export const NOT_RUNNING_MESSAGE = "Flint isn't running. Open Flint, then try again.";
