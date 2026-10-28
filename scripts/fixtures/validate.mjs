#!/usr/bin/env node
// Structural check of packages/core/fixtures/*.json: every expected file exists, has meta.version, and has uniquely named cases.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = join(dirname(fileURLToPath(import.meta.url)), "../../packages/core/fixtures");
const EXPECTED = ["categorize", "codes", "search", "threadkey", "rules", "receipts-status", "receipts-pixel", "trackers", "providers", "sanitize", "tokens"];
const errors = [];
const files = readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5));
for (const name of EXPECTED) if (!files.includes(name)) errors.push(`${name}.json is missing`);
for (const name of files) {
  let f;
  try { f = JSON.parse(readFileSync(join(dir, `${name}.json`), "utf8")); } catch (e) { errors.push(`${name}.json: ${e.message}`); continue; }
  if (!Number.isInteger(f.meta?.version) || f.meta.version < 1) errors.push(`${name}.json: meta.version must be a positive integer`);
  if (!Array.isArray(f.cases) || f.cases.length === 0) { errors.push(`${name}.json: cases must be a non-empty array`); continue; }
  const seen = new Set();
  for (const c of f.cases) {
    if (typeof c.name !== "string" || !c.name || seen.has(c.name)) errors.push(`${name}.json: missing or duplicate case name ${JSON.stringify(c.name)}`);
    seen.add(c.name);
    if (c.input === undefined || !("expect" in c)) errors.push(`${name}.json: case ${JSON.stringify(c.name)} needs input and expect`);
  }
}
if (errors.length) { console.error(errors.join("\n")); process.exit(1); }
console.log(`fixtures ok (${files.length} files)`);
