import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Read from disk: Vitest empties CSS imports, `?raw` included.
const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "tokens.css"), "utf8");

type Rgb = [number, number, number];
type Rgba = { rgb: Rgb; a: number };

/** Custom properties declared in the first `{...}` after `selector` (searching from `from`). */
function block(selector: string, from = 0): Record<string, string> {
  const at = css.indexOf(selector, from);
  if (at < 0) throw new Error(`No ${selector} block after ${from}`);
  const body = css.slice(css.indexOf("{", at) + 1, css.indexOf("}", at));
  return Object.fromEntries([...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!.trim()]));
}

function parse(value: string): Rgba {
  const hex = /^#([0-9a-f]{6})$/i.exec(value);
  if (hex) {
    const n = parseInt(hex[1]!, 16);
    return { rgb: [(n >> 16) & 255, (n >> 8) & 255, n & 255], a: 1 };
  }
  const rgba = /^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/.exec(value);
  if (rgba) return { rgb: [Number(rgba[1]), Number(rgba[2]), Number(rgba[3])], a: Number(rgba[4]) };
  throw new Error(`Can't parse color ${value}`);
}

const over = (c: Rgba, bg: Rgb): Rgb => c.rgb.map((v, i) => v * c.a + bg[i]! * (1 - c.a)) as Rgb;

function luminance([r, g, b]: Rgb): number {
  const ch = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
}

/** WCAG 2 contrast ratio of a (possibly translucent) color over an opaque plane. */
function contrast(color: string, plane: string): number {
  const bg = parse(plane).rgb;
  const [hi, lo] = [luminance(over(parse(color), bg)), luminance(bg)].sort((a, b) => b - a) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const PLANES = ["--plane-0", "--plane-1", "--plane-2", "--plane-3"];
const dark = block('[data-theme="dark"]');
const light = block('[data-theme="light"]');
const systemLight = block(":root:not([data-theme])");
const moreContrast = css.indexOf("@media (prefers-contrast: more)");

describe("design tokens", () => {
  it.each([["dark", dark], ["light", light]] as const)("%s: tertiary text meets WCAG AA (4.5:1) on every plane", (_, t) => {
    for (const p of PLANES) expect(contrast(t["--fg-3"]!, t[p]!)).toBeGreaterThanOrEqual(4.5);
  });

  it.each([["dark", dark], ["light", light]] as const)("%s: the focus ring reaches 3:1 on every plane", (_, t) => {
    const root = block(":root {");
    expect(root["--focus-ring"]).toBe("2px solid var(--accent)");
    for (const p of PLANES) {
      expect(contrast(t["--accent"]!, t[p]!)).toBeGreaterThanOrEqual(3);
      expect(contrast(t["--accent-ring"]!, t[p]!)).toBeGreaterThanOrEqual(3);
    }
  });

  it("the system-light copy matches the light theme", () => {
    expect(systemLight).toEqual(light);
  });

  it("Increase contrast raises borders to 3:1 in both themes", () => {
    expect(moreContrast).toBeGreaterThan(0);
    const darkMore = block('[data-theme="dark"]', moreContrast);
    const lightMore = block('[data-theme="light"]', moreContrast);
    expect(block(":root:not([data-theme])", moreContrast)).toEqual(lightMore);
    for (const p of PLANES) {
      expect(contrast(darkMore["--line-strong"]!, dark[p]!)).toBeGreaterThanOrEqual(3);
      expect(contrast(lightMore["--line-strong"]!, light[p]!)).toBeGreaterThanOrEqual(3);
    }
  });

  it("defines the message type role", () => {
    expect(block(":root {")["--text-message"]).toBe("14.5px");
    expect(block(":root {")["--lh-message"]).toBe("22px");
    expect(css).toContain(".t-message {");
  });
});
