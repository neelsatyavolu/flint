import { resolveMx } from "node:dns/promises";
import { connect } from "node:net";
import { FlintError, type Provider, type ServerConfig } from "../types";

export type AutoconfigSource = "known" | "ispdb" | "mx" | "guess";

export type Autoconfig = ServerConfig & {
  provider: Provider;
  source: AutoconfigSource;
  /** Google sign-in (XOAUTH2) is available for this address. */
  oauthGoogle: boolean;
};

export type AutoconfigDeps = {
  fetch?: (url: string, init?: { signal?: AbortSignal }) => Promise<{ ok: boolean; text(): Promise<string> }>;
  resolveMx?: (domain: string) => Promise<{ exchange: string; priority: number }[]>;
  /** Resolves true when something accepts TCP connections on host:port. Used to choose between guesses. */
  probe?: (host: string, port: number) => Promise<boolean>;
  timeoutMs?: number;
};

type Known = Omit<Autoconfig, "username" | "source">;
const server = (imapHost: string, imapPort: number, imapSecure: boolean, smtpHost: string, smtpPort: number, smtpSecure: boolean, provider: Provider = "imap", oauthGoogle = false): Known =>
  ({ imapHost, imapPort, imapSecure, smtpHost, smtpPort, smtpSecure, provider, oauthGoogle });

const GMAIL = server("imap.gmail.com", 993, true, "smtp.gmail.com", 465, true, "gmail", true);
const OUTLOOK = server("outlook.office365.com", 993, true, "smtp.office365.com", 587, false);
const YAHOO = server("imap.mail.yahoo.com", 993, true, "smtp.mail.yahoo.com", 465, true);
const ICLOUD = server("imap.mail.me.com", 993, true, "smtp.mail.me.com", 587, false);
const FASTMAIL = server("imap.fastmail.com", 993, true, "smtp.fastmail.com", 465, true);
const ZOHO = server("imap.zoho.com", 993, true, "smtp.zoho.com", 465, true);
const PROTON = server("127.0.0.1", 1143, false, "127.0.0.1", 1025, false);
const AOL = server("imap.aol.com", 993, true, "smtp.aol.com", 465, true);

export const KNOWN_PROVIDERS: Readonly<Record<string, Known>> = {
  "gmail.com": GMAIL, "googlemail.com": GMAIL,
  "outlook.com": OUTLOOK, "hotmail.com": OUTLOOK, "live.com": OUTLOOK, "msn.com": OUTLOOK, "outlook.co.uk": OUTLOOK, "hotmail.co.uk": OUTLOOK,
  "yahoo.com": YAHOO, "ymail.com": YAHOO, "yahoo.co.uk": YAHOO,
  "icloud.com": ICLOUD, "me.com": ICLOUD, "mac.com": ICLOUD,
  "fastmail.com": FASTMAIL, "fastmail.fm": FASTMAIL, "messagingengine.com": FASTMAIL,
  "zoho.com": ZOHO, "zohomail.com": ZOHO,
  "proton.me": PROTON, "protonmail.com": PROTON, "pm.me": PROTON, "protonmail.ch": PROTON,
  "aol.com": AOL,
};

export function domainOf(email: string): string {
  const at = email.lastIndexOf("@");
  if (at < 1 || at === email.length - 1) throw new FlintError("invalid", "Enter a full email address.");
  return email.slice(at + 1).trim().toLowerCase();
}

const tag = (xml: string, name: string): string | null => new RegExp(`<${name}>\\s*([^<]*?)\\s*</${name}>`, "i").exec(xml)?.[1] ?? null;

function expandUsername(template: string | null, email: string): string {
  if (!template) return email;
  const [local = "", domain = ""] = email.split("@");
  return template.replace(/%EMAILADDRESS%/gi, email).replace(/%EMAILLOCALPART%/gi, local).replace(/%EMAILDOMAIN%/gi, domain);
}

/** Parses a Mozilla ISPDB / autoconfig XML document. Returns null when it has no usable IMAP and SMTP server. */
export function parseIspdb(xml: string, email: string): Known & { username: string } | null {
  const pick = (type: "imap" | "smtp") => {
    const blocks = [...xml.matchAll(new RegExp(`<${type === "imap" ? "incomingServer" : "outgoingServer"}\\b[^>]*type="${type}"[^>]*>([\\s\\S]*?)</${type === "imap" ? "incomingServer" : "outgoingServer"}>`, "gi"))];
    const candidates = blocks.map((b) => {
      const body = b[1] ?? "";
      const host = tag(body, "hostname");
      const port = Number(tag(body, "port"));
      const socket = (tag(body, "socketType") ?? "").toUpperCase();
      return host && port ? { host, port, secure: socket === "SSL", socket, username: expandUsername(tag(body, "username"), email) } : null;
    }).filter((c): c is NonNullable<typeof c> => c !== null);
    return candidates.find((c) => c.socket === "SSL") ?? candidates.find((c) => c.socket === "STARTTLS") ?? candidates[0] ?? null;
  };
  const imap = pick("imap");
  const smtp = pick("smtp");
  if (!imap || !smtp) return null;
  return {
    imapHost: imap.host, imapPort: imap.port, imapSecure: imap.secure,
    smtpHost: smtp.host, smtpPort: smtp.port, smtpSecure: smtp.secure,
    provider: "imap", oauthGoogle: false, username: imap.username,
  };
}

const tcpProbe = (host: string, port: number): Promise<boolean> =>
  new Promise((resolve) => {
    const socket = connect({ host, port, timeout: 3000 });
    socket.once("connect", () => { socket.destroy(); resolve(true); });
    socket.once("error", () => resolve(false));
    socket.once("timeout", () => { socket.destroy(); resolve(false); });
  });

async function fetchIspdb(domain: string, email: string, deps: AutoconfigDeps): Promise<Known & { username: string } | null> {
  const f = deps.fetch ?? ((url, init) => fetch(url, init));
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), deps.timeoutMs ?? 5000);
  try {
    const res = await f(`https://autoconfig.thunderbird.net/v1.1/${encodeURIComponent(domain)}`, { signal: ctl.signal });
    return res.ok ? parseIspdb(await res.text(), email) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function detectByMx(domain: string, deps: AutoconfigDeps): Promise<Known | null> {
  try {
    const records = await (deps.resolveMx ?? resolveMx)(domain);
    const hosts = records.map((r) => r.exchange.toLowerCase());
    if (hosts.some((h) => /(^|\.)(google\.com|googlemail\.com)\.?$/.test(h))) return GMAIL;
    if (hosts.some((h) => /(^|\.)(outlook\.com|protection\.outlook\.com|office365\.us)\.?$/.test(h))) return OUTLOOK;
    if (hosts.some((h) => /(^|\.)(messagingengine\.com)\.?$/.test(h))) return FASTMAIL;
    if (hosts.some((h) => /(^|\.)(zoho\.com|zoho\.eu)\.?$/.test(h))) return ZOHO;
  } catch {
    // No MX record or DNS failure: fall through to guesses.
  }
  return null;
}

/** Server settings for an address: known table, then ISPDB, then MX, then guessed host names. */
export async function autoconfig(email: string, deps: AutoconfigDeps = {}): Promise<Autoconfig> {
  const address = email.trim().toLowerCase();
  const domain = domainOf(address);
  const known = KNOWN_PROVIDERS[domain];
  if (known) return { ...known, username: address, source: "known" };

  const ispdb = await fetchIspdb(domain, address, deps);
  if (ispdb) return { ...ispdb, source: "ispdb" };

  const mx = await detectByMx(domain, deps);
  if (mx) return { ...mx, username: address, source: "mx" };

  const probe = deps.probe ?? tcpProbe;
  const imapCandidates = [`imap.${domain}`, `mail.${domain}`];
  const smtpCandidates: [string, number, boolean][] = [[`smtp.${domain}`, 465, true], [`smtp.${domain}`, 587, false], [`mail.${domain}`, 465, true], [`mail.${domain}`, 587, false]];
  let imapHost = imapCandidates[0]!;
  for (const h of imapCandidates) if (await probe(h, 993)) { imapHost = h; break; }
  let smtp = smtpCandidates[0]!;
  for (const c of smtpCandidates) if (await probe(c[0], c[1])) { smtp = c; break; }
  return {
    imapHost, imapPort: 993, imapSecure: true, smtpHost: smtp[0], smtpPort: smtp[1], smtpSecure: smtp[2],
    username: address, provider: "imap", oauthGoogle: false, source: "guess",
  };
}
