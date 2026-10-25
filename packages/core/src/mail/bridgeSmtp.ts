import { createTransport, type Transporter } from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport";
import { logger } from "../log";
import type { ServerConfig } from "../types";
import { isLoopback, smtpOptions, type MailAuth } from "./connect";

const log = logger("mail.bridge");

type SmtpServer = Pick<ServerConfig, "smtpHost" | "smtpPort" | "smtpSecure">;
type Factory = (options: SMTPTransport.Options) => Transporter<SMTPTransport.SentMessageInfo>;

/** A TLS failure at connect time, such as implicit SSL aimed at a port that speaks plain SMTP and offers STARTTLS. */
export function isTlsHandshakeError(error: unknown): boolean {
  const e = error as { code?: string; message?: string; library?: string; reason?: string };
  const text = `${e?.code ?? ""} ${e?.message ?? ""} ${e?.library ?? ""} ${e?.reason ?? ""}`;
  return /wrong version number|ERR_SSL|SSL routines|handshake|EPROTO/i.test(text);
}

export type BridgeSmtp = { transport: Transporter<SMTPTransport.SentMessageInfo>; smtpSecure: boolean };

/**
 * SMTP transport for an account. Proton Mail Bridge answers on loopback with STARTTLS by default, but accounts can be
 * set up with implicit SSL. When implicit SSL on loopback fails with a TLS handshake error, this retries with STARTTLS
 * and reports the working mode (smtpSecure false) so the caller can save it. Other servers are returned untouched
 * and unverified.
 */
export async function openSmtp(server: SmtpServer, auth: MailAuth, create: Factory = createTransport): Promise<BridgeSmtp> {
  const primary = create(smtpOptions(server, auth));
  if (!server.smtpSecure || !isLoopback(server.smtpHost)) return { transport: primary, smtpSecure: server.smtpSecure };
  try {
    await primary.verify();
    return { transport: primary, smtpSecure: true };
  } catch (error) {
    primary.close();
    if (!isTlsHandshakeError(error)) throw error;
    log.info("implicit SSL failed on loopback; trying STARTTLS", { port: server.smtpPort });
    const fallback = create(smtpOptions({ ...server, smtpSecure: false }, auth));
    try {
      await fallback.verify();
    } catch (second) {
      fallback.close();
      throw second;
    }
    return { transport: fallback, smtpSecure: false };
  }
}
