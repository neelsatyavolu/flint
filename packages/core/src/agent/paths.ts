import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

/** Same location the desktop app uses for its data (FLINT_DATA_DIR overrides). */
export function defaultDataDir(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string {
  if (env.FLINT_DATA_DIR) return env.FLINT_DATA_DIR;
  if (platform === "darwin") return join(homedir(), "Library", "Application Support", "Flint");
  if (platform === "win32") return join(env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "Flint");
  return join(homedir(), ".config", "Flint");
}

/** macOS limits AF_UNIX paths to 104 bytes including the NUL; leave a little margin. */
export const MAX_SOCKET_PATH_BYTES = 100;
export const SOCKET_POINTER_FILE = "agent-socket-path";

/** Short, per-data-dir socket path used when <dataDir>/agent.sock is too long. The directory is created 0700 by the server. */
export function shortSocketPath(dataDir: string, tmp: string = tmpdir()): string {
  const id = createHash("sha256").update(dataDir).digest("hex").slice(0, 8);
  const dir = join(tmp, `flint-${id}`);
  const path = join(dir, "agent.sock");
  return Buffer.byteLength(path) <= MAX_SOCKET_PATH_BYTES ? path : join("/tmp", `flint-${id}`, "agent.sock");
}

export function agentPaths(dataDir: string, tmp?: string): { socketPath: string; tokenPath: string } {
  const inDir = join(dataDir, "agent.sock");
  const socketPath = Buffer.byteLength(inDir) <= MAX_SOCKET_PATH_BYTES ? inDir : shortSocketPath(dataDir, tmp);
  return { socketPath, tokenPath: join(dataDir, "agent-token") };
}

/** The socket the running app wrote to <dataDir>/agent-socket-path, if any. */
export function readSocketPointer(dataDir: string): string | null {
  try {
    const p = readFileSync(join(dataDir, SOCKET_POINTER_FILE), "utf8").trim();
    return p.length > 0 ? p : null;
  } catch {
    return null;
  }
}

export const NOT_RUNNING_MESSAGE = "Flint isn't running. Open Flint, then try again.";
