import { describe, expect, it } from "vitest";
import { autoconfig, domainOf, KNOWN_PROVIDERS, parseIspdb } from "./autoconfig";

const xml = (imapSocket = "SSL", imapPort = 993) => `<?xml version="1.0"?><clientConfig version="1.1"><emailProvider id="example.org">
<incomingServer type="imap"><hostname>imap.example.org</hostname><port>${imapPort}</port><socketType>${imapSocket}</socketType><authentication>password-cleartext</authentication><username>%EMAILLOCALPART%</username></incomingServer>
<incomingServer type="pop3"><hostname>pop.example.org</hostname><port>995</port><socketType>SSL</socketType><username>%EMAILADDRESS%</username></incomingServer>
<outgoingServer type="smtp"><hostname>smtp.example.org</hostname><port>587</port><socketType>STARTTLS</socketType><username>%EMAILADDRESS%</username></outgoingServer>
</emailProvider></clientConfig>`;

const never = async () => { throw new Error("should not be called"); };
const noNet = { fetch: never as never, resolveMx: never as never, probe: async () => false };

describe("autoconfig", () => {
  it("knows the common providers", async () => {
    const g = await autoconfig("Me@Gmail.com", noNet);
    expect(g).toMatchObject({ provider: "gmail", imapHost: "imap.gmail.com", imapPort: 993, imapSecure: true, smtpHost: "smtp.gmail.com", smtpPort: 465, smtpSecure: true, username: "me@gmail.com", source: "known", oauthGoogle: true });
    expect((await autoconfig("a@outlook.com", noNet)).imapHost).toBe("outlook.office365.com");
    expect((await autoconfig("a@icloud.com", noNet)).smtpPort).toBe(587);
    expect((await autoconfig("a@yahoo.com", noNet)).imapHost).toBe("imap.mail.yahoo.com");
    expect((await autoconfig("a@fastmail.com", noNet)).imapHost).toBe("imap.fastmail.com");
    expect((await autoconfig("a@zoho.com", noNet)).imapHost).toBe("imap.zoho.com");
    expect((await autoconfig("a@aol.com", noNet)).imapHost).toBe("imap.aol.com");
    expect(await autoconfig("a@proton.me", noNet)).toMatchObject({ imapHost: "127.0.0.1", imapPort: 1143, smtpPort: 1025, imapSecure: false });
    expect(Object.keys(KNOWN_PROVIDERS)).toEqual(expect.arrayContaining(["googlemail.com", "hotmail.com", "live.com", "me.com", "mac.com", "pm.me"]));
  });

  it("reads the Mozilla ISPDB for unknown domains", async () => {
    let asked = "";
    const cfg = await autoconfig("kim@example.org", {
      ...noNet, fetch: async (url) => { asked = url; return { ok: true, text: async () => xml() }; },
    });
    expect(asked).toBe("https://autoconfig.thunderbird.net/v1.1/example.org");
    expect(cfg).toMatchObject({ imapHost: "imap.example.org", imapPort: 993, imapSecure: true, smtpHost: "smtp.example.org", smtpPort: 587, smtpSecure: false, username: "kim", source: "ispdb", provider: "imap" });
  });

  it("falls through when the ISPDB has nothing or fails", async () => {
    const cfg = await autoconfig("a@nowhere.test", { fetch: async () => ({ ok: false, text: async () => "" }), resolveMx: async () => [], probe: async () => false });
    expect(cfg.source).toBe("guess");
    const thrown = await autoconfig("a@nowhere.test", { fetch: never as never, resolveMx: async () => { throw new Error("ENODATA"); }, probe: async () => false });
    expect(thrown.source).toBe("guess");
  });

  it("times out a hanging ISPDB request", async () => {
    const cfg = await autoconfig("a@slow.test", {
      timeoutMs: 20, resolveMx: async () => [], probe: async () => false,
      fetch: (_url, init) => new Promise((_res, rej) => init?.signal?.addEventListener("abort", () => rej(new Error("aborted")))),
    });
    expect(cfg.source).toBe("guess");
  });

  it("detects Google Workspace and Microsoft 365 through MX", async () => {
    const noIspdb = { fetch: async () => ({ ok: false, text: async () => "" }), probe: async () => false };
    const g = await autoconfig("a@corp.test", { ...noIspdb, resolveMx: async () => [{ exchange: "aspmx.l.google.com", priority: 1 }] });
    expect(g).toMatchObject({ source: "mx", provider: "gmail", imapHost: "imap.gmail.com" });
    const m = await autoconfig("a@corp.test", { ...noIspdb, resolveMx: async () => [{ exchange: "corp-test.mail.protection.outlook.com", priority: 0 }] });
    expect(m).toMatchObject({ source: "mx", imapHost: "outlook.office365.com", smtpHost: "smtp.office365.com" });
    const f = await autoconfig("a@corp.test", { ...noIspdb, resolveMx: async () => [{ exchange: "in1-smtp.messagingengine.com", priority: 1 }] });
    expect(f.imapHost).toBe("imap.fastmail.com");
  });

  it("guesses host names and prefers the ones that answer", async () => {
    const open = new Set(["mail.small.test:993", "mail.small.test:587"]);
    const cfg = await autoconfig("a@small.test", { fetch: async () => ({ ok: false, text: async () => "" }), resolveMx: async () => [], probe: async (h, p) => open.has(`${h}:${p}`) });
    expect(cfg).toMatchObject({ source: "guess", imapHost: "mail.small.test", imapPort: 993, smtpHost: "mail.small.test", smtpPort: 587, smtpSecure: false });
    const dflt = await autoconfig("a@small.test", { fetch: async () => ({ ok: false, text: async () => "" }), resolveMx: async () => [], probe: async () => false });
    expect(dflt).toMatchObject({ imapHost: "imap.small.test", smtpHost: "smtp.small.test", smtpPort: 465, smtpSecure: true });
  });

  it("rejects addresses without a domain", async () => {
    expect(() => domainOf("nodomain")).toThrow(/full email/);
    expect(() => domainOf("a@")).toThrow();
    await expect(autoconfig("bad", noNet)).rejects.toMatchObject({ code: "invalid" });
  });
});

describe("parseIspdb", () => {
  it("prefers SSL over STARTTLS and expands username templates", () => {
    const r = parseIspdb(xml(), "kim@example.org")!;
    expect(r.username).toBe("kim");
    const starttls = parseIspdb(xml("STARTTLS", 143), "kim@example.org")!;
    expect(starttls).toMatchObject({ imapPort: 143, imapSecure: false });
  });

  it("returns null without both servers", () => {
    expect(parseIspdb("<clientConfig></clientConfig>", "a@b.c")).toBeNull();
    expect(parseIspdb(xml().replace(/<outgoingServer[\s\S]*<\/outgoingServer>/, ""), "a@b.c")).toBeNull();
  });
});
