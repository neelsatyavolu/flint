import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { memorySecrets, type Platform } from "../src/platform";
import { createFlintService, type FlintService, type ServiceOptions } from "../src/service";
import { SECRET_MASK, GOOGLE_SECRET_KEY } from "../src/service/googleSecret";
import { mailHostName } from "../src/service/connectionCheck";
import { describeConnectError, isLookupFailure } from "../src/mail/connect";
import { FlintError, type FlintEvent } from "../src/types";

const services: FlintService[] = [];
// One test adds a Gmail account, whose sync dials imap.gmail.com; stopping it can take a while offline.
afterEach(async () => { await Promise.all(services.splice(0).map((s) => s.stop())); }, 30_000);

async function boot(opts: ServiceOptions = {}, secrets = memorySecrets()) {
  const platform: Platform = {
    dataDir: mkdtempSync(join(tmpdir(), "flint-w4-")), downloadsDir: tmpdir(), secrets, appVersion: "0.0.0-test",
    openExternal: async () => undefined, openPath: async () => undefined, notify: () => undefined,
  };
  const service = await createFlintService(platform, { dbPath: ":memory:", ...opts });
  services.push(service);
  const events: FlintEvent[] = [];
  service.subscribe((e) => events.push(e));
  await service.start();
  return { service, secrets, events };
}

const signIn = { email: "Neel@Xanom.co", name: "Neel", accessToken: "AT", refreshToken: "RT", expiresAt: Date.now() + 3_600_000 };

describe("Google account without a Gmail inbox", () => {
  it("names the provider that hosts the mail and creates no account", async () => {
    const { service, secrets } = await boot({
      googleAuth: async () => signIn,
      resolveMx: async () => [{ exchange: "mail.protonmail.ch", priority: 10 }],
      googleMailboxCheck: async (server, email, token, resolveMx) => {
        expect(email).toBe("neel@xanom.co");
        expect(token).toBe("AT");
        expect(server.imapHost).toBe("imap.gmail.com");
        throw new FlintError("invalid", `This Google account doesn't have a Gmail inbox. Its mail is handled by ${await mailHostName(email, resolveMx)}.`);
      },
    });
    await service.updateSettings({ google: { clientId: "cid", clientSecret: "sec" } });
    await expect(service.addGoogleAccount()).rejects.toMatchObject({
      code: "invalid", message: "This Google account doesn't have a Gmail inbox. Its mail is handled by Proton Mail.",
    });
    expect(await service.listAccounts()).toEqual([]);
    expect(await secrets.get("account:anything")).toBeNull();
  });

  it("saves the account when the mailbox check passes", async () => {
    const { service } = await boot({ googleAuth: async () => ({ ...signIn, email: "me@gmail.com" }), googleMailboxCheck: async () => undefined });
    await service.updateSettings({ google: { clientId: "cid", clientSecret: "sec" } });
    const account = await service.addGoogleAccount();
    expect(account).toMatchObject({ email: "me@gmail.com", provider: "gmail", authKind: "oauth_google" });
  });

  it("records the calendar scope Google granted, in the account and the saved sign-in", async () => {
    const scope = "https://mail.google.com/ openid email https://www.googleapis.com/auth/calendar.events";
    const { service, secrets } = await boot({ googleAuth: async () => ({ ...signIn, email: "me@gmail.com", scope }), googleMailboxCheck: async () => undefined });
    await service.updateSettings({ google: { clientId: "cid", clientSecret: "sec" } });
    const account = await service.addGoogleAccount();
    expect(account.calendarScope).toBe(true);
    expect(JSON.parse((await secrets.get(`account:${account.id}`))!).scope).toBe(scope);
  });

  it("leaves calendarScope off when the user did not grant it", async () => {
    const { service } = await boot({ googleAuth: async () => ({ ...signIn, email: "me@gmail.com", scope: "https://mail.google.com/ openid email" }), googleMailboxCheck: async () => undefined });
    await service.updateSettings({ google: { clientId: "cid", clientSecret: "sec" } });
    expect((await service.addGoogleAccount()).calendarScope).toBe(false);
  });

  it("names Microsoft 365, Zoho, Fastmail, iCloud, or another provider", async () => {
    const mx = (exchange: string) => async () => [{ exchange, priority: 1 }];
    expect(await mailHostName("a@x.test", mx("x.mail.protection.outlook.com"))).toBe("Microsoft 365");
    expect(await mailHostName("a@x.test", mx("mx.zoho.com"))).toBe("Zoho Mail");
    expect(await mailHostName("a@x.test", mx("in1-smtp.messagingengine.com"))).toBe("Fastmail");
    expect(await mailHostName("a@x.test", mx("mx01.mail.icloud.com"))).toBe("iCloud Mail");
    expect(await mailHostName("a@x.test", mx("mail.example.net"))).toBe("another provider");
    expect(await mailHostName("a@x.test", mx("aspmx.l.google.com"))).toBe("another provider");
    expect(await mailHostName("a@x.test", async () => { throw new Error("ENODATA"); })).toBe("another provider");
  });
});

describe("built-in Google client", () => {
  const builtIn = { clientId: "builtin.apps.googleusercontent.com", clientSecret: "builtin-secret" };

  it("signs in with the client the build ships when the user has none, and says so in settings", async () => {
    const used: string[] = [];
    // Stop at sign-in: adding the account would start a real Gmail sync.
    const { service } = await boot({ googleClient: builtIn, googleAuth: async (opts) => { used.push(opts.clientId); throw new FlintError("auth", "stop here"); } });
    const settings = await service.getSettings();
    expect(settings.google).toEqual({ clientId: "", clientSecret: "", builtIn: true });
    await expect(service.addGoogleAccount()).rejects.toMatchObject({ message: "stop here" });
    expect(used).toEqual([builtIn.clientId]);
  });

  it("prefers the user's own client", async () => {
    const used: string[] = [];
    const { service } = await boot({ googleClient: builtIn, googleAuth: async (opts) => { used.push(opts.clientId); throw new FlintError("auth", "stop here"); } });
    await service.updateSettings({ google: { clientId: "own.apps.googleusercontent.com", clientSecret: "own" } });
    await expect(service.addGoogleAccount()).rejects.toMatchObject({ message: "stop here" });
    expect(used).toEqual(["own.apps.googleusercontent.com"]);
  });

  it("reports no built-in client when the build has none", async () => {
    const { service } = await boot();
    expect((await service.getSettings()).google.builtIn).toBeUndefined();
    await expect(service.addGoogleAccount()).rejects.toMatchObject({ code: "invalid" });
  });
});

describe("connection error wording", () => {
  it("treats Lookup failed as a missing mailbox, not a password problem", () => {
    const err = { authenticationFailed: true, responseText: "Lookup failed", serverResponseCode: "AUTHENTICATIONFAILED" };
    expect(isLookupFailure(err)).toBe(true);
    const out = describeConnectError(err, "IMAP", "imap.gmail.com");
    expect(out.message).not.toMatch(/app password|username or password/i);
    expect(out.message).toContain("no mailbox");
  });

  it("only suggests an app password for providers that need one", () => {
    const bad = { authenticationFailed: true, responseText: "Invalid credentials" };
    expect(describeConnectError(bad, "IMAP", "imap.gmail.com").message).toContain("app password");
    expect(describeConnectError(bad, "IMAP", "mail.corp.example").message).not.toContain("app password");
    expect(describeConnectError(bad, "IMAP", "127.0.0.1").message).toContain("Proton Mail Bridge");
    expect(describeConnectError(bad, "IMAP").message).not.toContain("app password");
  });
});

describe("autoconfig through the service", () => {
  it("returns the Proton Bridge hint", async () => {
    const { service } = await boot();
    expect(await service.autoconfig("me@proton.me")).toMatchObject({ imapHost: "127.0.0.1", imapPort: 1143, smtpPort: 1025, smtpSecure: true, hint: "proton_bridge" });
  });
});

describe("Google client secret storage", () => {
  it("keeps the secret out of settings and events and stores it in the secret store", async () => {
    const { service, secrets, events } = await boot();
    const out = await service.updateSettings({ google: { clientId: "cid", clientSecret: "TOP-SECRET" } });
    expect(out.google).toEqual({ clientId: "cid", clientSecret: SECRET_MASK });
    expect((await service.getSettings()).google.clientSecret).toBe(SECRET_MASK);
    expect(JSON.stringify(events)).not.toContain("TOP-SECRET");
    await new Promise((r) => setTimeout(r, 20));
    expect(await secrets.get(GOOGLE_SECRET_KEY)).toBe("TOP-SECRET");
    // Saving the form again with the mask leaves the secret alone.
    await service.updateSettings({ google: { clientId: "cid2", clientSecret: SECRET_MASK } });
    await new Promise((r) => setTimeout(r, 20));
    expect(await secrets.get(GOOGLE_SECRET_KEY)).toBe("TOP-SECRET");
    await service.updateSettings({ google: { clientSecret: "" } });
    expect((await service.getSettings()).google.clientSecret).toBe("");
  });

  it("migrates a secret an older version kept in settings", async () => {
    const dir = mkdtempSync(join(tmpdir(), "flint-w4db-"));
    const dbPath = join(dir, "flint.db");
    const secrets = memorySecrets();
    const { Store } = await import("../src/store");
    const { openDb } = await import("../src/db/open");
    const store = new Store(openDb(dbPath));
    store.updateSettings({ google: { clientId: "cid", clientSecret: "OLD-SECRET" } });
    store.db.close();
    const { service } = await boot({ dbPath }, secrets);
    expect(await secrets.get(GOOGLE_SECRET_KEY)).toBe("OLD-SECRET");
    expect((await service.getSettings()).google.clientSecret).toBe(SECRET_MASK);
    const raw = openDb(dbPath);
    expect(JSON.stringify(raw.prepare("SELECT value FROM settings").all())).not.toContain("OLD-SECRET");
    raw.close();
  });
});

describe("startup re-categorization", () => {
  it("re-labels existing mail once, when the categorizer version is older", async () => {
    const { Store } = await import("../src/store");
    const { openDb } = await import("../src/db/open");
    const { msg, seedImap } = await import("../src/store/testkit");
    const dbPath = join(mkdtempSync(join(tmpdir(), "flint-w4cat-")), "flint.db");
    const store = new Store(openDb(dbPath));
    const seed = seedImap(store);
    const [row] = store.ingestMessages(seed.account.id, seed.inbox.id, [
      msg({ uid: 1, subject: "Your application status", from: [{ name: "UGA", address: "apply@uga.edu" }], headers: { "x-mailer": "Slate by Technolutions" } }),
    ]);
    store.db.prepare("UPDATE messages SET category = 'people'").run();
    store.db.prepare("UPDATE threads SET category = 'people'").run();
    store.db.close();

    const { service, events } = await boot({ dbPath });
    const [thread] = (await service.listThreads({ view: "inbox" })).items;
    expect(thread!.category).toBe("notifications");
    expect(events.some((e) => e.type === "mail_changed")).toBe(true);
    void row;

    // Second start: nothing to do, a user's manual change is not overwritten.
    await service.stop();
    services.length = 0;
    const raw = openDb(dbPath);
    raw.prepare("UPDATE messages SET category = 'people'").run();
    raw.prepare("UPDATE threads SET category = 'people'").run();
    raw.close();
    const again = await boot({ dbPath });
    expect((await again.service.listThreads({ view: "inbox" })).items[0]!.category).toBe("people");
  });
});
