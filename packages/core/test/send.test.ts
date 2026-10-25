import { afterAll, describe, expect, it } from "vitest";
import { buildMime } from "../src/mail/compose";
import { testConnection } from "../src/mail/connect";
import { oneShotRunner } from "../src/mail/runner";
import { appendDraft, createSmtp, deleteDraftByUid, fileSentCopy, replaceDraft, sendTracked, sendUntracked } from "../src/mail/send";
import { tryStartGreenMail, type GreenMail } from "./greenmail";
import { addr, makeRig, sourcesIn, uidsIn } from "./harness";

const gm: GreenMail | null = await tryStartGreenMail({ users: ["alice", "bob", "carol", "dave", "erin"] });
afterAll(async () => { await gm?.stop(); });

const pixel = (html: string, token: string): string => `<img src="https://receipts.example/i/${token}.gif" width="1" height="1" alt="">${html}`;
const tokenOf = (source: string): string | null => /receipts\.example\/i\/([A-Za-z0-9_-]+)\.gif/.exec(source)?.[1] ?? null;
const header = (source: string, name: string): string | null => new RegExp(`^${name}:\\s*(.*)$`, "im").exec(source)?.[1]?.trim() ?? null;

describe.skipIf(!gm)("sending against GreenMail", { timeout: 30_000 }, () => {
  it("sendTracked delivers one copy per recipient with distinct pixels and leaves one clean copy in Sent", async () => {
    const rig = makeRig(gm!, "alice");
    const transport = createSmtp(rig.account, rig.auth);
    const runner = oneShotRunner(rig.account, async () => rig.auth);
    const messageId = "tracked-1@test.local";
    const message = {
      from: { name: "Alice", address: addr("alice") },
      to: [{ name: "Bob", address: addr("bob") }], cc: [{ name: "Carol", address: addr("carol") }], bcc: [{ name: "Dave", address: addr("dave") }],
      subject: "Tracked hello", html: "<p>Hello all</p>", messageId,
    };
    // Simulate a server that already saved its own copy of the sent mail, pixel included.
    const serverCopy = await buildMime({ ...message, html: pixel(message.html, "SERVERCOPY"), keepBcc: false });
    await runner.run((c) => c.append("Sent", serverCopy, ["\\Seen"]).then(() => undefined).catch(async () => { await c.mailboxCreate("Sent"); await c.append("Sent", serverCopy, ["\\Seen"]); }));
    expect(await sourcesIn(rig, "Sent")).toHaveLength(1);

    const out = await sendTracked(transport, {
      message, runner, folders: { provider: "imap", sentPath: "Sent" },
      tracked: [{ address: addr("bob"), token: "TOKENBOB" }, { address: addr("carol"), token: "TOKENCAROL" }, { address: addr("dave"), token: "TOKENDAVE" }],
      untracked: [addr("alice")], injectPixel: pixel,
    });
    transport.close();
    expect(out).toMatchObject({ messageId, copies: 4, failed: [] });

    const received: Record<string, string> = {};
    for (const who of ["bob", "carol", "dave", "alice"]) {
      const [src] = await sourcesIn(rig, "INBOX", who);
      expect(src, `${who} received a copy`).toBeTruthy();
      received[who] = src!;
    }
    expect(tokenOf(received["bob"]!)).toBe("TOKENBOB");
    expect(tokenOf(received["carol"]!)).toBe("TOKENCAROL");
    expect(tokenOf(received["dave"]!)).toBe("TOKENDAVE");
    expect(tokenOf(received["alice"]!)).toBeNull();
    for (const src of Object.values(received)) {
      expect(header(src, "Message-ID")).toBe(`<${messageId}>`);
      expect(header(src, "To")).toContain(addr("bob"));
      expect(header(src, "Cc")).toContain(addr("carol"));
      expect(header(src, "Bcc")).toBeNull();
      expect(src).toContain("Hello all");
    }

    const sent = await sourcesIn(rig, "Sent");
    expect(sent).toHaveLength(1);
    expect(tokenOf(sent[0]!)).toBeNull();
    expect(sent[0]).not.toContain("SERVERCOPY");
    expect(header(sent[0]!, "Bcc")).toContain(addr("dave"));
    expect(out.sent?.path).toBe("Sent");
    await rig.server(async (c) => {
      const lock = await c.getMailboxLock("Sent", { readOnly: true });
      try { expect([...((await c.fetchOne("1", { flags: true }))as { flags: Set<string> }).flags]).toContain("\\Seen"); } finally { lock.release(); }
    });
  });

  it("sendUntracked sends one message to everyone and files exactly one Sent copy", async () => {
    const rig = makeRig(gm!, "erin");
    const transport = createSmtp(rig.account, rig.auth);
    const runner = oneShotRunner(rig.account, async () => rig.auth);
    const out = await sendUntracked(transport, {
      message: { from: { name: "Erin", address: addr("erin") }, to: [{ name: "", address: addr("bob") }, { name: "", address: addr("carol") }], subject: "Plain", html: "<p>Plain mail</p>" },
      runner, folders: { provider: "imap", sentPath: "Sent" },
    });
    transport.close();
    expect(out.copies).toBe(1);
    expect(await sourcesIn(rig, "Sent")).toHaveLength(1);
    const bobSources = (await sourcesIn(rig, "INBOX", "bob")).filter((s) => s.includes("Plain mail"));
    expect(bobSources).toHaveLength(1);
    expect(header(bobSources[0]!, "Message-ID")).toBe(`<${out.messageId}>`);
    // Filing twice with the same Message-ID still leaves one copy.
    const mime = await buildMime({ from: { name: "Erin", address: addr("erin") }, to: [], subject: "Plain", html: "<p>Plain mail</p>", messageId: out.messageId });
    await fileSentCopy(runner, { provider: "imap", sentPath: "Sent" }, out.messageId, mime);
    expect(await sourcesIn(rig, "Sent")).toHaveLength(1);
  });

  it("reports a recipient the server refuses without losing the others", async () => {
    const rig = makeRig(gm!, "carol");
    const transport = createSmtp(rig.account, rig.auth);
    const real = transport.sendMail.bind(transport);
    transport.sendMail = (async (opts: Parameters<typeof real>[0]) => {
      if ((opts as { envelope?: { to?: string[] } }).envelope?.to?.includes(addr("dave"))) throw Object.assign(new Error("rejected"), { responseCode: 550, response: "550 no such user" });
      return real(opts);
    }) as typeof transport.sendMail;
    const out = await sendTracked(transport, {
      message: { from: { name: "", address: addr("carol") }, to: [{ name: "", address: addr("bob") }, { name: "", address: addr("dave") }], subject: "Partial", html: "<p>x</p>" },
      folders: { provider: "imap", sentPath: "Sent" },
      tracked: [{ address: addr("bob"), token: "T1" }, { address: addr("dave"), token: "T2" }], untracked: [], injectPixel: pixel,
    });
    transport.close();
    expect(out.copies).toBe(1);
    expect(out.failed).toEqual([{ address: addr("dave"), error: expect.stringContaining("refused") }]);
    expect(out.sent).toBeNull();
  });

  it("saves, replaces and deletes a server draft", async () => {
    const rig = makeRig(gm!, "bob");
    const runner = oneShotRunner(rig.account, async () => rig.auth);
    const draft = (text: string) => buildMime({ from: { name: "Bob", address: addr("bob") }, to: [{ name: "", address: addr("alice") }], subject: "Draft", html: `<p>${text}</p>`, messageId: "draft-1@test.local", keepBcc: true });
    const uid1 = await appendDraft(runner, "Drafts", await draft("first version"));
    expect(uid1).toBeTypeOf("number");
    expect(await sourcesIn(rig, "Drafts")).toHaveLength(1);

    const uid2 = await replaceDraft(runner, "Drafts", uid1, await draft("second version"));
    const after = await sourcesIn(rig, "Drafts");
    expect(after).toHaveLength(1);
    expect(after[0]).toContain("second version");
    expect(uid2).not.toBe(uid1);
    await rig.server(async (c) => {
      const lock = await c.getMailboxLock("Drafts", { readOnly: true });
      try {
        const flags = [...((await c.fetchOne(String(uid2), { flags: true }, { uid: true })) as { flags: Set<string> }).flags];
        expect(flags).toEqual(expect.arrayContaining(["\\Draft", "\\Seen"]));
      } finally { lock.release(); }
    });

    await deleteDraftByUid(runner, "Drafts", uid2!);
    expect(await uidsIn(rig, "Drafts")).toHaveLength(0);
  });

  it("testConnection accepts good credentials and explains failures", async () => {
    const server = { imapHost: gm!.host, imapPort: gm!.imapPort, imapSecure: false, smtpHost: gm!.host, smtpPort: gm!.smtpPort, smtpSecure: false, username: "alice" };
    const ok = await testConnection(server, { user: "alice", pass: "secret" });
    expect(ok).toMatchObject({ imap: true, smtp: true });
    expect(ok.imapCapabilities).toContain("IDLE");
    await expect(testConnection(server, { user: "alice", pass: "nope" })).rejects.toMatchObject({ code: "auth" });
    await expect(testConnection({ ...server, imapPort: 1 }, { user: "alice", pass: "secret" })).rejects.toMatchObject({ code: "network", message: expect.stringContaining("IMAP") });
    await expect(testConnection({ ...server, smtpPort: 1 }, { user: "alice", pass: "secret" })).rejects.toMatchObject({ code: "network", message: expect.stringContaining("SMTP") });
  });
});
