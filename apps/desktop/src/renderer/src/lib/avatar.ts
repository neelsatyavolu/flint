/** Avatar tint inputs (DESIGN.md §2). The lightness/chroma live in tokens.css (--avatar-l, --avatar-c). */

export const AVATAR_HUES = [25, 60, 95, 150, 195, 235, 280, 330] as const;

/** FNV-1a 32-bit. Stable across runs so a sender keeps their colour. */
export function hashString(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function avatarHue(address: string): number {
  const key = address.trim().toLowerCase();
  return AVATAR_HUES[hashString(key) % AVATAR_HUES.length] ?? AVATAR_HUES[0];
}

/** CSS colour for an address, resolved against the active theme tokens. */
export function avatarColor(address: string): string {
  return `oklch(var(--avatar-l) var(--avatar-c) ${avatarHue(address)})`;
}

export function initials(name: string, address: string): string {
  // Only letters and digits count: "Neel (Nenu)" is NN, not "N(".
  const split = (v: string) => v.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const named = split(name);
  const words = named.length > 0 ? named : split(address.split("@")[0] ?? "");
  const first = words[0]?.[0] ?? "?";
  const second = words.length > 1 ? words[words.length - 1]?.[0] ?? "" : "";
  return (first + second).toUpperCase();
}
