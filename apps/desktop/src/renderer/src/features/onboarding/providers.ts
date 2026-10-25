import type { Provider, ServerConfig } from "@flint/core";

export type ProviderId = "gmail-app" | "icloud" | "outlook" | "yahoo" | "fastmail" | "proton-bridge" | "other";

export type ProviderPreset = {
  id: ProviderId;
  label: string;
  provider: Provider;
  /** Known servers. Null means detect them from the address. */
  servers: ((email: string) => ServerConfig) | null;
  /** What the user needs to know before the password field makes sense. */
  passwordHint: string;
  helpUrl?: string;
  helpLabel?: string;
};

const cfg = (email: string, imapHost: string, smtpHost: string, smtpPort: number, smtpSecure: boolean): ServerConfig => ({
  imapHost, imapPort: 993, imapSecure: true, smtpHost, smtpPort, smtpSecure, username: email,
});

/** Shown wherever Flint points at Proton Mail Bridge. */
export const PROTON_BRIDGE_HINT = "Use the password from Proton Mail Bridge, not your Proton password. Bridge has to be running on this computer.";

export const PROVIDERS: ProviderPreset[] = [
  {
    id: "gmail-app", label: "Gmail with an app password", provider: "gmail",
    servers: (e) => cfg(e, "imap.gmail.com", "smtp.gmail.com", 465, true),
    passwordHint: "Use a 16-character app password, not your Google password. Google only offers app passwords when 2-Step Verification is on.",
    helpUrl: "https://myaccount.google.com/apppasswords", helpLabel: "Create an app password",
  },
  {
    id: "icloud", label: "iCloud", provider: "imap",
    servers: (e) => cfg(e, "imap.mail.me.com", "smtp.mail.me.com", 587, false),
    passwordHint: "Use an app-specific password from your Apple Account, not your Apple Account password.",
    helpUrl: "https://account.apple.com/account/manage", helpLabel: "Open Apple Account",
  },
  {
    id: "outlook", label: "Outlook", provider: "imap",
    servers: (e) => cfg(e, "outlook.office365.com", "smtp.office365.com", 587, false),
    passwordHint: "Use your password, or an app password if your account has two-step verification on. Some work and school accounts block password sign-in.",
  },
  {
    id: "yahoo", label: "Yahoo", provider: "imap",
    servers: (e) => cfg(e, "imap.mail.yahoo.com", "smtp.mail.yahoo.com", 465, true),
    passwordHint: "Use an app password. Create one in Yahoo Account Security.",
    helpUrl: "https://login.yahoo.com/account/security", helpLabel: "Open Yahoo Account Security",
  },
  {
    id: "fastmail", label: "Fastmail", provider: "imap",
    servers: (e) => cfg(e, "imap.fastmail.com", "smtp.fastmail.com", 465, true),
    passwordHint: "Use an app password with mail access. Create one in Fastmail under Privacy and Security.",
  },
  {
    id: "proton-bridge", label: "Proton Mail (Bridge)", provider: "imap",
    // Proton Bridge listens on this computer: IMAP 1143 with STARTTLS, SMTP 1025 with SSL.
    servers: (e) => ({ imapHost: "127.0.0.1", imapPort: 1143, imapSecure: false, smtpHost: "127.0.0.1", smtpPort: 1025, smtpSecure: true, username: e }),
    passwordHint: PROTON_BRIDGE_HINT,
  },
  {
    id: "other", label: "Other (IMAP)", provider: "imap", servers: null,
    passwordHint: "The password for this mailbox. Flint looks up the servers from your address.",
  },
];

export function presetById(id: ProviderId): ProviderPreset {
  return PROVIDERS.find((p) => p.id === id) ?? PROVIDERS[PROVIDERS.length - 1]!;
}
