import { createTransport } from "nodemailer";
import { MX_HOST_NAMES, mxHostOf } from "../mail/autoconfig";
import { createImapClient, describeConnectError, isLookupFailure, smtpOptions, type MailAuth } from "../mail/connect";
import { FlintError, type ServerConfig } from "../types";


export type ConnectionResult = { imap: "ok" | string; smtp: "ok" | string };

/** Checks IMAP and SMTP separately so the form can point at the server that failed. */
export async function checkConnection(server: ServerConfig, auth: MailAuth): Promise<ConnectionResult> {
  let imap: ConnectionResult["imap"] = "ok";
  const client = createImapClient(server, auth);
  client.on("error", () => undefined);
  try {
    await client.connect();
    await client.logout();
  } catch (error) {
    client.close();
    imap = describeConnectError(error, "IMAP", server.imapHost).message;
  }
  let smtp: ConnectionResult["smtp"] = "ok";
  const transport = createTransport(smtpOptions(server, auth));
  try {
    await transport.verify();
  } catch (error) {
    smtp = describeConnectError(error, "SMTP", server.smtpHost).message;
  } finally {
    transport.close();
  }
  return { imap, smtp };
}


/** Who hosts this address's mail, for the "no Gmail inbox" message. Never names Google itself. */
export async function mailHostName(email: string, resolveMx?: (domain: string) => Promise<{ exchange: string; priority: number }[]>): Promise<string> {
  const host = await mxHostOf(email.slice(email.lastIndexOf("@") + 1).toLowerCase(), resolveMx ? { resolveMx } : {});
  return host && host !== "google" ? MX_HOST_NAMES[host] : "another provider";
}

/**
 * Logs in to Gmail IMAP with a fresh Google token. Google answers "Lookup failed" when the account has no Gmail
 * mailbox (its mail is hosted elsewhere); that becomes a clear FlintError instead of a password complaint.
 */
export async function checkGoogleMailbox(server: ServerConfig, email: string, accessToken: string, resolveMx?: Parameters<typeof mailHostName>[1]): Promise<void> {
  const client = createImapClient(server, { user: email, accessToken });
  client.on("error", () => undefined);
  try {
    await client.connect();
    await client.logout();
  } catch (error) {
    client.close();
    if (isLookupFailure(error)) {
      throw new FlintError("invalid", `This Google account doesn't have a Gmail inbox. Its mail is handled by ${await mailHostName(email, resolveMx)}.`);
    }
    throw describeConnectError(error, "IMAP");
  }
}
