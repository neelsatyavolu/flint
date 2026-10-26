/**
 * Copies a code. It does not mark the code used: a manual paste can fail or land in the wrong place, and the browser
 * extension should keep offering the code until it expires or the extension itself fills it.
 * Resolves false when the clipboard is unavailable.
 */
export async function copyCode(code: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(code);
    return true;
  } catch {
    return false;
  }
}
