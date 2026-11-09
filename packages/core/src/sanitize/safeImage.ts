/**
 * Decides whether a remote image looks the same for every recipient, so loading it does not tell the sender
 * which person opened the mail. Used under the "safe" remote images setting for senders the user has not trusted.
 * It is a heuristic: a sender can still hide a per-recipient id in an ordinary-looking file name.
 */

/** Query parameters that name the reader or the send. Any value under these makes the image personal. */
const IDENTITY_PARAMS = new Set([
  "u", "uid", "user", "userid", "user_id", "rid", "recipient", "recipient_id", "sub", "subscriber", "subscriber_id", "sid",
  "e", "em", "email", "mail", "addr", "contact", "contact_id", "cid", "mid", "msgid", "message_id", "eid", "tid", "lid",
  "token", "t", "hash", "h", "key", "k", "jwt", "sig", "signature", "track", "tracking", "trk", "open", "upn", "p", "d", "c", "r",
]);

/** Query parameters image services use for size, format and cache busting. Their values are ignored. */
const LAYOUT_PARAMS = new Set([
  "w", "h", "width", "height", "fit", "crop", "auto", "fm", "format", "q", "quality", "dpr", "v", "ver", "version",
  "size", "s", "resize", "bg", "border", "rect", "fl", "f", "ar", "gravity", "scale", "mode", "rev", "ts", "cb", "cache",
]);

const IMAGE_FILE = /\.(?:png|jpe?g|gif|webp|avif|svg|bmp|ico)$/i;

/** Unbroken runs of letters and digits long enough to be an id or encoded payload. */
function tokenRuns(text: string, minLength: number): string[] {
  return (text.match(/[a-z0-9]+/gi) ?? []).filter((run) => run.length >= minLength && /[a-z]/i.test(run) && /\d/.test(run));
}

/** Image CDNs file content under a hex hash (md5 to sha256), which is the same for every recipient. */
const CONTENT_HASH = /^[0-9a-f]{16,64}$/i;

/** The forms a recipient address takes when a sender embeds it in a URL. */
function addressForms(address: string): string[] {
  const a = address.trim().toLowerCase();
  if (!a.includes("@")) return [];
  const b64 = btoa(String.fromCharCode(...new TextEncoder().encode(a))).replace(/=+$/, "");
  return [a, b64.toLowerCase(), b64.replace(/\+/g, "-").replace(/\//g, "_").toLowerCase()];
}

function decoded(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/** True when the remote https image URL carries nothing that identifies the reader. */
export function isSafeImageUrl(url: string, recipients: readonly string[]): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" || u.username || u.password) return false;
  const whole = decoded(url).toLowerCase();
  if (recipients.some((r) => addressForms(r).some((form) => whole.includes(form)))) return false;
  // Any address at all in the URL (not only the reader's) is almost always a mailing list id.
  if (/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i.test(whole)) return false;

  const segments = u.pathname.split("/").filter(Boolean).map(decoded);
  const endsInImage = IMAGE_FILE.test(segments.at(-1) ?? "");
  for (const [i, segment] of segments.entries()) {
    const isFile = endsInImage && i === segments.length - 1;
    const stem = isFile ? segment.replace(IMAGE_FILE, "") : segment;
    // A file name may carry a content hash; a run longer than a sha1 is an encoded payload.
    if (isFile ? tokenRuns(stem, 41).length > 0 : tokenRuns(stem, 16).some((run) => !endsInImage || !CONTENT_HASH.test(run))) return false;
  }

  for (const [name, value] of u.searchParams) {
    const key = name.toLowerCase();
    if (LAYOUT_PARAMS.has(key)) continue;
    if (IDENTITY_PARAMS.has(key) && value) return false;
    if (value.length >= 12 && /\d/.test(value)) return false;
  }
  return true;
}
