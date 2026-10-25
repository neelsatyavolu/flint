import { convert } from "html-to-text";
import { addressText } from "./mappers";
import type { Sql } from "./sql";
import type { Address } from "../types";

export const BODY_INDEX_CAP = 100_000;
const HTML_INPUT_CAP = 1_000_000;

export function htmlToPlain(html: string): string {
  try {
    return convert(html.slice(0, HTML_INPUT_CAP), {
      wordwrap: false,
      selectors: [
        { selector: "a", options: { ignoreHref: true } },
        { selector: "img", format: "skip" },
        { selector: "style", format: "skip" },
        { selector: "script", format: "skip" },
      ],
    });
  } catch {
    return html.replace(/<[^>]*>/g, " ");
  }
}

/** Plain text for the search index: the text part, else the HTML converted to text, capped at 100KB. */
export function bodyTextFor(text: string | null | undefined, html: string | null | undefined): string {
  const raw = text && text.trim() ? text : html ? htmlToPlain(html) : "";
  return raw.slice(0, BODY_INDEX_CAP);
}

export function snippetFrom(body: string): string {
  return body.replace(/\s+/g, " ").trim().slice(0, 200);
}

export type FtsFields = { subject: string; from: Address[]; to: Address[]; cc?: Address[]; body: string };

export function writeFts(q: Sql, rowid: number, f: FtsFields): void {
  q.run("DELETE FROM messages_fts WHERE rowid = ?", rowid);
  q.run(
    "INSERT INTO messages_fts (rowid, subject, from_text, to_text, body_text) VALUES (?,?,?,?,?)",
    rowid, f.subject, addressText(f.from), addressText([...f.to, ...(f.cc ?? [])]), f.body,
  );
}
