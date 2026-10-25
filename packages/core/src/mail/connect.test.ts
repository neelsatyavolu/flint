import { describe, expect, it } from "vitest";
import { memorySecrets } from "../platform";
import type { Account } from "../types";
import { describeConnectError, imapOptions, readSecret, resolveAuth, smtpOptions } from "./connect";
import type { FetchLike } from "./google-oauth";

const account = { id: "acc1", username: "me@gmail.com" } as Account;
const server = { imapHost: "imap.example.org", imapPort: 993, imapSecure: true, smtpHost: "smtp.example.org", smtpPort: 465, smtpSecure: true };

describe("resolveAuth", () => {
  it("returns a stored password", async () => {
    const secrets = memorySecrets({ "account:acc1": JSON.stringify({ password: "pw" }) });
    expect(await resolveAuth(account, { secrets })).toEqual({ user: "me@gmail.com", pass: "pw" });
  });

  it("uses a token that is not about to expire without calling Google", async () => {
    const secrets = memorySecrets({ "account:acc1": JSON.stringify({ accessToken: "AT", refreshToken: "RT", expiresAt: 10_000_000 }) });
    const fetch: FetchLike = async () => { throw new Error("must not refresh"); };
    expect(await resolveAuth(account, { secrets, fetch, now: () => 1_000_000 })).toEqual({ user: "me@gmail.com", accessToken: "AT" });
  });

  it("refreshes five minutes before expiry and stores the new token", async () => {
    const secrets = memorySecrets({ "account:acc1": JSON.stringify({ accessToken: "OLD", refreshToken: "RT", expiresAt: 1_000_000 + 4 * 60_000 }) });
    const fetch: FetchLike = async () => ({ ok: true, status: 200, json: async () => ({ access_token: "FRESH", expires_in: 3600 }) });
    const auth = await resolveAuth(account, { secrets, fetch, now: () => 1_000_000, google: () => ({ clientId: "c", clientSecret: "s" }) });
    expect(auth).toEqual({ user: "me@gmail.com", accessToken: "FRESH" });
    expect(JSON.parse((await secrets.get("account:acc1"))!)).toEqual({ accessToken: "FRESH", refreshToken: "RT", expiresAt: 1_000_000 + 3_600_000 });
  });

  it("needs the Google client to refresh", async () => {
    const secrets = memorySecrets({ "account:acc1": JSON.stringify({ accessToken: "OLD", refreshToken: "RT", expiresAt: 0 }) });
    await expect(resolveAuth(account, { secrets, now: () => 1 })).rejects.toMatchObject({ code: "auth" });
  });

  it("propagates a refresh failure as an auth error", async () => {
    const secrets = memorySecrets({ "account:acc1": JSON.stringify({ accessToken: "OLD", refreshToken: "RT", expiresAt: 0 }) });
    const fetch: FetchLike = async () => ({ ok: false, status: 400, json: async () => ({ error: "invalid_grant" }) });
    await expect(resolveAuth(account, { secrets, fetch, now: () => 1, google: () => ({ clientId: "c", clientSecret: "s" }) })).rejects.toMatchObject({ code: "auth" });
  });

  it("reports missing and unreadable secrets", async () => {
    await expect(readSecret(memorySecrets(), "acc1")).rejects.toMatchObject({ code: "auth" });
    await expect(readSecret(memorySecrets({ "account:acc1": "{not json" }), "acc1")).rejects.toMatchObject({ code: "auth", message: expect.stringContaining("unreadable") });
    await expect(readSecret(memorySecrets({ "account:acc1": JSON.stringify({ other: 1 }) }), "acc1")).rejects.toMatchObject({ code: "auth" });
  });
});

describe("client options", () => {
  it("builds IMAP options for passwords and XOAUTH2", () => {
    expect(imapOptions(server, { user: "u", pass: "p" })).toMatchObject({ host: "imap.example.org", port: 993, secure: true, auth: { user: "u", pass: "p" }, logger: false });
    expect(imapOptions(server, { user: "u", accessToken: "t" }).auth).toEqual({ user: "u", accessToken: "t" });
  });

  it("builds SMTP options for passwords and OAuth2", () => {
    expect(smtpOptions(server, { user: "u", pass: "p" })).toMatchObject({ host: "smtp.example.org", port: 465, secure: true, auth: { user: "u", pass: "p" } });
    expect(smtpOptions(server, { user: "u", accessToken: "t" }).auth).toEqual({ type: "OAuth2", user: "u", accessToken: "t" });
  });

  it("accepts self-signed certificates only for loopback hosts", () => {
    expect(imapOptions(server, { user: "u", pass: "p" }).tls).toBeUndefined();
    expect(imapOptions({ ...server, imapHost: "127.0.0.1" }, { user: "u", pass: "p" }).tls).toEqual({ rejectUnauthorized: false });
    expect(smtpOptions({ ...server, smtpHost: "localhost" }, { user: "u", pass: "p" }).tls).toEqual({ rejectUnauthorized: false });
  });
});

describe("STARTTLS", () => {
  const plain = { imapHost: "imap.example.org", imapPort: 143, imapSecure: false, smtpHost: "smtp.example.org", smtpPort: 587, smtpSecure: false };
  it("fails closed on remote plain ports", () => {
    expect(imapOptions(plain, { user: "u", pass: "p" })).toMatchObject({ doSTARTTLS: true });
    expect(smtpOptions(plain, { user: "u", pass: "p" })).toMatchObject({ requireTLS: true });
  });
  it("leaves implicit TLS and loopback alone", () => {
    expect(imapOptions(server, { user: "u", pass: "p" }).doSTARTTLS).toBeUndefined();
    expect(imapOptions({ ...plain, imapHost: "127.0.0.1" }, { user: "u", pass: "p" }).doSTARTTLS).toBeUndefined();
    expect(smtpOptions({ ...plain, smtpHost: "localhost" }, { user: "u", pass: "p" }).requireTLS).toBeUndefined();
  });
});

describe("transient failures", () => {
  it("does not call a temporary Gmail refusal an auth error", () => {
    expect(describeConnectError({ authenticationFailed: true, serverResponseCode: "UNAVAILABLE", responseText: "Temporary System Error" }, "IMAP")).toMatchObject({ code: "network" });
    expect(describeConnectError({ authenticationFailed: true, responseText: "[ALERT] Too many simultaneous connections. (Failure)" }, "IMAP")).toMatchObject({ code: "network" });
    expect(describeConnectError({ code: "EAUTH", responseCode: 454, message: "Temporary authentication failure" }, "SMTP")).toMatchObject({ code: "network" });
    expect(describeConnectError({ authenticationFailed: true, serverResponseCode: "AUTHENTICATIONFAILED", responseText: "Invalid credentials" }, "IMAP")).toMatchObject({ code: "auth" });
  });
  it("treats a Google 503 or 429 on refresh as a network error", async () => {
    const secrets = memorySecrets({ "account:acc1": JSON.stringify({ accessToken: "OLD", refreshToken: "RT", expiresAt: 0 }) });
    for (const status of [503, 429]) {
      const fetch: FetchLike = async () => ({ ok: false, status, json: async () => ({}) });
      await expect(resolveAuth(account, { secrets, fetch, now: () => 1, google: () => ({ clientId: "c", clientSecret: "s" }) })).rejects.toMatchObject({ code: "network" });
    }
  });
});

describe("describeConnectError", () => {
  it("turns low-level errors into plain messages", () => {
    expect(describeConnectError({ authenticationFailed: true }, "IMAP")).toMatchObject({ code: "auth" });
    expect(describeConnectError({ code: "EAUTH", message: "Invalid login" }, "SMTP")).toMatchObject({ code: "auth" });
    expect(describeConnectError({ code: "ENOTFOUND" }, "IMAP")).toMatchObject({ code: "network", message: expect.stringContaining("host name") });
    expect(describeConnectError({ code: "ECONNREFUSED" }, "SMTP")).toMatchObject({ code: "network", message: expect.stringContaining("SMTP") });
    expect(describeConnectError({ code: "ETIMEDOUT" }, "IMAP")).toMatchObject({ code: "network" });
    expect(describeConnectError({ code: "DEPTH_ZERO_SELF_SIGNED_CERT", message: "self signed certificate" }, "IMAP")).toMatchObject({ message: expect.stringContaining("certificate") });
    expect(describeConnectError(new Error("weird"), "IMAP")).toMatchObject({ code: "network", message: "IMAP connection failed." });
    const flint = describeConnectError({ code: "ECONNRESET" }, "IMAP");
    expect(describeConnectError(flint, "IMAP")).toBe(flint);
  });
});
