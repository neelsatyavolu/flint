import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { DARK, contrast, ensureContrast, formatColor, fromOklch, mapBackground, mapBorder, mapText, parseColor, replaceColors, toOklch } from "./color";

const c = (s: string) => parseColor(s)!;

describe("parseColor", () => {
  it("reads hex, rgb, hsl, names and transparent", () => {
    expect(formatColor(c("#fff"))).toBe("#ffffff");
    expect(formatColor(c("#1A2B3C"))).toBe("#1a2b3c");
    expect(formatColor(c("rgb(34, 34, 34)"))).toBe("#222222");
    expect(formatColor(c("rgb(34 34 34 / 50%)"))).toBe("rgba(34,34,34,0.5)");
    expect(formatColor(c("hsl(0, 100%, 50%)"))).toBe("#ff0000");
    expect(formatColor(c("Navy"))).toBe("#000080");
    expect(c("transparent").a).toBe(0);
    expect(formatColor(c("#11223380"))).toBe("rgba(17,34,51,0.5)");
  });
  it("rejects things that are not a single color", () => {
    for (const bad of ["inherit", "currentColor", "var(--x)", "#12", "linear-gradient(red, blue)", ""]) expect(parseColor(bad)).toBeNull();
  });
});

describe("oklch", () => {
  it("round-trips and orders lightness", () => {
    const o = toOklch(c("#d32f2f"));
    expect(formatColor(fromOklch(o))).toBe("#d32f2f");
    expect(toOklch(c("#000")).l).toBeCloseTo(0, 2);
    expect(toOklch(c("#fff")).l).toBeCloseTo(1, 2);
  });
  it("keeps hue when lightness moves", () => {
    const red = toOklch(c("#b00020"));
    const lighter = toOklch(fromOklch({ ...red, l: 0.75 }));
    expect(Math.abs(lighter.h - red.h)).toBeLessThan(4);
  });
});

describe("mapBackground", () => {
  it("sinks white and pale fills to the card tone, keeping tint", () => {
    const white = mapBackground(c("#ffffff"));
    expect(white.kept).toBe(false);
    expect(Math.abs(contrast(white.color, c(DARK.bg)) - 1)).toBeLessThan(0.15);
    const cream = toOklch(mapBackground(c("#fff4d6")).color);
    expect(cream.l).toBeLessThan(0.4);
    expect(cream.c).toBeGreaterThan(0.015); // still reads as warm
  });
  it("keeps dark and saturated fills as authored", () => {
    for (const hex of ["#1f2a37", "#000000", "#2f6fe0", "#d32f2f", "#e2b04a"]) {
      const m = mapBackground(c(hex));
      expect(m.kept).toBe(true);
      expect(formatColor(m.color)).toBe(hex);
    }
  });
  it("preserves alpha", () => expect(mapBackground(c("rgba(255,255,255,0.6)")).color.a).toBeCloseTo(0.6, 2));
});

describe("mapText", () => {
  it("lightens dark text until it reads on the card", () => {
    for (const hex of ["#000000", "#222222", "#444444", "#1f3864", "#7f6000", "#b00020", "#0563c1"]) {
      expect(contrast(mapText(c(hex)), c(DARK.bg))).toBeGreaterThan(4.5);
    }
  });
  it("keeps hue of colored text and leaves light text alone", () => {
    const red = toOklch(mapText(c("#b00020")));
    expect(Math.abs(red.h - toOklch(c("#b00020")).h)).toBeLessThan(6);
    expect(formatColor(mapText(c("#ffffff")))).toBe("#ffffff");
    expect(formatColor(mapText(c("#f0f0f0")))).toBe("#f0f0f0");
  });
  it("turns black into something close to the theme text", () => {
    expect(contrast(mapText(c("#000")), c(DARK.fg))).toBeLessThan(1.3);
  });
});

describe("mapBorder", () => {
  it("uses the theme line for pale neutral rules, lightens black, keeps brand lines", () => {
    expect(mapBorder(c("#cccccc"))).toMatchObject({ r: 237, g: 235, b: 229 });
    expect(contrast(mapBorder(c("#000000")), c(DARK.bg))).toBeGreaterThan(3);
    expect(formatColor(mapBorder(c("#4c8dff")))).toBe("#4c8dff");
  });
});

describe("ensureContrast", () => {
  it("lightens on dark and darkens on light", () => {
    expect(contrast(ensureContrast(c("#333333"), c("#232321")), c("#232321"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(ensureContrast(c("#eeeeee"), c("#e2b04a")), c("#e2b04a"))).toBeGreaterThanOrEqual(4.5);
  });
  it("returns the same object when it already reads", () => {
    const fg = c("#ffffff");
    expect(ensureContrast(fg, c("#000000"))).toBe(fg);
  });
});

describe("replaceColors", () => {
  it("maps every token in a shorthand and leaves the rest", () => {
    const out = replaceColors("1px solid #ccc", () => c("#101010"));
    expect(out).toBe("1px solid #101010");
    expect(replaceColors("0 0 3px rgba(0,0,0,.3), red", () => c("#ffffff"))).toBe("0 0 3px #ffffff, #ffffff");
  });
  it("does not match names inside words", () => expect(replaceColors("font-family:redacted", () => c("#fff"))).toBe("font-family:redacted"));
});

describe("DARK constants", () => {
  const tokens = readFileSync(resolve(import.meta.dirname, "../../styles/tokens.css"), "utf8");
  const dark = tokens.slice(0, tokens.indexOf("}"));
  const value = (name: string) => new RegExp(`${name}:\\s*([^;]+);`).exec(dark)?.[1]?.trim();
  it("mirror the dark tokens", () => {
    expect(value("--plane-3")).toBe(DARK.bg);
    expect(value("--fg")).toBe(DARK.fg);
    expect(value("--accent")).toBe(DARK.accent);
    expect(value("--line-strong")).toBe(DARK.line);
  });
});
