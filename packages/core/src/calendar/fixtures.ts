import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseInvite } from "./parse";
import type { ParsedInvite } from "./contracts";

const dir = join(fileURLToPath(new URL(".", import.meta.url)), "__fixtures__");

/** Test helper: the text of a fixture .ics file. */
export const fixture = (name: string): string => readFileSync(join(dir, name), "utf8");

export const OWN = ["me@example.com"];
export const NOW = Date.UTC(2026, 9, 25, 16, 0, 0);

/** Test helper: parse a fixture as the user me@example.com on 2026-10-25. */
export function parsed(name: string): ParsedInvite {
  const invite = parseInvite(fixture(name), { ownAddresses: OWN, now: NOW });
  if (!invite) throw new Error(`fixture ${name} did not parse`);
  return invite;
}
