export type Style = { bold(s: string): string; dim(s: string): string };

/** ANSI only when stdout is a terminal, and only bold and dim. */
export function makeStyle(tty: boolean): Style {
  if (!tty) return { bold: (s) => s, dim: (s) => s };
  return { bold: (s) => `\x1b[1m${s}\x1b[22m`, dim: (s) => `\x1b[2m${s}\x1b[22m` };
}
