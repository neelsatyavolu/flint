import { convert, type FormatterFunction } from "html-to-text";
import type { Address, MessageView } from "@flint/core/types";

const MAX_URL_CHARS = 60;

/** Long tracking URLs carry no meaning for a reader; keep the host so the destination is still clear. */
export function shortenUrl(href: string): string {
  if (href.length <= MAX_URL_CHARS) return href;
  try {
    const u = new URL(href);
    return u.protocol === "http:" || u.protocol === "https:" ? `${u.protocol}//${u.host}/...` : `${u.protocol}...`;
  } catch {
    return `${href.slice(0, MAX_URL_CHARS)}...`;
  }
}

/** Renders <a> as [text](url); a link whose text is its own URL prints just the URL. */
export const markdownLink: FormatterFunction = (elem, walk, builder) => {
  const raw = elem.attribs?.href?.trim();
  if (!raw || raw.startsWith("#") || /^(javascript|data):/i.test(raw)) return walk(elem.children, builder);
  const href = raw.startsWith("mailto:") ? raw.slice(7) : raw;
  let text = "";
  builder.addInline("[", { noWordTransform: true });
  builder.pushWordTransform((str) => { text += str; return str; });
  walk(elem.children, builder);
  builder.popWordTransform();
  const label = text.replace(/\s+/g, " ").trim();
  if (!label) return builder.addInline(shortenUrl(href), { noWordTransform: true });
  if (label === href || label === raw) return;
  builder.addInline(`](${shortenUrl(href)})`, { noWordTransform: true });
};

export function htmlToReadable(html: string): string {
  return convert(html, {
    wordwrap: 100,
    formatters: { markdownLink },
    selectors: [
      { selector: "img", format: "skip" },
      { selector: "a", format: "markdownLink" },
      ...["h1", "h2", "h3", "h4", "h5", "h6"].map((selector) => ({ selector, options: { uppercase: false } })),
      { selector: "table", format: "dataTable", options: { uppercaseHeaderCells: false, colSpacing: 3 } },
    ],
  }).replace(/\n{3,}/g, "\n\n").trim();
}

export function messageBody(m: MessageView, raw: boolean): string {
  if (raw) return m.html ?? m.text ?? m.snippet;
  if (m.text && m.text.trim()) return m.text.trim();
  if (m.html) return htmlToReadable(m.html);
  return m.bodyLoaded ? "" : m.snippet;
}

export function formatAddress(a: Address): string {
  return a.name && a.name !== a.address ? `${a.name} <${a.address}>` : a.address;
}

export function formatAddresses(list: Address[]): string {
  return list.map(formatAddress).join(", ");
}

const escapeHtml = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Plain text to HTML paragraphs; single newlines become <br>. */
export function textToHtml(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .filter((p) => p.trim())
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
}
