import type { Style } from "./style";

const clean = (s: string): string => s.replace(/[\r\n\t]+/g, " ").replace(/[\u0000-\u001f]/g, "").trim();

export function clip(s: string, max: number): string {
  const t = clean(s);
  if (max <= 1) return t.slice(0, Math.max(0, max));
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

export type TableOptions = {
  width: number;
  style: Style;
  /** Cap for every column except the last, which fills the line. */
  maxCol?: number;
  bold?: (rowIndex: number) => boolean;
};

/** Compact aligned text table: dim header, two-space gaps, last column takes the remaining width. */
export function renderTable(headers: string[], rows: string[][], opts: TableOptions): string {
  const maxCol = opts.maxCol ?? 28;
  const last = headers.length - 1;
  const widths = headers.map((h, i) => {
    const longest = Math.max(h.length, ...rows.map((r) => clean(r[i] ?? "").length));
    return i === last ? longest : Math.min(longest, maxCol);
  });
  const used = widths.slice(0, last).reduce((a, b) => a + b + 2, 0);
  widths[last] = Math.max(12, Math.min(widths[last] ?? 0, opts.width - used));
  const line = (cells: string[]): string =>
    cells.map((c, i) => (i === last ? clip(c, widths[i] ?? 0) : clip(c, widths[i] ?? 0).padEnd(widths[i] ?? 0))).join("  ").trimEnd();
  const out = [opts.style.dim(line(headers))];
  rows.forEach((r, i) => out.push(opts.bold?.(i) ? opts.style.bold(line(r)) : line(r)));
  return out.join("\n");
}
