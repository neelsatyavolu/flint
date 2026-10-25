import { convert } from "html-to-text";

/** Plain text from HTML for snippets, search text and the CLI. Images, scripts and styles are dropped. */
export function htmlToText(html: string, opts: { wordwrap?: number | false } = {}): string {
  if (!html) return "";
  return convert(html, {
    wordwrap: opts.wordwrap ?? false,
    selectors: [
      { selector: "img", format: "skip" },
      { selector: "style", format: "skip" },
      { selector: "script", format: "skip" },
      { selector: "head", format: "skip" },
      { selector: "title", format: "skip" },
      { selector: "a", options: { ignoreHref: false, hideLinkHrefIfSameAsText: true, linkBrackets: ["(", ")"] } },
      { selector: "table", format: "dataTable", options: { uppercaseHeaderCells: false } },
    ],
    preserveNewlines: false,
  })
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** One-line preview of a body, whitespace collapsed and cut at a word boundary. */
export function snippetFrom(text: string, max = 140): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}
