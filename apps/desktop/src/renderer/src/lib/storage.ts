/** localStorage wrappers. Storage can be absent or throw (private windows, tests), so every call is guarded. */

export function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStored(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage unavailable: the value just won't persist.
  }
}

export function readStoredNumber(key: string, fallback: number): number {
  const raw = readStored(key);
  if (raw === null) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}
