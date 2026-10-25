import { convert } from "html-to-text";
import type { Address, MessageView } from "@flint/core/types";

export function htmlToReadable(html: string): string {
  return convert(html, {
    wordwrap: 100,
    selectors: [
      { selector: "img", format: "skip" },
      { selector: "a", options: { ignoreHref: false, hideLinkHrefIfSameAsText: true } },
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
