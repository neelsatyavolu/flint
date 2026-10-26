import { describe, expect, it } from "vitest";
import { loadFixture } from "../../fixtures";
import { autoconfig, domainOf, KNOWN_PROVIDERS, mxHostOf, parseIspdb } from "./autoconfig";

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

describe("parseIspdb encryption", () => {
  const xml = (socket: string, host = "imap.example.org") => `<clientConfig><emailProvider><incomingServer type="imap"><hostname>${host}</hostname><port>143</port><socketType>${socket}</socketType><username>%EMAILADDRESS%</username></incomingServer><outgoingServer type="smtp"><hostname>smtp.example.org</hostname><port>587</port><socketType>STARTTLS</socketType><username>%EMAILADDRESS%</username></outgoingServer></emailProvider></clientConfig>`;
  it("ignores servers that offer no encryption", () => {
    expect(parseIspdb(xml("plain"), "a@example.org")).toBeNull();
  });
  it("detects Gmail from the IMAP host", () => {
    expect(parseIspdb(xml("STARTTLS", "imap.gmail.com"), "a@corp.example")?.provider).toBe("gmail");
  });
});

describe("autoconfig for Proton Mail", () => {
  const noIspdb = { fetch: async () => ({ ok: false, text: async () => "" }), probe: async () => false };
  const bridge = { imapHost: "127.0.0.1", imapPort: 1143, imapSecure: false, smtpHost: "127.0.0.1", smtpPort: 1025, smtpSecure: true, hint: "proton_bridge" };

  it("returns the Bridge settings for proton.me, protonmail.com and pm.me addresses", async () => {
    for (const d of ["proton.me", "protonmail.com", "pm.me"]) expect(await autoconfig(`a@${d}`, noNet)).toMatchObject(bridge);
  });

  it("detects a Proton-hosted custom domain through MX", async () => {
    for (const mx of ["mail.protonmail.ch", "mailsec.protonmail.ch"]) {
      const cfg = await autoconfig("neel@xanom.co", { ...noIspdb, resolveMx: async () => [{ exchange: mx, priority: 10 }] });
      expect(cfg).toMatchObject({ ...bridge, source: "mx", username: "neel@xanom.co", provider: "imap" });
    }
  });

  it("asks for an app password on Gmail and iCloud, and nothing on a plain guess", async () => {
    expect((await autoconfig("a@gmail.com", noNet)).hint).toBe("app_password");
    expect((await autoconfig("a@icloud.com", noNet)).hint).toBe("app_password");
    expect((await autoconfig("a@nowhere.test", { ...noIspdb, resolveMx: async () => [] })).hint ?? null).toBeNull();
  });

  it("names the MX host", async () => {
    expect(await mxHostOf("x.test", { resolveMx: async () => [{ exchange: "mx1.zoho.eu", priority: 1 }] })).toBe("zoho");
    expect(await mxHostOf("x.test", { resolveMx: async () => [{ exchange: "mx.unknown.example", priority: 1 }] })).toBeNull();
    expect(await mxHostOf("x.test", { resolveMx: async () => { throw new Error("ENODATA"); } })).toBeNull();
  });
});

type ProviderInput = { fn: string; email?: string; ispdbXml?: string | null; mx?: string[] | "error"; open?: string[]; xml?: string; exchanges?: string[] | "error" };
const providers = loadFixture<ProviderInput, any>("providers");

describe("providers fixtures", () => {
  it.each(providers.cases)("$name", async ({ input, expect: want }) => {
    const mx = (list: string[] | "error" | undefined) => async () => {
      if (list === "error") throw new Error("ENODATA");
      return (list ?? []).map((exchange, priority) => ({ exchange, priority }));
    };
    switch (input.fn) {
      case "autoconfig": {
        const cfg = await autoconfig(input.email!, {
          fetch: async () => ({ ok: input.ispdbXml !== null && input.ispdbXml !== undefined, text: async () => input.ispdbXml ?? "" }),
          resolveMx: mx(input.mx), probe: async (h, p) => (input.open ?? []).includes(`${h}:${p}`),
        });
        return expect(JSON.parse(JSON.stringify(cfg))).toEqual(want);
      }
      case "parseIspdb": return expect(parseIspdb(input.xml!, input.email!)).toEqual(want);
      case "mxHost": return expect(await mxHostOf("x.test", { resolveMx: mx(input.exchanges) })).toBe(want);
      case "domainOf": {
        try { return expect(domainOf(input.email!)).toBe(want); } catch (err) { return expect({ error: (err as { code: string }).code }).toEqual(want); }
      }
    }
  });
});
