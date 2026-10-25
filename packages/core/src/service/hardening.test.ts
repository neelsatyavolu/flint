import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { openDb } from "../db/open";
import { makeStore, msg, seedImap } from "../store/testkit";
import { DEFAULT_SETTINGS } from "../store/settings";
import { riskyExtension } from "./attachmentSafety";
import { openAttachment } from "./attachments";
import { ensureBodies } from "./bodies";
import type { ServiceContext } from "./context";
import { authOutcome, imagePolicy } from "./imagePolicy";
import type { SyncManager } from "./syncManager";
import { isPublicAddress, isPublicHttpsUrl, resolvesToPublicOnly } from "./unsubscribe";

describe("risky attachment types", () => {
  it.each(["run.command", "Evil.APP", "x.pdf.terminal", "a.workflow", "t.jar", "s.scpt", "l.webloc", "p.html", "i.svg", "x.sh"])("%s is refused", (name) => {
    expect(riskyExtension(name)).not.toBeNull();
  });
  it.each(["report.pdf", "photo.jpg", "notes.txt", "sheet.xlsx", "archive.zip", "noext"])("%s is fine", (name) => {
    expect(riskyExtension(name)).toBeNull();
  });
  it("openAttachment refuses an executable type before fetching anything", async () => {
    const fetchAttachment = vi.fn();
    const openPath = vi.fn();
    const ctx = {
      store: { getAttachment: () => ({ id: 1, messageRowId: 2, filename: "Invoice.command" }), getMessage: () => ({ accountId: "a" }) },
      syncs: { get: () => ({ fetchAttachment }) }, platform: { openPath },
    } as unknown as ServiceContext;
    await expect(openAttachment(ctx, 1)).rejects.toMatchObject({ code: "permission" });
    expect(fetchAttachment).not.toHaveBeenCalled();
    expect(openPath).not.toHaveBeenCalled();
  });
});

describe("one-click unsubscribe address checks", () => {
  it.each(["127.0.0.1", "10.1.2.3", "192.168.0.9", "169.254.169.254", "172.20.0.1", "100.64.0.1", "0.0.0.0", "::1", "::", "fe80::1", "fc00::1", "fd12::1", "::ffff:127.0.0.1", "::ffff:7f00:1"])("%s is not public", (ip) => {
    expect(isPublicAddress(ip)).toBe(false);
  });
  it.each(["8.8.8.8", "93.184.216.34", "2606:4700:4700::1111", "::ffff:8.8.8.8"])("%s is public", (ip) => {
    expect(isPublicAddress(ip)).toBe(true);
  });
  it("rejects a name that resolves to a private address, even when another answer is public", async () => {
    expect(await resolvesToPublicOnly("evil.example", async () => ["8.8.8.8", "127.0.0.1"])).toBe(false);
    expect(await resolvesToPublicOnly("rebind.example", async () => ["169.254.169.254"])).toBe(false);
    expect(await resolvesToPublicOnly("ok.example", async () => ["93.184.216.34", "2606:4700:4700::1111"])).toBe(true);
  });
  it("treats a failed or empty lookup as not public", async () => {
    expect(await resolvesToPublicOnly("nx.example", async () => { throw new Error("ENOTFOUND"); })).toBe(false);
    expect(await resolvesToPublicOnly("empty.example", async () => [])).toBe(false);
  });
  it("still applies the literal host rules", () => {
    expect(isPublicHttpsUrl("https://localhost/u")).toBe(false);
    expect(isPublicHttpsUrl("https://lists.example.org/u")).toBe(true);
  });
});

describe("remote images and a forged From", () => {
  const setup = () => {
    const store = makeStore();
    seedImap(store);
    return { store, policy: imagePolicy(store, { ...DEFAULT_SETTINGS, inbox: { ...DEFAULT_SETTINGS.inbox, remoteImages: "known_senders" } }) };
  };
  const from = [{ name: "Me", address: "me@example.com" }];

  it("trusts a from-me message only when it is in Sent", () => {
    const { policy } = setup();
    expect(policy.allowed(1, from, { isFromMe: true, inSent: false })).toBe(false);
    expect(policy.allowed(1, from, { isFromMe: true, inSent: true })).toBe(true);
  });
  it("trusts a from-me message that the receiving server authenticated", () => {
    const { policy } = setup();
    expect(policy.allowed(1, from, { isFromMe: true, inSent: false, headers: { "authentication-results": "mx.google.com; dkim=pass header.i=@example.com; spf=pass" } })).toBe(true);
  });
  it("blocks a known sender whose message failed authentication", () => {
    const { store } = setup();
    store.kvSet("images:senders", JSON.stringify(["pal@example.org"]));
    const pal = [{ name: "Pal", address: "pal@example.org" }];
    const fresh = imagePolicy(store, { ...DEFAULT_SETTINGS, inbox: { ...DEFAULT_SETTINGS.inbox, remoteImages: "known_senders" } });
    expect(fresh.allowed(2, pal, { isFromMe: false, inSent: false })).toBe(true);
    expect(fresh.allowed(2, pal, { isFromMe: false, inSent: false, headers: { "authentication-results": "mx; dkim=fail; spf=pass" } })).toBe(false);
  });
  it("reads Authentication-Results", () => {
    expect(authOutcome(undefined)).toBe("unknown");
    expect(authOutcome({ "authentication-results": "mx; spf=softfail" })).toBe("fail");
    expect(authOutcome({ "authentication-results": "mx; dmarc=pass" })).toBe("pass");
  });
  it("marks messages in a Sent folder when reading a thread", () => {
    const store = makeStore();
    const seed = seedImap(store);
    store.ingestMessages(seed.account.id, seed.inbox.id, [msg({ uid: 1, subject: "Forged", from: [{ name: "Me", address: "me@example.com" }] })]);
    store.ingestMessages(seed.account.id, seed.sent.id, [msg({ uid: 1, subject: "Real", from: [{ name: "Me", address: "me@example.com" }] })]);
    const rows = [...store.listThreads({ view: "inbox" }).items, ...store.listThreads({ view: "sent" }).items];
    const flags = rows.flatMap((t) => store.getThreadRows(t.id)!.messages.map((m) => [m.subject, m.isFromMe, m.inSent]));
    expect(flags).toContainEqual(["Forged", true, false]);
    expect(flags).toContainEqual(["Real", true, true]);
  });
});

describe("body fetching", () => {
  it("does not let one hung fetch block the rest", async () => {
    const store = makeStore();
    const seed = seedImap(store);
    store.ingestMessages(seed.account.id, seed.inbox.id, [msg({ uid: 1 }), msg({ uid: 2 })]);
    const ids = store.listThreads({ view: "inbox" }).items.flatMap((t) => store.getThreadRows(t.id)!.messages.map((m) => m.id));
    const hung = ids[0]!;
    const fetched: number[] = [];
    const syncs = { get: () => ({ fetchBody: (id: number) => (id === hung ? new Promise<never>(() => undefined) : Promise.resolve().then(() => { fetched.push(id); })) }) } as unknown as SyncManager;
    const started = Date.now();
    await ensureBodies(store, syncs, ids, 50);
    expect(Date.now() - started).toBeLessThan(2000);
    expect(fetched).toEqual(ids.filter((i) => i !== hung));
  });
});

describe("data directory permissions", () => {
  it("creates the folder 0700 and the database 0600", () => {
    const dir = join(mkdtempSync(join(tmpdir(), "flint-perm-")), "data");
    const db = openDb(join(dir, "flint.db"));
    db.close();
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    expect(statSync(join(dir, "flint.db")).mode & 0o777).toBe(0o600);
  });
});
