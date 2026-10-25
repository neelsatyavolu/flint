/**
 * Color math for dark-mode mail. OKLCH keeps hue while lightness moves, which is what we want:
 * a red heading stays red, it just gets lighter. Pure functions, no DOM.
 */

export type Rgba = { r: number; g: number; b: number; a: number };
export type Oklch = { l: number; c: number; h: number };

/**
 * The reader card the mail sits on, plus text, accent and line. The iframe cannot read the app's
 * CSS variables, so these mirror tokens.css (dark): --plane-3, --fg, --accent, --line-strong.
 * A test keeps them in sync with tokens.css.
 */
export const DARK = {
  bg: "#232321",
  fg: "#edebe5",
  accent: "#4c8dff",
  line: "rgba(237, 235, 229, 0.18)",
} as const;

const NAMED: Record<string, string> = {
  black: "#000000", white: "#ffffff", red: "#ff0000", green: "#008000", blue: "#0000ff", yellow: "#ffff00",
  gray: "#808080", grey: "#808080", silver: "#c0c0c0", maroon: "#800000", purple: "#800080", navy: "#000080",
  teal: "#008080", olive: "#808000", orange: "#ffa500", lime: "#00ff00", aqua: "#00ffff", cyan: "#00ffff",
  fuchsia: "#ff00ff", magenta: "#ff00ff", brown: "#a52a2a", pink: "#ffc0cb", gold: "#ffd700", indigo: "#4b0082",
  violet: "#ee82ee", crimson: "#dc143c", darkgray: "#a9a9a9", darkgrey: "#a9a9a9", lightgray: "#d3d3d3",
  lightgrey: "#d3d3d3", dimgray: "#696969", dimgrey: "#696969", whitesmoke: "#f5f5f5", gainsboro: "#dcdcdc",
  ivory: "#fffff0", beige: "#f5f5dc", lightyellow: "#ffffe0", lavender: "#e6e6fa", darkblue: "#00008b",
  darkred: "#8b0000", darkgreen: "#006400", royalblue: "#4169e1", steelblue: "#4682b4", slategray: "#708090",
  tomato: "#ff6347", coral: "#ff7f50", salmon: "#fa8072", khaki: "#f0e68c", snow: "#fffafa", azure: "#f0ffff",
  aliceblue: "#f0f8ff", mintcream: "#f5fffa", honeydew: "#f0fff0", linen: "#faf0e6", seashell: "#fff5ee",
};
const NAMED_RE = new RegExp(`\\b(${Object.keys(NAMED).join("|")})\\b`, "gi");
const COLOR_TOKEN_RE = new RegExp(
  `#[0-9a-f]{8}\\b|#[0-9a-f]{6}\\b|#[0-9a-f]{3,4}\\b|\\b(?:rgb|hsl)a?\\([^)]*\\)|${NAMED_RE.source}`,
  "gi",
);

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const hex2 = (n: number) => Math.round(clamp(n, 0, 255)).toString(16).padStart(2, "0");

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}

function parseFn(src: string): Rgba | null {
  const m = /^(rgb|hsl)a?\(\s*([^)]*)\)$/i.exec(src);
  if (!m) return null;
  const parts = m[2]!.replace(/\s*\/\s*/, " / ").split(/[\s,]+/).filter((p) => p !== "" && p !== "/");
  if (parts.length < 3) return null;
  const num = (p: string, pct: number) => (p.endsWith("%") ? (parseFloat(p) / 100) * pct : parseFloat(p));
  let a = 1;
  if (parts[3] !== undefined) a = parts[3].endsWith("%") ? parseFloat(parts[3]) / 100 : parseFloat(parts[3]);
  if ([parts[0], parts[1], parts[2]].some((p) => Number.isNaN(parseFloat(p!))) || Number.isNaN(a)) return null;
  if (m[1]!.toLowerCase() === "rgb") {
    return { r: clamp(num(parts[0]!, 255), 0, 255), g: clamp(num(parts[1]!, 255), 0, 255), b: clamp(num(parts[2]!, 255), 0, 255), a: clamp(a, 0, 1) };
  }
  const [r, g, b] = hslToRgb(((parseFloat(parts[0]!) % 360) + 360) % 360, clamp(parseFloat(parts[1]!) / 100, 0, 1), clamp(parseFloat(parts[2]!) / 100, 0, 1));
  return { r, g, b, a: clamp(a, 0, 1) };
}

/** Parses a single CSS color. Returns null for anything else (inherit, currentColor, var(), gradients). */
export function parseColor(input: string): Rgba | null {
  const s = input.trim().toLowerCase().replace(/\s*!important$/, "");
  if (s === "transparent") return { r: 0, g: 0, b: 0, a: 0 };
  if (NAMED[s]) return parseColor(NAMED[s]!);
  if (s.startsWith("#")) {
    let h = s.slice(1);
    if (!/^[0-9a-f]+$/.test(h)) return null;
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join("");
    if (h.length !== 6 && h.length !== 8) return null;
    const n = (i: number) => parseInt(h.slice(i, i + 2), 16);
    return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) / 255 : 1 };
  }
  return parseFn(s);
}

export function formatColor(c: Rgba): string {
  if (c.a >= 0.999) return `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}`;
  return `rgba(${Math.round(c.r)},${Math.round(c.g)},${Math.round(c.b)},${Math.round(c.a * 100) / 100})`;
}

const toLin = (v: number) => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const fromLin = (v: number) => 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.max(v, 0) ** (1 / 2.4) - 0.055);

export function toOklch(c: Rgba): Oklch {
  const r = toLin(c.r), g = toLin(c.g), b = toLin(c.b);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const C = Math.hypot(A, B);
  return { l: L, c: C, h: C < 1e-4 ? 0 : ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360 };
}

function oklchToLinear(o: Oklch): [number, number, number] {
  const A = o.c * Math.cos((o.h * Math.PI) / 180);
  const B = o.c * Math.sin((o.h * Math.PI) / 180);
  const l = (o.l + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (o.l - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (o.l - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

/** OKLCH to sRGB. Out-of-gamut colors lose chroma (not lightness) until they fit. */
export function fromOklch(o: Oklch, a = 1): Rgba {
  const inGamut = (v: [number, number, number]) => v.every((x) => x >= -0.0005 && x <= 1.0005);
  let c = o.c;
  let lin = oklchToLinear({ ...o, c });
  for (let i = 0; i < 24 && !inGamut(lin); i++) {
    c *= 0.85;
    lin = oklchToLinear({ ...o, c });
  }
  if (!inGamut(lin)) lin = oklchToLinear({ ...o, c: 0 });
  return { r: clamp(fromLin(clamp(lin[0], 0, 1)), 0, 255), g: clamp(fromLin(clamp(lin[1], 0, 1)), 0, 255), b: clamp(fromLin(clamp(lin[2], 0, 1)), 0, 255), a };
}

/** WCAG relative luminance, 0..1. */
export function luminance(c: Rgba): number {
  return 0.2126 * toLin(c.r) + 0.7152 * toLin(c.g) + 0.0722 * toLin(c.b);
}

export function contrast(a: Rgba, b: Rgba): number {
  const la = luminance(a), lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

const WARM_HUE = 95;

/** Background mapping: light fills sink to the card tone (hue kept, tint boosted a little); dark and saturated fills stay. */
export function mapBackground(c: Rgba): { color: Rgba; kept: boolean } {
  const o = toOklch(c);
  const light = o.l >= 0.8 || (o.l >= 0.6 && o.c < 0.05);
  if (!light) return { color: c, kept: true };
  const neutral = o.c < 0.012;
  return {
    color: fromOklch({ l: 0.265 + (1 - o.l) * 0.4, c: neutral ? 0 : Math.min(o.c * 1.5, 0.08), h: o.h }, c.a),
    kept: false,
  };
}

/** Text mapping: dark text lightens (hue kept), light text stays. Near-black becomes the theme's warm off-white. */
export function mapText(c: Rgba): Rgba {
  const o = toOklch(c);
  if (o.l >= 0.62) return c;
  const l = 0.94 - o.l * 0.55;
  if (o.c < 0.03) return fromOklch({ l, c: 0.01, h: WARM_HUE }, c.a);
  return fromOklch({ l, c: Math.min(o.c, 0.14), h: o.h }, c.a);
}

/** Border mapping: pale neutral lines take the theme line; dark lines lighten (capped); saturated lines stay. */
export function mapBorder(c: Rgba): Rgba {
  const o = toOklch(c);
  if (c.a < 0.05) return c;
  if (o.c < 0.05 && o.l >= 0.6) return { r: 237, g: 235, b: 229, a: 0.18 };
  if (o.l < 0.45) return fromOklch({ l: Math.min(0.94 - o.l * 0.55, 0.7), c: Math.min(o.c, 0.12), h: o.h }, c.a);
  return c;
}

/** Nudges text lightness until it reads on `bg` (WCAG ratio). Direction follows the background. */
export function ensureContrast(fg: Rgba, bg: Rgba, min = 4.5): Rgba {
  if (contrast(fg, bg) >= min) return fg;
  const o = toOklch(fg);
  const dir = luminance(bg) > 0.3 ? -1 : 1;
  let l = o.l;
  for (let i = 0; i < 40; i++) {
    l = clamp(l + dir * 0.03, 0.05, 0.98);
    const next = fromOklch({ l, c: o.c, h: o.h }, fg.a);
    if (contrast(next, bg) >= min) return next;
  }
  return dir > 0 ? { r: 255, g: 255, b: 255, a: fg.a } : { r: 20, g: 20, b: 18, a: fg.a };
}

/** Replaces every color token in a CSS value. Tokens that fail to parse are left alone. */
export function replaceColors(value: string, fn: (c: Rgba) => Rgba): string {
  return value.replace(COLOR_TOKEN_RE, (tok) => {
    const parsed = parseColor(tok);
    return parsed ? formatColor(fn(parsed)) : tok;
  });
}

/** First color token of a CSS value, if any. */
export function firstColor(value: string): Rgba | null {
  for (const m of value.matchAll(COLOR_TOKEN_RE)) {
    const c = parseColor(m[0]);
    if (c) return c;
  }
  return null;
}
