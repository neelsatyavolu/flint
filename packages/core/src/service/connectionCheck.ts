import { createTransport } from "nodemailer";
import { createImapClient, describeConnectError, smtpOptions, type MailAuth } from "../mail/connect";
import type { ServerConfig } from "../types";


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
    imap = describeConnectError(error, "IMAP").message;
  }
  let smtp: ConnectionResult["smtp"] = "ok";
  const transport = createTransport(smtpOptions(server, auth));
  try {
    await transport.verify();
  } catch (error) {
    smtp = describeConnectError(error, "SMTP").message;
  } finally {
    transport.close();
  }
  return { imap, smtp };
}

