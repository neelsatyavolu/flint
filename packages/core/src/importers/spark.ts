import { copyFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import sanitizeHtml from "sanitize-html";
import { z } from "zod";
import { FlintError } from "../types";

/** A signature found in Spark's settings, cleaned and ready to save as a Flint signature. */
export type SparkSignature = {
  sparkId: string;
  name: string;
  html: string;
  /** Addresses Spark uses this signature for by default (lowercase). */
  accounts: string[];
  modifiedAt: number;
};

/** Spark Desktop keeps its settings here: the Mac App Store build is sandboxed, the direct download is not. */
export function sparkSettingsCandidates(home = homedir()): string[] {
  const base = (container: string) => join(home, "Library", "Containers", container, "Data", "Library", "Application Support", "Spark Desktop", "core-data", "settings.sqlite");
  return [
    base("com.readdle.SparkDesktop.appstore"),
    base("com.readdle.SparkDesktop"),
    join(home, "Library", "Application Support", "Spark Desktop", "core-data", "settings.sqlite"),
  ];
}

export function findSparkSettings(home = homedir()): string | null {
  return sparkSettingsCandidates(home).find((p) => existsSync(p)) ?? null;
}

const signatureRow = z.object({
  identifier: z.string().min(1).max(100),
  htmlContent: z.string().max(5_000_000),
  deleted: z.boolean().optional(),
  modificationDate: z.number().optional(),
  creationDate: z.number().optional(),
});
const bindings = z.record(z.string(), z.string());

/** Seconds since 2001-01-01 (Apple reference date) to epoch milliseconds. */
const APPLE_EPOCH_OFFSET_S = 978_307_200;
const fromAppleTime = (s: number | undefined): number => (s === undefined ? 0 : Math.round((s + APPLE_EPOCH_OFFSET_S) * 1000));

/** Signature-safe HTML: formatting, links and embedded or https images only. */
export function cleanSignatureHtml(html: string): string {
  const withoutDivider = html.replace(/^\s*<(div|p)>\s*--\s*<\/\1>\s*/i, "");
  return sanitizeHtml(withoutDivider, {
    allowedTags: ["a", "b", "br", "div", "em", "font", "i", "img", "li", "ol", "p", "s", "small", "span", "strong", "sub", "sup", "table", "tbody", "td", "th", "thead", "tr", "u", "ul", "hr", "blockquote"],
    allowedAttributes: {
      a: ["href", "title", "target", "rel"],
      img: ["src", "alt", "width", "height", "style"],
      "*": ["style", "align", "color", "width"],
      font: ["face", "size", "color"],
    },
    allowedSchemes: ["http", "https", "mailto", "tel"],
    allowedSchemesByTag: { img: ["https", "data"] },
    allowedSchemesAppliedToAttributes: ["href", "src"],
    allowProtocolRelative: false,
    transformTags: { a: sanitizeHtml.simpleTransform("a", { target: "_blank", rel: "noopener" }) },
  }).trim();
}

function plainLines(html: string): string[] {
  return sanitizeHtml(html.replace(/<\/(div|p|li|tr)>|<br\s*\/?>/gi, "\n"), { allowedTags: [], allowedAttributes: {} })
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .split("\n")
    .map((l) => l.replace(/[\s\u00a0]+/g, " ").trim())
    .filter((l) => l && l !== "--");
}

const shortDate = (ms: number): string => new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

/**
 * "Neel Satyavolu", or "Neel Satyavolu · Award-winning…" when the first line repeats.
 * A signature whose lines all appear in another one is named by its edit date instead.
 */
function nameSignatures(items: { html: string; modifiedAt: number }[]): string[] {
  const lines = items.map((i) => plainLines(i.html));
  const first = lines.map((l) => l[0] ?? "");
  return lines.map((l, i) => {
    const base = (first[i] || `Spark signature ${i + 1}`).slice(0, 60);
    const clash = first.filter((f) => f === first[i]).length > 1;
    if (!clash) return base;
    const extra = l.find((line, j) => j > 0 && !lines.some((other, k) => k !== i && other.includes(line)));
    if (extra) return `${base} · ${extra.slice(0, 40)}`;
    return items[i]!.modifiedAt ? `${base} · edited ${shortDate(items[i]!.modifiedAt)}` : `${base} (${i + 1})`;
  });
}

/** Spark writes through a WAL; read a private copy so Spark can keep running and nothing of theirs is touched. */
function withCopy<T>(path: string, fn: (db: DatabaseSync) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "flint-spark-"));
  try {
    const copy = join(dir, "settings.sqlite");
    copyFileSync(path, copy);
    for (const suffix of ["-wal", "-shm"]) if (existsSync(path + suffix)) copyFileSync(path + suffix, copy + suffix);
    const db = new DatabaseSync(copy);
    try {
      return fn(db);
    } finally {
      db.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const text = (v: unknown): string => (v instanceof Uint8Array ? Buffer.from(v).toString("utf8") : String(v ?? ""));

/** Reads every live signature from a Spark Desktop settings.sqlite, with the accounts each one is the default for. */
export function readSparkSignatures(path: string): SparkSignature[] {
  if (!existsSync(path)) throw new FlintError("not_found", "Couldn't find Spark's settings on this Mac.");
  try {
    return withCopy(path, (db) => {
      const rows = db.prepare("SELECT itemValue FROM settings WHERE itemGroup = 'SignaturesSettingsItemsGroup'").all() as { itemValue: unknown }[];
      const bindingRow = db.prepare("SELECT itemValue FROM settings WHERE itemGroup = 'MetaSettingsItemsGroup' AND itemKey = 'MetaBindingSettingsKey'").get() as { itemValue: unknown } | undefined;
      const bound = bindingRow ? bindings.safeParse(JSON.parse(text(bindingRow.itemValue))) : null;
      const byId = new Map<string, string[]>();
      for (const [email, id] of Object.entries(bound?.success ? bound.data : {})) byId.set(id, [...(byId.get(id) ?? []), email.toLowerCase()]);

      const live = rows
        .map((r) => { try { return signatureRow.safeParse(JSON.parse(text(r.itemValue))); } catch { return null; } })
        .flatMap((r) => (r?.success && !r.data.deleted ? [r.data] : []))
        .map((s) => ({ s, html: cleanSignatureHtml(s.htmlContent), modifiedAt: fromAppleTime(s.modificationDate ?? s.creationDate) }))
        .filter((x) => x.html.length > 0)
        .sort((a, b) => (b.s.modificationDate ?? 0) - (a.s.modificationDate ?? 0));
      const names = nameSignatures(live);
      return live.map(({ s, html, modifiedAt }, i) => ({
        sparkId: s.identifier,
        name: names[i]!,
        html,
        accounts: (byId.get(s.identifier) ?? []).sort(),
        modifiedAt,
      }));
    });
  } catch (error) {
    if (error instanceof FlintError) throw error;
    throw new FlintError("invalid", "That file isn't a Spark settings database Flint can read.");
  }
}
