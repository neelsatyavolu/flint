import type { Address } from "@flint/core";

export function svgUri(svg: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export const p = (text: string) => `<p style="margin:0 0 12px">${esc(text)}</p>`;
export const paragraphs = (text: string) => text.split(/\n{2,}/).map((t) => p(t.replace(/\n/g, " "))).join("");

/** Plain text -> HTML paragraphs with <br> kept for single newlines. */
export function textToMailHtml(text: string): string {
  return text.split(/\n{2,}/).map((t) => `<p style="margin:0 0 12px">${esc(t).replace(/\n/g, "<br>")}</p>`).join("");
}

export function quoteBlock(from: Address, when: string, innerHtml: string): string {
  return `<div style="margin-top:16px;color:#6b6b66;font-size:13px">On ${when}, ${esc(from.name)} &lt;${esc(from.address)}&gt; wrote:</div>` +
    `<blockquote style="margin:6px 0 0 2px;padding-left:12px;border-left:2px solid #d4d2ca;color:#55554f">${innerHtml}</blockquote>`;
}

export function forwardedBlock(from: Address, subject: string, date: string, to: string, innerHtml: string): string {
  return `<div style="margin-top:16px;color:#6b6b66;font-size:13px;line-height:1.5">---------- Forwarded message ---------<br>` +
    `From: <b>${esc(from.name)}</b> &lt;${esc(from.address)}&gt;<br>Date: ${esc(date)}<br>Subject: ${esc(subject)}<br>To: ${esc(to)}</div>` +
    `<div style="margin-top:8px">${innerHtml}</div>`;
}

const LOGO = svgUri(`<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96"><rect width="96" height="96" fill="#2c3a4f"/><polygon points="14,52 38,16 46,54" fill="#8fb0e0"/><polygon points="38,16 66,26 46,54" fill="#e9eef8"/><polygon points="66,26 80,60 46,54" fill="#b9cbea"/><polygon points="62,86 30,86 46,54" fill="#6f90c4"/></svg>`);
const HEADER = svgUri(`<svg xmlns="http://www.w3.org/2000/svg" width="640" height="200" viewBox="0 0 640 200"><rect width="640" height="200" fill="#1f2a37"/><g fill="none" stroke="#e2b04a" stroke-width="2"><circle cx="520" cy="100" r="60"/><circle cx="520" cy="100" r="36"/><circle cx="520" cy="100" r="12"/></g><rect x="40" y="130" width="220" height="6" fill="#e9e6dc"/><rect x="40" y="148" width="140" height="6" fill="#8a8f98"/></svg>`);

export const SIGNATURES = {
  plain: `<div>Alex Rivera<br>Northwind</div>`,
  short: `<div>Thanks,<br>Alex</div>`,
  rich: `<table cellpadding="0" cellspacing="0" style="font-size:13px;color:#3b3b36"><tr><td style="padding-right:12px;vertical-align:top"><img src="${LOGO}" width="48" height="48" alt="Northwind" style="display:block"></td><td style="border-left:2px solid #4c8dff;padding-left:12px"><b>Alex Rivera</b><br>Design lead, Northwind<br><a href="https://northwind.example" style="color:#2f6fe0">northwind.example</a> &middot; <a href="mailto:alex@northwind.dev" style="color:#2f6fe0">alex@northwind.dev</a><br><a href="https://cal.northwind.example/alex" style="color:#2f6fe0">Book a time</a></td></tr></table>`,
};

/** A designed newsletter: tables, hero image, button, footer with unsubscribe, a remote image and a tracker pixel. */
export function newsletterHtml(opts: { name: string; issue: string; headline: string; intro: string; items: { title: string; blurb: string }[]; accent: string }): string {
  const items = opts.items
    .map((i) => `<tr><td style="padding:16px 0;border-top:1px solid #e6e3da"><div style="font:600 17px/1.3 Georgia,serif;color:#1a1a17">${esc(i.title)}</div><div style="font:15px/1.55 Helvetica,Arial,sans-serif;color:#55554f;margin-top:6px">${esc(i.blurb)}</div><a href="https://example.com/read" style="display:inline-block;margin-top:8px;font:600 13px Helvetica,Arial,sans-serif;color:${opts.accent}">Read more</a></td></tr>`)
    .join("");
  return `<table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f1ea"><tr><td align="center" style="padding:24px 12px">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff">
<tr><td><img src="${HEADER}" width="600" alt="" style="display:block;width:100%;height:auto"></td></tr>
<tr><td style="padding:28px 32px 8px"><div style="font:600 12px/1 Helvetica,Arial,sans-serif;letter-spacing:.12em;text-transform:uppercase;color:${opts.accent}">${esc(opts.name)} &middot; ${esc(opts.issue)}</div>
<h1 style="font:700 28px/1.2 Georgia,serif;color:#1a1a17;margin:12px 0 12px">${esc(opts.headline)}</h1>
<p style="font:16px/1.6 Helvetica,Arial,sans-serif;color:#3b3b36;margin:0 0 16px">${esc(opts.intro)}</p>
<img src="https://images.example.com/hero-photo.jpg" width="536" alt="Featured photo" style="display:block;width:100%;height:auto;background:#e6e3da">
</td></tr>
<tr><td style="padding:8px 32px 8px"><table width="100%" cellpadding="0" cellspacing="0">${items}</table></td></tr>
<tr><td align="center" style="padding:16px 32px 32px"><a href="https://example.com/subscribe" style="display:inline-block;background:${opts.accent};color:#ffffff;font:600 15px Helvetica,Arial,sans-serif;padding:12px 24px;text-decoration:none">Read the full issue</a></td></tr>
<tr><td style="background:#f3f1ea;padding:20px 32px;font:12px/1.6 Helvetica,Arial,sans-serif;color:#7a7a72">You are receiving this because you subscribed to ${esc(opts.name)}.<br><a href="https://example.com/unsubscribe" style="color:#7a7a72">Unsubscribe</a> &middot; <a href="https://example.com/prefs" style="color:#7a7a72">Preferences</a></td></tr>
</table><img src="https://track.example.com/open.gif?u=abc" width="1" height="1" alt="" style="display:none"></td></tr></table>`;
}

export function notificationHtml(opts: { title: string; body: string; button?: string }): string {
  return `<div style="max-width:520px;margin:0 auto;font:15px/1.55 Helvetica,Arial,sans-serif;color:#1a1a17"><div style="font:600 20px/1.3 Helvetica,Arial,sans-serif;margin-bottom:12px">${esc(opts.title)}</div><p style="margin:0 0 16px;color:#3b3b36">${esc(opts.body)}</p>${opts.button ? `<a href="https://example.com/review" style="display:inline-block;border:1px solid #1a1a17;color:#1a1a17;padding:9px 18px;text-decoration:none;font-weight:600;font-size:14px">${esc(opts.button)}</a>` : ""}<p style="margin:24px 0 0;font-size:12px;color:#7a7a72">You received this email to let you know about important changes to your account.</p></div>`;
}
