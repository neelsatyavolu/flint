import { execFile, execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ImapFlow } from "imapflow";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connectAgent } from "../src/agent/client";
import { agentPaths } from "../src/agent/paths";
import { memorySecrets, type Platform } from "../src/platform";
import { createFlintService, type FlintService } from "../src/service";
import type { AgentActivity, Draft, FlintEvent, SendResult, ThreadListItem } from "../src/types";
import { tryStartGreenMail, TEST_DOMAIN, type GreenMail } from "./greenmail";
import { waitFor } from "./harness";

const gm: GreenMail | null = await tryStartGreenMail({ users: ["agent", "rcpt"] });
afterAll(async () => { await gm?.stop(); });

const repoRoot = join(import.meta.dirname, "..", "..", "..");
const bin = join(repoRoot, "apps", "cli", "dist", "flint.js");

type Run = { status: number; stdout: string; stderr: string };

describe.skipIf(!gm)("agent API and flint CLI against a real FlintService", { timeout: 90_000 }, () => {
  let service: FlintService;
  let dataDir = "";
  const events: FlintEvent[] = [];
  let composeWired = false;
  let installDir = "";

  const flint = (args: string[], env: Record<string, string> = {}): Promise<Run> => {
    const clean: NodeJS.ProcessEnv = { ...process.env, FLINT_DATA_DIR: dataDir, ...env };
    delete clean.VITEST;
    delete clean.FLINT_AGENT;
    return new Promise((resolve) => {
      execFile("node", [bin, ...args], { env: clean, encoding: "utf8" }, (err, stdout, stderr) => {
        resolve({ status: err ? (typeof err.code === "number" ? err.code : 1) : 0, stdout, stderr });
      });
    });
  };
  const json = async <T>(args: string[], env?: Record<string, string>): Promise<T> => {
    const r = await flint([...args, "--json"], env);
    if (r.status !== 0) throw new Error(`flint ${args.join(" ")} exited ${r.status}: ${r.stderr}`);
    return JSON.parse(r.stdout) as T;
  };

  async function onServer<T>(name: string, fn: (c: ImapFlow) => Promise<T>): Promise<T> {
    const c = new ImapFlow({ host: gm!.host, port: gm!.imapPort, secure: false, auth: { user: name, pass: "secret" }, logger: false });
    c.on("error", () => undefined);
    await c.connect();
    try { return await fn(c); } finally { await c.logout().catch(() => c.close()); }
  }
  const inboxOf = (name: string) => onServer(name, async (c) => {
    const lock = await c.getMailboxLock("INBOX", { readOnly: true });
    try {
      const out: { subject: string; flags: string[] }[] = [];
      for await (const m of c.fetch("1:*", { flags: true, envelope: true })) out.push({ subject: m.envelope?.subject ?? "", flags: [...(m.flags ?? [])] });
      return out;
    } catch { return []; } finally { lock.release(); }
  });
  const rows = async (): Promise<AgentActivity[]> => service.listAgentActivity({ limit: 200 });
  const threads = async (): Promise<ThreadListItem[]> => (await json<{ items: ThreadListItem[] }>(["list"])).items;
  const thread = async (subject: string) => {
    const hit = (await threads()).find((t) => t.subject === subject);
    if (!hit) throw new Error(`no thread ${subject}`);
    return hit;
  };

  beforeAll(async () => {
    execFileSync("pnpm", ["--filter", "@flint/cli", "build"], { cwd: repoRoot, stdio: "ignore" });
    dataDir = mkdtempSync(join(tmpdir(), "fl-ag-"));
    installDir = join(mkdtempSync(join(tmpdir(), "fl-bin-")), "bin");
    const to = `agent@${TEST_DOMAIN}`;
    await gm!.deliver({ to, from: "Maria <maria@remote.example>", subject: "Lunch on Friday", text: "Are you free for lunch on Friday?" });
    await gm!.deliver({ to, from: "Omar <omar@remote.example>", subject: "Budget review", text: "Please sign off on the budget." });
    await gm!.deliver({ to, from: "Priya <priya@remote.example>", subject: "Pin me", text: "Keep this one handy." });
    await gm!.deliver({ to, from: "Tom <tom@remote.example>", subject: "Archive me", text: "Old news." });
    const platform: Platform = {
      dataDir, downloadsDir: dataDir, secrets: memorySecrets(), appVersion: "0.0.0-test",
      openExternal: async () => undefined, openPath: async () => undefined, notify: () => undefined,
    };
    service = await createFlintService(platform, {
      agentServer: true,
      cliPath: bin,
      cliInstallDirs: [installDir],
      sync: { pollMs: 500, idlePollMs: 5_000, backoff: { minMs: 200, maxMs: 1000 } },
    });
    await service.updateSettings({ agents: { enabled: true, send: "ask", modify: "allow" }, compose: { undoSendSeconds: 0 } });
    service.subscribe((e) => events.push(e));
    await service.start();
    await service.addAccount({
      email: to, name: "Agent", password: "secret",
      server: { imapHost: gm!.host, imapPort: gm!.imapPort, imapSecure: false, smtpHost: gm!.host, smtpPort: gm!.smtpPort, smtpSecure: false, username: "agent" },
    });
    await waitFor(async () => (await service.listThreads({ view: "inbox" })).items.length >= 4, "initial sync", 30_000);
    composeWired = await service.listDrafts().then(() => true, () => false);
  }, 120_000);

  afterAll(async () => { await service?.stop(); });

  it("opens the socket and token with owner-only permissions", () => {
    const { socketPath, tokenPath } = agentPaths(dataDir);
    expect(existsSync(socketPath)).toBe(true);
    expect(statSync(socketPath).mode & 0o077).toBe(0);
    expect(statSync(tokenPath).mode & 0o077).toBe(0);
  });

  it("status, accounts and list --json describe the real mailbox", async () => {
    const status = await flint(["status"]);
    expect(status.status).toBe(0);
    expect(status.stdout).toContain("Flint is running.");
    const accounts = await json<{ email: string }[]>(["accounts"]);
    expect(accounts.map((a) => a.email)).toEqual([`agent@${TEST_DOMAIN}`]);
    const subjects = (await threads()).map((t) => t.subject).sort();
    expect(subjects).toEqual(["Archive me", "Budget review", "Lunch on Friday", "Pin me"]);
  });

  it("read prints the thread body and search finds it", async () => {
    const t = await thread("Lunch on Friday");
    const read = await flint(["read", String(t.id)]);
    expect(read.status).toBe(0);
    expect(read.stdout).toContain("Are you free for lunch on Friday?");
    const hits = await json<{ items: ThreadListItem[] }>(["search", "from:maria"]);
    expect(hits.items.map((h) => h.id)).toEqual([t.id]);
  });

  it("archive, pin and mark-read reach the server and are logged under --as", async () => {
    const archive = await thread("Archive me");
    const pin = await thread("Pin me");
    const read = await thread("Budget review");
    expect((await flint(["archive", String(archive.id), "--as", "claude"])).status).toBe(0);
    expect((await flint(["pin", String(pin.id), "--as", "claude"])).status).toBe(0);
    expect((await flint(["mark-read", String(read.id), "--as", "claude"])).status).toBe(0);

    await waitFor(async () => !(await inboxOf("agent")).some((m) => m.subject === "Archive me"), "archive on server");
    const inbox = await inboxOf("agent");
    expect(inbox.find((m) => m.subject === "Pin me")?.flags).toContain("\\Flagged");
    expect(inbox.find((m) => m.subject === "Budget review")?.flags).toContain("\\Seen");

    const claude = (await rows()).filter((a) => a.agent === "claude");
    expect(claude.map((a) => a.method).sort()).toEqual(["archive", "markRead", "setPinned"]);
    expect(claude.every((a) => a.status === "ok")).toBe(true);
  });

  it("receipts lists tracked mail", async (ctx) => {
    const r = await flint(["receipts", "--json"]);
    if (r.status !== 0 && /Not wired yet/.test(r.stderr)) return ctx.skip();
    expect(r.status).toBe(0);
    expect(Array.isArray(JSON.parse(r.stdout))).toBe(true);
  });

  it("activity lists recent calls", async () => {
    const list = await json<AgentActivity[]>(["activity", "--as", "auditor"]);
    expect(list.length).toBeGreaterThan(3);
    expect(list.some((a) => a.agent === "claude" && a.summary.startsWith("Archived"))).toBe(true);
  });

  it("watch receives a new_mail event when mail is delivered", async () => {
    const child = spawn("node", [bin, "watch", "--as", "watcher"], { env: { ...process.env, FLINT_DATA_DIR: dataDir, VITEST: "" } });
    let out = "";
    child.stdout.on("data", (d: Buffer) => { out += d.toString(); });
    try {
      await new Promise((r) => setTimeout(r, 800)); // let the stream open
      await gm!.deliver({ to: `agent@${TEST_DOMAIN}`, from: "Nina <nina@remote.example>", subject: "Fresh arrival", text: "hello" });
      await waitFor(() => out.includes('"new_mail"'), "new_mail on the stream", 20_000);
      const event = out.split("\n").filter(Boolean).map((l) => JSON.parse(l) as FlintEvent).find((e) => e.type === "new_mail");
      expect(event).toMatchObject({ type: "new_mail", subject: "Fresh arrival" });
      expect(out).not.toContain('"type":"settings"');
    } finally {
      child.kill("SIGTERM");
    }
  });

  it("rejects admin methods and keeps the settings secret", async () => {
    const client = connectAgent({ dataDir, agent: "intruder" });
    await expect(client.getSettings()).rejects.toMatchObject({ code: "permission" });
    await expect(client.removeAccount("x")).rejects.toMatchObject({ code: "permission" });
    await expect(client.approveSend(1, true)).rejects.toMatchObject({ code: "permission" });
    expect((await rows()).some((a) => a.agent === "intruder" && a.status === "denied")).toBe(true);
  });

  it("refuses modify calls while changes are denied, then allows them again", async () => {
    await service.updateSettings({ agents: { modify: "deny" } });
    const t = await thread("Budget review");
    const r = await flint(["pin", String(t.id)]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("Agents can only read mail right now");
    expect((await flint(["list"])).status).toBe(0);
    await service.updateSettings({ agents: { modify: "allow" } });
  });

  describe("compose and send", () => {
    const sendFixture = async (subject: string, ctx: { skip: () => never }): Promise<Draft> => {
      if (!composeWired) ctx.skip();
      return json<Draft>(["draft", "--to", `rcpt@${TEST_DOMAIN}`, "--subject", subject, "--body", "Hello from an agent.", "--as", "claude"]);
    };

    it("draft and reply create drafts without sending", async (ctx) => {
      const d = await sendFixture("Draft only", ctx);
      expect(d.subject).toBe("Draft only");
      const t = await thread("Lunch on Friday");
      const reply = await json<Draft>(["reply", String(t.id), "--body", "Friday works.", "--as", "claude"]);
      expect(reply.to.map((a) => a.address)).toContain("maria@remote.example");
      expect(await inboxOf("rcpt")).toEqual([]);
    });

    it("send with 'ask' waits for approval, then the activity row follows the decision", async (ctx) => {
      await service.updateSettings({ agents: { send: "ask" } });
      const d = await sendFixture("Needs approval", ctx);
      const result = await json<SendResult>(["send", String(d.id), "--as", "claude"]);
      expect(result.status).toBe("awaiting_approval");
      const row = (await rows()).find((a) => a.method === "sendDraft" && a.status === "awaiting_approval");
      expect(row?.detail.scheduledId).toBe(result.scheduledId);
      expect(await inboxOf("rcpt")).toEqual([]);

      await service.approveSend(result.scheduledId, true);
      await waitFor(async () => (await inboxOf("rcpt")).some((m) => m.subject === "Needs approval"), "approved send delivered", 30_000);
      expect((await rows()).find((a) => a.id === row?.id)?.status).toBe("approved");
    });

    it("send with 'ask' and a denial never delivers", async (ctx) => {
      const d = await sendFixture("Will be denied", ctx);
      const result = await json<SendResult>(["send", String(d.id), "--as", "claude"]);
      const row = (await rows()).find((a) => a.method === "sendDraft" && a.status === "awaiting_approval" && a.detail.scheduledId === result.scheduledId);
      await service.approveSend(result.scheduledId, false);
      expect((await rows()).find((a) => a.id === row?.id)?.status).toBe("denied");
      await new Promise((r) => setTimeout(r, 1500));
      expect((await inboxOf("rcpt")).some((m) => m.subject === "Will be denied")).toBe(false);
    });

    it("send with 'deny' is rejected with exit code 1", async (ctx) => {
      const d = await sendFixture("Blocked send", ctx);
      await service.updateSettings({ agents: { send: "deny" } });
      const r = await flint(["send", String(d.id), "--as", "claude"]);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("Agents can't send mail right now");
    });

    it("send with 'allow' delivers to the recipient", async (ctx) => {
      await service.updateSettings({ agents: { send: "allow" } });
      const d = await sendFixture("Straight through", ctx);
      const result = await json<SendResult>(["send", String(d.id), "--as", "claude"]);
      expect(result.status).not.toBe("awaiting_approval");
      await waitFor(async () => (await inboxOf("rcpt")).some((m) => m.subject === "Straight through"), "delivery", 30_000);
    });
  });

  it("stops serving when agents are turned off and serves again when turned on", async () => {
    const { socketPath } = agentPaths(dataDir);
    await service.updateSettings({ agents: { enabled: false } });
    await waitFor(() => !existsSync(socketPath), "socket removed");
    expect((await flint(["status"])).status).toBe(2);
    await service.updateSettings({ agents: { enabled: true } });
    await waitFor(() => existsSync(socketPath), "socket back");
    expect((await flint(["status"])).status).toBe(0);
  });

  it("reports and installs the flint command", async () => {
    const before = await service.agentInfo();
    expect(before.socketPath).toBe(agentPaths(dataDir).socketPath);
    expect(before.tokenPath).toBe(agentPaths(dataDir).tokenPath);
    expect(before).toMatchObject({ cliInstalled: false, cliPath: null });

    const { path } = await service.installCli();
    expect(path).toBe(join(installDir, "flint"));
    expect(statSync(path).mode & 0o111).not.toBe(0);
    expect(readFileSync(path, "utf8")).toContain(bin);
    expect(await service.agentInfo()).toMatchObject({ cliInstalled: true, cliPath: path });

    const out = await new Promise<Run>((resolve) => {
      const env: NodeJS.ProcessEnv = { ...process.env, FLINT_DATA_DIR: dataDir };
      delete env.VITEST;
      execFile(path, ["status"], { env, encoding: "utf8" }, (err, stdout, stderr) => resolve({ status: err ? 1 : 0, stdout, stderr }));
    });
    expect(out.stdout).toContain("Flint is running.");
  });
});
