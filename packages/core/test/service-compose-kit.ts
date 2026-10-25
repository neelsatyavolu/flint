import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ImapFlow } from "imapflow";
import { memorySecrets, type Platform } from "../src/platform";
import { createFlintService, type FlintService } from "../src/service";
import type { FlintEvent } from "../src/types";
import { TEST_DOMAIN, type GreenMail } from "./greenmail";

export const RECEIPTS_ENDPOINT = "https://receipts.test";
export const GMAIL_UA = "Mozilla/5.0 (Windows NT 5.1; rv:11.0) Gecko Firefox/11.0 (via ggpht.com GoogleImageProxy)";
export const CHROME_UA = "Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/126.0 Safari/537.36";
export const GOOGLE_NET = { asn: 15169, asOrganization: "Google LLC", country: "US", city: "Mountain View" };
export const APPLE_NET = { asn: 714, asOrganization: "Apple Inc.", country: "US", city: "Cupertino" };
export const AWS_NET = { asn: 16509, asOrganization: "Amazon.com, Inc.", country: "US", city: "Ashburn" };

type WorkerCall = (path: string, init?: RequestInit & { ip?: string; cf?: unknown; now?: number }) => Promise<Response>;
type WorkerHelpers = { T0: number; setup(): { raw: { prepare(sql: string): { get(...p: unknown[]): unknown } }; call: WorkerCall } };

/** The real receipts Worker router over a node:sqlite D1 fake. Its clock is explicit so hits can be classified at chosen times. */
export async function startWorker() {
  // A variable path keeps the Worker sources (and their Cloudflare types) out of this package's typecheck.
  const url = new URL("../../../services/receipts/src/test/helpers.ts", import.meta.url).href;
  const helpers = (await import(/* @vite-ignore */ url)) as WorkerHelpers;
  const s = helpers.setup();
  const calls: string[] = [];
  return {
    t0: helpers.T0,
    raw: s.raw,
    calls,
    /** Goes into ServiceOptions.fetch: routes requests for the receipts endpoint to the Worker. */
    fetch: (async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      calls.push(`${init?.method ?? "GET"} ${url.pathname}`);
      return s.call(url.pathname + url.search, { ...init, ip: "198.51.100.1" });
    }) as typeof fetch,
    /** A recipient's mail app loading the pixel. */
    hit(token: string, o: { ua?: string; ip?: string; cf?: { asn: number; asOrganization: string; country?: string; city?: string }; at: number; method?: string }) {
      return s.call(`/i/${token}.gif`, { method: o.method ?? "GET", headers: { "User-Agent": o.ua ?? CHROME_UA }, ip: o.ip ?? "203.0.113.50", cf: o.cf, now: helpers.T0 + o.at });
    },
  };
}

export type Rig = {
  service: FlintService;
  platform: Platform;
  dataDir: string;
  events: FlintEvent[];
  notified: string[];
  clock: { advance(ms: number): void; now(): number };
  accountId: string;
  /** Re-arms the scheduler after the fake clock moved. */
  nudge(): Promise<void>;
};

export type BootOptions = { fetch?: typeof fetch; agents?: boolean; account?: string; settings?: Parameters<FlintService["updateSettings"]>[0] };

export async function boot(gm: GreenMail, opts: BootOptions = {}): Promise<Rig> {
  const dataDir = mkdtempSync(join(tmpdir(), "flint-cmp-"));
  const notified: string[] = [];
  const platform: Platform = {
    dataDir, downloadsDir: dataDir, secrets: memorySecrets(), appVersion: "0.0.0-test",
    openExternal: async () => undefined, openPath: async () => undefined, notify: (n) => { notified.push(`${n.title}: ${n.body}`); },
  };
  let offset = 0;
  const now = () => Date.now() + offset;
  const service = await createFlintService(platform, {
    now, agentServer: opts.agents === true,
    sync: { pollMs: 400, idlePollMs: 5_000, backoff: { minMs: 200, maxMs: 1000 } },
    ...(opts.fetch ? { fetch: opts.fetch } : {}),
  });
  const events: FlintEvent[] = [];
  service.subscribe((e) => events.push(e));
  await service.updateSettings({ compose: { undoSendSeconds: 5 }, ...(opts.agents ? { agents: { enabled: true } } : {}), ...opts.settings });
  await service.start();
  const name = opts.account ?? "alice";
  const account = await service.addAccount({
    email: `${name}@${TEST_DOMAIN}`, name: name[0]!.toUpperCase() + name.slice(1), password: "secret",
    server: { imapHost: gm.host, imapPort: gm.imapPort, imapSecure: false, smtpHost: gm.host, smtpPort: gm.smtpPort, smtpSecure: false, username: name },
  });
  return {
    service, platform, dataDir, events, notified, accountId: account.id,
    clock: { advance: (ms) => { offset += ms; }, now },
    // A settings write pokes the scheduler (receipts.enabled toggles), which re-arms its timer from the fake clock.
    async nudge() {
      const on = (await service.getSettings()).receipts.enabled;
      await service.updateSettings({ receipts: { enabled: !on } });
      await service.updateSettings({ receipts: { enabled: on } });
    },
  };
}

export async function onServer<T>(gm: GreenMail, name: string, fn: (c: ImapFlow) => Promise<T>): Promise<T> {
  const c = new ImapFlow({ host: gm.host, port: gm.imapPort, secure: false, auth: { user: name, pass: "secret" }, logger: false });
  c.on("error", () => undefined);
  await c.connect();
  try { return await fn(c); } finally { await c.logout().catch(() => c.close()); }
}

/** Raw sources and flags of every message in a mailbox. */
export async function mailbox(gm: GreenMail, name: string, path: string): Promise<{ uid: number; flags: string[]; source: string }[]> {
  return onServer(gm, name, async (c) => {
    if (!(await c.list()).some((b) => b.path === path)) return [];
    const lock = await c.getMailboxLock(path, { readOnly: true });
    try {
      if (!c.mailbox || c.mailbox.exists === 0) return [];
      const out = [];
      for await (const m of c.fetch("1:*", { uid: true, flags: true, source: true })) out.push({ uid: m.uid, flags: [...(m.flags ?? [])], source: m.source?.toString("utf8") ?? "" });
      return out;
    } finally { lock.release(); }
  });
}

export const header = (source: string, name: string): string | null =>
  new RegExp(`^${name}:\\s*((?:.*)(?:\\r?\\n[ \\t].*)*)`, "im").exec(source)?.[1]?.replace(/\r?\n[ \t]+/g, " ").trim() ?? null;
/** Quoted-printable soft line breaks can split the URL, so join them first. */
export const unfold = (source: string): string => source.replace(/=\r?\n/g, "");
export const pixelToken = (source: string): string | null => /receipts\.test\/i\/([A-Za-z0-9_-]{22})\.gif/.exec(unfold(source))?.[1] ?? null;
export const addrOf = (name: string): string => `${name}@${TEST_DOMAIN}`;
