import { ImapFlow, type ImapFlowOptions } from "imapflow";
import { createTransport } from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport";
import { z } from "zod";
import type { SecretStore } from "../platform";
import { FlintError, type Account, type ServerConfig } from "../types";
import { refreshGoogleToken, REFRESH_MARGIN_MS, type FetchLike } from "./google-oauth";
import { logger } from "../log";

const log = logger("mail.connect");

export const secretSchema = z.union([
  z.object({ password: z.string() }),
  z.object({ accessToken: z.string(), refreshToken: z.string(), expiresAt: z.number(), /** Granted scopes; absent on secrets written before calendar support. */ scope: z.string().optional() }),
]);
export type AccountSecret = z.infer<typeof secretSchema>;

/** What the IMAP and SMTP clients log in with. */
export type MailAuth = { user: string; pass: string } | { user: string; accessToken: string };

export type GoogleClient = { clientId: string; clientSecret: string };

export type AuthDeps = {
  secrets: SecretStore;
  google?: () => GoogleClient;
  fetch?: FetchLike;
  now?: () => number;
};

export const secretKey = (accountId: string): string => `account:${accountId}`;

export async function readSecret(secrets: SecretStore, accountId: string): Promise<AccountSecret> {
  const raw = await secrets.get(secretKey(accountId));
  if (!raw) throw new FlintError("auth", "No saved sign-in for this account. Sign in again.");
  try {
    return secretSchema.parse(JSON.parse(raw));
  } catch {
    throw new FlintError("auth", "The saved sign-in for this account is unreadable. Sign in again.");
  }
}

/**
 * Credentials for an account. OAuth access tokens are refreshed when they expire within 5 minutes
 * and the new token is written back to the secret store.
 */
export async function resolveAuth(account: Account, deps: AuthDeps): Promise<MailAuth> {
  const secret = await readSecret(deps.secrets, account.id);
  if ("password" in secret) return { user: account.username, pass: secret.password };
  const now = (deps.now ?? Date.now)();
  if (secret.expiresAt - now > REFRESH_MARGIN_MS) return { user: account.username, accessToken: secret.accessToken };
  const google = deps.google?.();
  if (!google?.clientId || !google.clientSecret) throw new FlintError("auth", "Add a Google client ID and secret in Settings, then sign in again.");
  const next = await refreshGoogleToken({ ...google, refreshToken: secret.refreshToken, fetch: deps.fetch, now: deps.now });
  await deps.secrets.set(secretKey(account.id), JSON.stringify(secret.scope ? { ...next, scope: secret.scope } : next));
  return { user: account.username, accessToken: next.accessToken };
}

export const isLoopback = (host: string): boolean => host === "127.0.0.1" || host === "localhost" || host === "::1";

/** Proton Mail Bridge's default ports. Bridge always offers STARTTLS on IMAP, so a plain connection there must upgrade. */
const BRIDGE_IMAP_PORT = 1143;
const BRIDGE_SMTP_PORT = 1025;

export function imapOptions(server: Pick<ServerConfig, "imapHost" | "imapPort" | "imapSecure">, auth: MailAuth): ImapFlowOptions {
  return {
    host: server.imapHost,
    port: server.imapPort,
    secure: server.imapSecure,
    auth: "accessToken" in auth ? { user: auth.user, accessToken: auth.accessToken } : { user: auth.user, pass: auth.pass },
    logger: false,
    disableBinary: true,
    connectionTimeout: 20_000,
    greetingTimeout: 15_000,
    // Remote plain connections must upgrade with STARTTLS or fail, so a network attacker cannot strip it and read the
    // password. Loopback hosts skip certificate checks (Bridge's certificate is self-signed). On Proton Bridge's port the
    // upgrade is required too; any other loopback server (local test servers) upgrades when it advertises STARTTLS and
    // otherwise stays plain.
    ...(isLoopback(server.imapHost)
      ? { tls: { rejectUnauthorized: false }, ...(!server.imapSecure && server.imapPort === BRIDGE_IMAP_PORT ? { doSTARTTLS: true } : {}) }
      : server.imapSecure ? {} : { doSTARTTLS: true }),
  };
}

export function smtpOptions(server: Pick<ServerConfig, "smtpHost" | "smtpPort" | "smtpSecure">, auth: MailAuth): SMTPTransport.Options {
  return {
    host: server.smtpHost,
    port: server.smtpPort,
    secure: server.smtpSecure,
    auth: "accessToken" in auth ? { type: "OAuth2", user: auth.user, accessToken: auth.accessToken } : { user: auth.user, pass: auth.pass },
    connectionTimeout: 20_000,
    greetingTimeout: 15_000,
    socketTimeout: 60_000,
    ...(isLoopback(server.smtpHost)
      ? { tls: { rejectUnauthorized: false }, ...(!server.smtpSecure && server.smtpPort === BRIDGE_SMTP_PORT ? { requireTLS: true } : {}) }
      : server.smtpSecure ? {} : { requireTLS: true }),
  };
}

export function createImapClient(server: ServerConfig, auth: MailAuth): ImapFlow {
  return new ImapFlow(imapOptions(server, auth));
}

/** True for the IMAP answer that means the account has no mailbox on this server, as opposed to bad credentials. */
export function isLookupFailure(error: unknown): boolean {
  const e = error as { responseText?: string; message?: string };
  return /lookup failed/i.test(`${e?.responseText ?? ""} ${e?.message ?? ""}`);
}

const APP_PASSWORD_HOSTS = /(^|\.)(gmail\.com|googlemail\.com|google\.com|me\.com|icloud\.com|yahoo\.com|aol\.com|office365\.com|outlook\.com)$/i;

function passwordAdvice(host: string | undefined): string {
  if (!host) return "";
  if (isLoopback(host)) return " Use the password from Proton Mail Bridge, not your account password.";
  return APP_PASSWORD_HOSTS.test(host) ? " This provider needs an app password." : "";
}

/** Short, user-facing text for a connection failure. Never includes credentials. */
export function describeConnectError(error: unknown, what: "IMAP" | "SMTP", host?: string): FlintError {
  if (error instanceof FlintError) return error;
  const e = error as { code?: string; authenticationFailed?: boolean; responseText?: string; message?: string; serverResponseCode?: string; responseCode?: number };
  const code = e.code ?? "";
  const text = e.responseText ?? e.message ?? "";
  // Server responses (e.g. Gmail's "[AUTHENTICATIONFAILED] Invalid credentials") carry no secrets and explain failures.
  log.warn("connection failed", { what, code, response: (e.responseText ?? e.message ?? "").slice(0, 300) });
  // Temporary refusals arrive as login failures too; they must not look like a wrong password.
  const transient = /^(UNAVAILABLE|OVERQUOTA|INUSE|LIMIT)$/i.test(e.serverResponseCode ?? "")
    || /too many (simultaneous )?connections|temporar|try again|unavailable|overquota|rate limit/i.test(text)
    || (typeof e.responseCode === "number" && e.responseCode >= 400 && e.responseCode < 500);
  if (transient) return new FlintError("network", `The ${what} server is busy or temporarily unavailable. Flint will try again.`);
  // Gmail answers "Lookup failed" when the Google account has no Gmail mailbox. That is not a wrong password.
  if (isLookupFailure(error)) return new FlintError("auth", `The ${what} server has no mailbox for this account.`);
  if (e.authenticationFailed || /AUTH/i.test(code) || /auth|credentials|login/i.test(e.responseText ?? e.message ?? "")) {
    return new FlintError("auth", `The server rejected the username or password.${passwordAdvice(host)}`);
  }
  if (["ENOTFOUND", "EAI_AGAIN"].includes(code)) return new FlintError("network", `Could not find the ${what} server. Check the host name.`);
  if (["ECONNREFUSED", "ETIMEDOUT", "CONNECT_TIMEOUT", "ECONNRESET", "ESOCKET", "EDNS"].includes(code) || /timeout|timed out/i.test(e.message ?? "")) {
    return new FlintError("network", `Could not connect to the ${what} server. Check the host, port and encryption setting.`);
  }
  if (/certificate|self.signed|CERT_|SSL|TLS/i.test(code + (e.message ?? ""))) {
    return new FlintError("network", `The ${what} server's security certificate was not accepted.`);
  }
  return new FlintError("network", `${what} connection failed.`);
}

export type TestConnectionResult = { imap: true; smtp: true; imapCapabilities: string[] };

/** Logs in over IMAP and verifies SMTP. Throws a FlintError with a message fit for the add-account form. */
export async function testConnection(server: ServerConfig, auth: MailAuth): Promise<TestConnectionResult> {
  const client = createImapClient(server, auth);
  client.on("error", () => undefined);
  let imapCapabilities: string[] = [];
  try {
    await client.connect();
    imapCapabilities = [...client.capabilities.keys()];
    await client.logout();
  } catch (error) {
    client.close();
    throw describeConnectError(error, "IMAP");
  }
  const transport = createTransport(smtpOptions(server, auth));
  try {
    await transport.verify();
  } catch (error) {
    throw describeConnectError(error, "SMTP");
  } finally {
    transport.close();
  }
  return { imap: true, smtp: true, imapCapabilities };
}
