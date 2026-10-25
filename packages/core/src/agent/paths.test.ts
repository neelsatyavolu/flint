import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { connectAgent } from "./client";
import { agentPaths, MAX_SOCKET_PATH_BYTES, SOCKET_POINTER_FILE } from "./paths";
import { startAgentServer, type AgentServerHandle } from "./server";
import { fakeApi, settings, tempDir } from "./test-helpers";

let handle: AgentServerHandle | null = null;
afterEach(async () => { await handle?.close(); handle = null; });

describe("agent socket paths", () => {
  it("keeps agent.sock in the data dir when it fits", () => {
    expect(agentPaths("/data").socketPath).toBe("/data/agent.sock");
  });

  it("falls back to a short tmp path for a long data dir", () => {
    const long = join(tempDir(), "x".repeat(120));
    const { socketPath } = agentPaths(long);
    expect(Buffer.byteLength(socketPath)).toBeLessThanOrEqual(MAX_SOCKET_PATH_BYTES);
    expect(socketPath).toMatch(/flint-[0-9a-f]{8}/);
    expect(agentPaths(long).socketPath).toBe(socketPath);
  });

  it("serves and connects through the short path, advertised by agent-socket-path", async () => {
    const dataDir = join(tempDir(), "y".repeat(120));
    mkdirSync(dataDir, { recursive: true });
    const { socketPath, tokenPath } = agentPaths(dataDir);
    handle = await startAgentServer({ api: fakeApi(), socketPath, tokenPath, getSettings: () => settings(), logActivity: () => {} });
    expect(readFileSync(join(dataDir, SOCKET_POINTER_FILE), "utf8")).toBe(socketPath);
    expect(statSync(socketPath).mode & 0o777).toBe(0o600);
    expect(statSync(join(socketPath, "..")).mode & 0o777).toBe(0o700);
    const client = connectAgent({ dataDir });
    await expect(client.listAccounts()).resolves.toBeNull();
    await handle.close();
    expect(existsSync(join(dataDir, SOCKET_POINTER_FILE))).toBe(false);
    handle = null;
  });
});
