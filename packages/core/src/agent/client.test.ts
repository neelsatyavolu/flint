import { join } from "node:path";
import { writeFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { FlintError } from "../types";
import { AppNotRunningError, connectAgent } from "./client";
import { defaultDataDir, agentPaths } from "./paths";
import { startAgentServer, type AgentServerHandle } from "./server";
import { fakeApi, settings, tempDir } from "./test-helpers";

let handle: AgentServerHandle | null = null;
afterEach(async () => { await handle?.close(); handle = null; });

async function boot(api = fakeApi(), cfg = settings()) {
  const dir = tempDir();
  const activity: string[] = [];
  handle = await startAgentServer({ api, socketPath: join(dir, "agent.sock"), tokenPath: join(dir, "agent-token"), getSettings: () => cfg, logActivity: (e) => void activity.push(`${e.agent}:${e.summary}`), keepaliveMs: 30 });
  return { dir, api, activity };
}

describe("connectAgent", () => {
  it("calls api methods through the proxy and passes the agent name", async () => {
    const { dir, activity } = await boot(fakeApi({ listAccounts: () => [{ id: "a1" }] }));
    const client = connectAgent({ dataDir: dir, agent: "claude" });
    expect(await client.listAccounts()).toEqual([{ id: "a1" }]);
    expect(activity).toEqual(["claude:Listed accounts"]);
  });

  it("is not thenable and has no unknown methods", async () => {
    const client = connectAgent({ dataDir: tempDir() });
    expect((client as unknown as { then?: unknown }).then).toBeUndefined();
    expect((client as unknown as { nope?: unknown }).nope).toBeUndefined();
  });

  it("rethrows server errors as FlintError with the same code", async () => {
    const { dir } = await boot(fakeApi({ getThread: () => { throw new FlintError("not_found", "No such thread.") } }));
    const err = await connectAgent({ dataDir: dir }).getThread(1).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FlintError);
    expect(err).toMatchObject({ code: "not_found", message: "No such thread." });
    expect(err).not.toBeInstanceOf(AppNotRunningError);
  });

  it("maps permission errors", async () => {
    const { dir } = await boot();
    const err = await connectAgent({ dataDir: dir }).removeAccount("x").catch((e: unknown) => e);
    expect(err).toMatchObject({ code: "permission" });
  });

  it("reports a missing token file as app not running", async () => {
    const err = await connectAgent({ dataDir: tempDir() }).listAccounts().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppNotRunningError);
    expect(err).toMatchObject({ code: "network", message: "Flint isn't running. Open Flint, then try again." });
  });

  it("reports a missing or dead socket as app not running", async () => {
    const dir = tempDir();
    writeFileSync(join(dir, "agent-token"), "t".repeat(64));
    const client = connectAgent({ dataDir: dir });
    expect(await client.listAccounts().catch((e: unknown) => e)).toBeInstanceOf(AppNotRunningError);
    writeFileSync(join(dir, "agent.sock"), "");
    expect(await client.listAccounts().catch((e: unknown) => e)).toBeInstanceOf(AppNotRunningError);
  });

  it("reports a wrong token as auth", async () => {
    const { dir } = await boot();
    writeFileSync(join(dir, "agent-token"), "z".repeat(64));
    const err = await connectAgent({ dataDir: dir }).listAccounts().catch((e: unknown) => e);
    expect(err).toMatchObject({ code: "auth" });
  });

  it("honors explicit socketPath and tokenPath", async () => {
    const { dir } = await boot();
    const c = connectAgent({ socketPath: join(dir, "agent.sock"), tokenPath: join(dir, "agent-token") });
    expect(await c.listAccounts()).toBeNull();
  });

  it("streams events and stops on return", async () => {
    const { dir, api } = await boot();
    const client = connectAgent({ dataDir: dir });
    const it = client.events();
    const first = it.next();
    await new Promise((r) => setTimeout(r, 50));
    api.emit({ type: "toast", level: "info", message: "one" });
    expect((await first).value).toMatchObject({ type: "toast", message: "one" });
    await it.return();
    await new Promise((r) => setTimeout(r, 50));
    expect(api.listeners).toBe(0);
  });

  it("fails events() with permission when agents are off", async () => {
    const { dir } = await boot(fakeApi(), settings({ enabled: false }));
    const err = await connectAgent({ dataDir: dir }).events().next().catch((e: unknown) => e);
    expect(err).toMatchObject({ code: "permission" });
  });

  it("fails events() as not running", async () => {
    const err = await connectAgent({ dataDir: tempDir() }).events().next().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppNotRunningError);
  });
});

describe("paths", () => {
  it("picks the data dir per platform", () => {
    expect(defaultDataDir({ FLINT_DATA_DIR: "/x" }, "darwin")).toBe("/x");
    expect(defaultDataDir({}, "darwin")).toMatch(/Library\/Application Support\/Flint$/);
    expect(defaultDataDir({}, "linux")).toMatch(/\.config\/Flint$/);
    expect(defaultDataDir({ APPDATA: "/ad" }, "win32")).toBe(join("/ad", "Flint"));
    expect(agentPaths("/d")).toEqual({ socketPath: "/d/agent.sock", tokenPath: "/d/agent-token" });
  });
});
