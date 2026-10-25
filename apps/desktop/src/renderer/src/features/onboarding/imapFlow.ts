import type { AddAccountInput, Provider, ServerConfig } from "@flint/core";

export type ImapFormState = { email: string; name: string; password: string; server: ServerConfig | null };

export type FormErrors = Partial<Record<"email" | "name" | "password" | "server", string>>;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const EMPTY_SERVER: ServerConfig = { imapHost: "", imapPort: 993, imapSecure: true, smtpHost: "", smtpPort: 587, smtpSecure: false, username: "" };

export function validateForm(f: ImapFormState): FormErrors {
  const errors: FormErrors = {};
  if (!EMAIL.test(f.email.trim())) errors.email = "Enter a full email address.";
  if (f.name.trim() === "") errors.name = "Enter the name people see on your mail.";
  if (f.password === "") errors.password = "Enter the password.";
  const s = f.server;
  if (!s || s.imapHost.trim() === "" || s.smtpHost.trim() === "") errors.server = "Enter the IMAP and SMTP server names.";
  else if (![s.imapPort, s.smtpPort].every((p) => Number.isInteger(p) && p > 0 && p < 65536)) errors.server = "Ports are numbers between 1 and 65535.";
  return errors;
}

export function toInput(f: ImapFormState, provider: Provider): AddAccountInput {
  return { email: f.email.trim(), name: f.name.trim(), password: f.password, provider, ...(f.server ? { server: { ...f.server, username: f.server.username.trim() || f.email.trim() } } : {}) };
}

export function describeServer(s: ServerConfig): string {
  const mode = (secure: boolean) => (secure ? "SSL" : "STARTTLS");
  return `IMAP ${s.imapHost}:${s.imapPort} ${mode(s.imapSecure)} · SMTP ${s.smtpHost}:${s.smtpPort} ${mode(s.smtpSecure)}`;
}

/** Turns a testConnection result into one message per failing server, or null when both work. */
export function connectionProblems(result: { imap: string; smtp: string }, s: ServerConfig | null): string[] {
  const out: string[] = [];
  if (result.imap !== "ok") out.push(`Incoming mail (IMAP${s ? ` ${s.imapHost}` : ""}): ${tidy(result.imap)}`);
  if (result.smtp !== "ok") out.push(`Outgoing mail (SMTP${s ? ` ${s.smtpHost}` : ""}): ${tidy(result.smtp)}`);
  return out;
}

function tidy(msg: string): string {
  const m = msg.trim();
  return m.endsWith(".") ? m : `${m}.`;
}
