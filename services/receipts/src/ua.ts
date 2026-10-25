import { MAIL_APP_UAS, OUTLOOK_UA_RE } from "./signatures";

export function deviceFromUa(ua: string): string | null {
  if (/iphone/i.test(ua)) return "iPhone";
  if (/ipad/i.test(ua)) return "iPad";
  if (/android/i.test(ua)) return "Android";
  if (/macintosh|mac os x/i.test(ua)) return "Mac";
  if (/windows/i.test(ua)) return "Windows";
  if (/linux|x11/i.test(ua)) return "Linux";
  return null;
}

/** Client name for a direct (non-proxy) hit, or null when it cannot be told. */
export function clientFromUa(ua: string): string | null {
  if (OUTLOOK_UA_RE.test(ua)) return "Outlook";
  for (const [re, name] of MAIL_APP_UAS) if (re.test(ua)) return name;
  // Apple Mail renders in WebKit without a Safari/Chrome token.
  if (/applewebkit/i.test(ua) && !/safari|chrome|crios|fxios|edg/i.test(ua)) return "Apple Mail";
  if (/edg\//i.test(ua)) return "Web browser";
  if (/chrome|firefox|safari|crios|fxios/i.test(ua)) return "Web browser";
  return null;
}
