export type Unsubscribe = { url?: string; mailto?: string; oneClick: boolean };

/** Reads List-Unsubscribe (RFC 2369) and List-Unsubscribe-Post (RFC 8058). Null when there is nothing usable. */
export function parseUnsubscribe(headers: Record<string, string>): Unsubscribe | null {
  const raw = headers["list-unsubscribe"];
  if (!raw) return null;
  const targets = [...raw.matchAll(/<([^>]+)>/g)].map((m) => m[1]!.trim());
  const url = targets.find((t) => /^https?:\/\//i.test(t));
  const mailto = targets.find((t) => /^mailto:/i.test(t));
  if (!url && !mailto) return null;
  const oneClick = Boolean(url) && /one-click/i.test(headers["list-unsubscribe-post"] ?? "");
  return { ...(url ? { url } : {}), ...(mailto ? { mailto } : {}), oneClick };
}
