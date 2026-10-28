import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Shared JSON fixtures: the contract between the TypeScript engine and the Swift port (docs/ios/DESIGN-NOTES.md section 5).
 * One file per module, `{ meta, cases: [{ name, input, expect }] }`. The desktop vitest suites read them through
 * `loadFixture`; the iOS package gets copies from `apps/ios/scripts/sync-fixtures.sh`.
 * A behavior change to a ported module edits its fixture in the same commit.
 */
export type FixtureCase<I = Record<string, unknown>, E = unknown> = { name: string; input: I; expect: E };
export type FixtureMeta = { version: number; module: string; source: string; [key: string]: unknown };
export type Fixture<I = Record<string, unknown>, E = unknown, M extends object = object> = { meta: FixtureMeta & M; cases: FixtureCase<I, E>[]; [key: string]: unknown };

export const FIXTURE_NAMES = [
  "categorize", "codes", "search", "threadkey", "rules", "receipts-status", "receipts-pixel", "trackers", "providers", "sanitize", "tokens",
] as const;
export type FixtureName = (typeof FIXTURE_NAMES)[number];

// Not `new URL(..., import.meta.url)`: Vite rewrites that form into an asset URL.
const DIR = dirname(fileURLToPath(import.meta.url));
const pathOf = (name: string): string => join(DIR, `${name}.json`);

/** Reads and shape-checks one fixture. Throws on a malformed file so a bad edit fails every suite that uses it. */
export function loadFixture<I = Record<string, unknown>, E = unknown, M extends object = object>(name: FixtureName): Fixture<I, E, M> {
  const f = JSON.parse(readFileSync(pathOf(name), "utf8")) as Fixture<I, E, M>;
  if (!Number.isInteger(f.meta?.version) || f.meta.version < 1) throw new Error(`${name}.json: meta.version must be a positive integer`);
  if (!Array.isArray(f.cases) || f.cases.length === 0) throw new Error(`${name}.json: cases must be a non-empty array`);
  const seen = new Set<string>();
  for (const c of f.cases) {
    if (typeof c.name !== "string" || !c.name || seen.has(c.name)) throw new Error(`${name}.json: missing or duplicate case name "${c.name}"`);
    if (c.input === undefined || !("expect" in c)) throw new Error(`${name}.json: case "${c.name}" needs input and expect`);
    seen.add(c.name);
  }
  return f;
}

/** Stable text form: `meta` and data fields indented, one case per line so diffs stay reviewable. */
export function stringifyFixture(f: Fixture): string {
  const { cases, ...rest } = f;
  const head = JSON.stringify(rest, null, 2).replace(/\n}$/, "");
  const body = cases.map((c) => `    ${JSON.stringify(c)}`).join(",\n");
  return `${head},\n  "cases": [\n${body}\n  ]\n}\n`;
}

export const UPDATE_REQUESTED = process.env.FLINT_FIXTURES_UPDATE === "1";

/**
 * For data generated from a TypeScript or CSS source (tracker rules, design tokens). With FLINT_FIXTURES_UPDATE=1 the
 * file is rewritten from `value`; otherwise nothing is written and the caller asserts the stored value equals the source.
 */
export function refreshData(name: FixtureName, key: string, value: unknown): void {
  if (!UPDATE_REQUESTED) return;
  const f = loadFixture(name);
  f[key] = value;
  writeFileSync(pathOf(name), stringifyFixture(f));
}

/** Local-calendar-day string (YYYY-MM-DD) for an epoch-ms value, so search fixtures do not depend on the machine's time zone. */
export function dayString(ms: number | null): string | null {
  if (ms === null) return null;
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
