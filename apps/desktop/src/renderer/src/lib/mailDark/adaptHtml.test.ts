import { describe, expect, it } from "vitest";
import { adaptMailForDark } from "./index";
import { contrast, DARK, mapBackground, parseColor, type Rgba } from "./color";
import { parseDecls } from "./css";
import { BACKGROUND_IMAGE_NEWSLETTER } from "./fixtures/backgroundImageNewsletter";
import { COLORFUL_NEWSLETTER } from "./fixtures/colorfulNewsletter";
import { GMAIL_REPLY } from "./fixtures/gmailReply";
import { OUTLOOK_REPLY } from "./fixtures/outlookReply";
import { SIGNATURE_LOGO } from "./fixtures/signatureLogo";

const parse = (html: string) => new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
const color = (s: string | null | undefined): Rgba | null => (s ? parseColor(s) : null);
const inline = (el: Element, prop: string) => parseDecls(el.getAttribute("style") ?? "").find((d) => d.prop === prop)?.value;

/** Walks the output and checks every explicit text color against the fill it sits on (inline styles and attributes only). */
function worstContrast(html: string): { ratio: number; where: string } {
  const doc = parse(html);
  let worst = { ratio: Infinity, where: "" };
  for (const el of Array.from(doc.body.querySelectorAll("*"))) {
    const fg = color(inline(el, "color")) ?? (el.tagName === "FONT" ? color(el.getAttribute("color")) : null);
    if (!fg) continue;
    let bg = color(DARK.bg)!;
    for (let p: Element | null = el; p; p = p.parentElement) {
      const own = color(inline(p, "background-color") ?? inline(p, "background")) ?? color(p.getAttribute("bgcolor"));
      if (own && own.a >= 0.5) {
        bg = own;
        break;
      }
    }
    const ratio = contrast(fg, bg);
    if (ratio < worst.ratio) worst = { ratio, where: `${el.tagName} ${el.getAttribute("style") ?? ""}` };
  }
  return worst;
}

describe("Gmail reply", () => {
  const out = adaptMailForDark(GMAIL_REPLY);
  const doc = parse(out.html);
  it("is adaptable and keeps the structure and wording", () => {
    expect(out.adaptable).toBe(true);
    expect(doc.querySelector(".gmail_quote blockquote.gmail_quote")).not.toBeNull();
    expect(doc.body.textContent).toContain("Can we meet Thursday");
  });
  it("lightens the dark quoted text", () => {
    const quoted = doc.querySelector("blockquote div[style*='color']")!;
    expect(contrast(color(inline(quoted, "color"))!, color(DARK.bg)!)).toBeGreaterThan(4.5);
  });
  it("gives links the accent", () => {
    for (const a of Array.from(doc.querySelectorAll("a"))) expect(color(inline(a, "color"))).toMatchObject({ r: 76, g: 141, b: 255 });
  });
  it("swaps the pale grey quote rule for the theme line", () => {
    const bq = doc.querySelector("blockquote")!;
    expect(inline(bq, "border-left")).toMatch(/rgba\(237,235,229,0\.18\)/);
    expect(inline(bq, "margin")).toBe("0px 0px 0px 0.8ex"); // layout declarations are untouched
  });
  it("leaves every text color readable", () => expect(worstContrast(out.html).ratio).toBeGreaterThan(4.5));
});

describe("Outlook MsoNormal reply", () => {
  const out = adaptMailForDark(OUTLOOK_REPLY);
  const doc = parse(out.html);
  it("recolors the style block rule by rule", () => {
    const css = doc.querySelector("style")!.textContent!;
    const normal = /p\.MsoNormal[^{]*\{([^}]*)\}/.exec(css)![1]!;
    expect(contrast(color(parseDecls(normal).find((d) => d.prop === "color")!.value)!, color(DARK.bg)!)).toBeGreaterThan(4.5);
    expect(normal).toContain("font-size:11.0pt"); // other declarations survive
    const link = /a:link[^{]*\{([^}]*)\}/.exec(css)![1]!;
    expect(parseDecls(link).find((d) => d.prop === "color")!.value).toBe("#4c8dff");
  });
  it("keeps a callout readable: pale fill sinks, its text reads on it", () => {
    const css = doc.querySelector("style")!.textContent!;
    const banner = parseDecls(/\.Banner\s*\{([^}]*)\}/.exec(css)![1]!);
    const bg = color(banner.find((d) => d.prop === "background")!.value)!;
    expect(mapBackground(color("#FFF2CC")!).kept).toBe(false);
    expect(contrast(color(banner.find((d) => d.prop === "color")!.value)!, bg)).toBeGreaterThan(4.5);
  });
  it("lightens font color attributes and span colors", () => {
    const font = doc.querySelector("font")!;
    expect(contrast(color(font.getAttribute("color"))!, color(DARK.bg)!)).toBeGreaterThan(4.5);
    expect(font.getAttribute("face")).toBe("Arial");
    expect(worstContrast(out.html).ratio).toBeGreaterThan(4.5);
  });
  it("replaces the pale separator border", () => {
    const sep = doc.querySelector("div[style*='border']")!;
    expect(inline(sep, "border-top")).toContain("rgba(237,235,229,0.18)");
  });
});

describe("colorful newsletter", () => {
  const out = adaptMailForDark(COLORFUL_NEWSLETTER);
  const doc = parse(out.html);
  it("adapts instead of falling back", () => expect(out.adaptable).toBe(true));
  it("darkens light fills and keeps the dark header and the brand button", () => {
    const outer = doc.querySelector("table")!;
    expect(mapBackground(color(outer.getAttribute("bgcolor"))!).kept).toBe(true); // already dark enough to stay
    expect(color(outer.getAttribute("bgcolor"))!.r).toBeLessThan(80);
    const header = doc.querySelector("span")!.closest("td")!;
    expect(inline(header, "background-color")).toBe("#1f2a37");
    const button = doc.querySelector("a[href*='issue']")!;
    expect(inline(button, "background-color")).toBe("#2f6fe0");
    expect(inline(button, "color")).toBe("#ffffff"); // white on blue stays
  });
  it("keeps tinted callouts distinguishable and readable", () => {
    const leaf = (start: string) => Array.from(doc.querySelectorAll("td")).find((td) => !td.querySelector("td") && td.textContent?.startsWith(start))!;
    const tip = leaf("Tip:");
    const tipBg = color(inline(tip, "background"))!;
    const snakeBg = color(inline(leaf("Snake"), "background"))!;
    expect(tipBg.r).toBeGreaterThan(tipBg.b); // warm stays warm
    expect(snakeBg.g).toBeGreaterThan(snakeBg.r); // green stays green
    expect(worstContrast(out.html).ratio).toBeGreaterThan(4.5);
  });
  it("no pure white or near-white fill remains", () => {
    expect(out.html).not.toMatch(/background(-color)?:\s*#(fff|ffffff|f4f1ea)\b/i);
    expect(out.html).not.toMatch(/bgcolor="#(fff|ffffff|f4f1ea)"/i);
  });
});

describe("signature with a logo", () => {
  const out = adaptMailForDark(SIGNATURE_LOGO);
  const doc = parse(out.html);
  it("puts a light plate behind the transparent logo and leaves the image alone", () => {
    const img = doc.querySelector("img")!;
    expect(img.getAttribute("src")).toBe("https://cdn.northwind.example/brand/wordmark.png");
    expect(img.getAttribute("width")).toBe("120");
    expect(inline(img, "background")).toBe("#ffffff");
    expect(inline(img, "display")).toBe("block");
  });
  it("lightens the grey contact lines", () => {
    const info = doc.querySelector("div[style*='font-size:12px']")!;
    expect(contrast(color(inline(info, "color"))!, color(DARK.bg)!)).toBeGreaterThan(4.5);
  });
  it("does not plate photos or large images", () => {
    const o = adaptMailForDark('<p>hi</p><img src="https://x.test/team.jpg" width="120"><img src="https://x.test/banner.png" width="600" alt="logo">');
    expect(o.html).not.toContain("#ffffff");
  });
  it("does not plate a logo that already sits on the sender's own dark fill", () => {
    const o = adaptMailForDark('<table><tr><td style="background:#0F110F"><img src="https://x.test/infocus-logo.png" width="28" height="28" alt=""></td></tr></table>');
    expect(o.html).not.toContain("#ffffff");
  });
});

describe("mail that cannot be adapted", () => {
  it("flags a background image newsletter", () => {
    const out = adaptMailForDark(BACKGROUND_IMAGE_NEWSLETTER);
    expect(out.adaptable).toBe(false);
    expect(out.reasons).toContain("background-image");
  });
  it("flags the background attribute, style-block images and Outlook VML fills", () => {
    expect(adaptMailForDark('<table><tr><td background="https://x.test/a.jpg">hi</td></tr></table>').reasons).toContain("background-image");
    expect(adaptMailForDark('<style>.hero{background:url("https://x.test/a.jpg") center}</style><div class="hero">x</div>').reasons).toContain("background-image");
    expect(adaptMailForDark('<!--[if gte mso 9]><v:rect><v:fill type="frame" src="https://x.test/a.jpg"/></v:rect><![endif]--><p>x</p>').reasons).toContain("background-image");
  });
  it("tolerates a tiny inline pattern", () => {
    expect(adaptMailForDark('<div style="background:url(data:image/gif;base64,R0lGODlhAQABAAAAACw=)">x</div>').adaptable).toBe(true);
  });
  it("flags a layout with many brand fills", () => {
    const fills = ["#d32f2f", "#2e7d32", "#6a1b9a", "#ef6c00", "#00838f"];
    const html = fills.map((f) => `<div style="background:${f};color:#fff">x</div>`).join("");
    expect(adaptMailForDark(html).reasons).toContain("designed-layout");
    expect(adaptMailForDark(fills.slice(0, 2).map((f) => `<div style="background:${f}">x</div>`).join("")).adaptable).toBe(true);
  });
  it("flags a message that is one wide picture", () => {
    expect(adaptMailForDark('<img src="https://x.test/flyer.png" width="640">').reasons).toContain("image-only");
    expect(adaptMailForDark('<p>Here is the flyer we talked about on the phone yesterday afternoon, please share it.</p><img src="https://x.test/flyer.png" width="640">').adaptable).toBe(true);
  });
  it("still returns recolored html so the user can choose dark", () => {
    expect(adaptMailForDark(BACKGROUND_IMAGE_NEWSLETTER).html).not.toBe(BACKGROUND_IMAGE_NEWSLETTER);
  });
});

describe("edge cases", () => {
  it("passes empty and colorless mail through", () => {
    expect(adaptMailForDark("").html).toBe("");
    expect(adaptMailForDark("<p>Plain <b>bold</b></p>").html).toBe("<p>Plain <b>bold</b></p>");
  });
  it("leaves unreadable values alone", () => {
    const html = '<p style="color:inherit;background:var(--x);margin:0">x</p>';
    expect(adaptMailForDark(html).html).toBe(html);
  });
  it("ensures inherited text reads on a kept light-ish fill", () => {
    const out = adaptMailForDark('<div style="background:#e2b04a"><p>No explicit color here</p></div>');
    const div = parse(out.html).querySelector("div")!;
    expect(contrast(color(inline(div, "color"))!, color("#e2b04a")!)).toBeGreaterThanOrEqual(4.5);
  });
  it("keeps white text on a dark fill and lifts dark text on it", () => {
    const out = adaptMailForDark('<div style="background:#101820"><span style="color:#ffffff">a</span><span style="color:#222">b</span></div>');
    expect(worstContrast(out.html).ratio).toBeGreaterThan(4.5);
  });
  it("handles very deep nesting without a stack overflow", () => {
    const html = "<div>".repeat(400) + '<span style="color:#000">x</span>' + "</div>".repeat(400);
    expect(adaptMailForDark(html).html).toContain("color:");
  });
  it("is fast on a large newsletter", () => {
    const big = COLORFUL_NEWSLETTER.repeat(60);
    const t = performance.now();
    adaptMailForDark(big);
    expect(performance.now() - t).toBeLessThan(1500);
  });
  it("re-applies body attributes the parser merged", () => {
    const out = adaptMailForDark('<html><body bgcolor="#ffffff" text="#000000"><p>x</p></body></html>');
    expect(out.html).toMatch(/^<div style="background-color:#[0-9a-f]{6};color:#[0-9a-f]{6}">/);
  });
});
