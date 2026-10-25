export const GOOGLE_SCOPE = "https://mail.google.com/";
export const CONSOLE_URL = "https://console.cloud.google.com/";

/** Exact steps for a free Desktop OAuth client. The Gmail API itself does not need to be enabled: Flint talks IMAP. */
export const GOOGLE_STEPS: { title: string; body: string }[] = [
  { title: "Create a project", body: "Open Google Cloud Console and create a new project. Any name works." },
  { title: "Set up the consent screen", body: "Go to APIs and Services, then OAuth consent screen. Choose External, enter an app name and your email address. You do not need to enable the Gmail API, because Flint reads mail over IMAP." },
  { title: "Add the mail scope", body: `Under Data access, add the scope ${GOOGLE_SCOPE}. This is the scope IMAP sign-in requires.` },
  { title: "Publish the app", body: "Set the publishing status to In production. In Testing mode Google expires your sign-in after 7 days. Google may warn that the app is unverified; that is expected for an app only you use. Choose Advanced, then continue." },
  { title: "Create the OAuth client", body: "Go to Credentials, then Create credentials, then OAuth client ID. Set the application type to Desktop app." },
  { title: "Paste the two values", body: "Copy the Client ID and Client secret into the fields below." },
];

export type ClientCheck = { ok: true; clientId: string; clientSecret: string } | { ok: false; errors: { clientId?: string; clientSecret?: string } };

export function checkClient(clientId: string, clientSecret: string): ClientCheck {
  const id = clientId.trim();
  const secret = clientSecret.trim();
  const errors: { clientId?: string; clientSecret?: string } = {};
  if (!/^[\w-]+(\.[\w-]+)*\.apps\.googleusercontent\.com$/.test(id)) errors.clientId = "A Client ID ends in .apps.googleusercontent.com.";
  if (secret === "") errors.clientSecret = "Enter the Client secret.";
  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, clientId: id, clientSecret: secret };
}
