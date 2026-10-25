/** Address from a mailto: URL, or null when it is not a usable mailto link. */
export function parseMailto(url: string): string | null {
  if (!/^mailto:/i.test(url)) return null;
  const rest = url.slice("mailto:".length).split("?")[0] ?? "";
  try {
    const address = decodeURIComponent(rest).split(",")[0]?.trim() ?? "";
    return address.length > 0 && address.length < 320 ? address : null;
  } catch {
    return null;
  }
}
