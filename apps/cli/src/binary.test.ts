import { execFile, execFileSync } from "node:child_process";
import { join } from "node:path";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { startAgentServer, type AgentServerHandle } from "@flint/core/agent/server";
import { fakeApi, settings, tempDir } from "@flint/core/agent/test-helpers";

const root = join(import.meta.dirname, "..");
const bin = join(root, "dist", "flint.js");

// Async on purpose: the live-server tests run the server in this process.
function flint(args: string[], env: Record<string, string>): Promise<{ status: number; stdout: string; stderr: string }> {
  const clean = { ...process.env, ...env };
  delete clean.VITEST;
  return new Promise((resolve) => {
    execFile("node", [bin, ...args], { env: clean, encoding: "utf8" }, (err, stdout, stderr) => {
      resolve({ status: err ? (typeof err.code === "number" ? err.code : 1) : 0, stdout, stderr });
    });
  });
}

beforeAll(() => { execFileSync("npx", ["tsup"], { cwd: root, stdio: "ignore" }); }, 60_000);

describe("built binary", () => {
  it("prints help", async () => {
    const r = await flint(["--help"], {});
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("Usage: flint");
    expect(readShebang()).toBe("#!/usr/bin/env node");
  });
  it("exits 2 when Flint isn't running", async () => {
    const r = await flint(["status"], { FLINT_DATA_DIR: tempDir() });
    expect(r.status).toBe(2);
    expect(r.stderr).toBe("Flint isn't running. Open Flint, then try again.\n");
  });

  describe("against a live server", () => {
    let handle: AgentServerHandle;
    let dir: string;
    const activity: string[] = [];
    beforeAll(async () => {
      dir = tempDir();
      const api = fakeApi({ archive: () => ({ undoToken: "u" }), listAccounts: () => [{ id: "a1", email: "me@x.co", name: "Me", provider: "gmail", enabled: true }] });
      handle = await startAgentServer({
        api, socketPath: join(dir, "agent.sock"), tokenPath: join(dir, "agent-token"),
        getSettings: () => settings(), logActivity: (e) => void activity.push(`${e.agent}|${e.summary}|${e.status}`),
      });
    });
    afterAll(async () => { await handle.close(); });

    it("round-trips a command and logs it under --as", async () => {
      const r = await flint(["archive", "1", "2", "3", "--as", "claude"], { FLINT_DATA_DIR: dir });
      expect(r.status).toBe(0);
      expect(r.stdout).toBe("Archived 3 threads. Undo: flint undo u\n");
      expect(activity).toContain("claude|Archived 3 threads|ok");
    });
    it("lists accounts and labels activity from FLINT_AGENT", async () => {
      expect((await flint(["accounts"], { FLINT_DATA_DIR: dir, FLINT_AGENT: "codex" })).stdout).toContain("me@x.co");
      expect(activity).toContain("codex|Listed accounts|ok");
    });
  });
});

function readShebang(): string {
  return execFileSync("head", ["-1", bin], { encoding: "utf8" }).trim();
}
