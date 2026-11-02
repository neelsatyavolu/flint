import { matchCondition, type RuleMessage } from "../rules";
import type { ConnectorManifest } from "../types";

function schemaType(value: string): string {
  return value.replace(/^https?:\/\/schema\.org\//, "");
}

function hasSchemaType(value: unknown, wanted: Set<string>): boolean {
  const pending: unknown[] = [value];
  while (pending.length) {
    const node = pending.pop();
    if (!node || typeof node !== "object") continue;
    if (Array.isArray(node)) { pending.push(...node); continue; }
    const record = node as Record<string, unknown>;
    const types = Array.isArray(record["@type"]) ? record["@type"] : [record["@type"]];
    if (types.some((type) => typeof type === "string" && wanted.has(schemaType(type)))) return true;
    // Includes @graph, root arrays and nested reservations without executing any HTML.
    pending.push(...Object.values(record));
  }
  return false;
}

export function matchesConnector(manifest: ConnectorManifest, message: RuleMessage, html: string | null): boolean {
  if (manifest.match.any.some((condition) => matchCondition(condition, message))) return true;
  if (!html || manifest.match.schemaTypes.length === 0) return false;
  const wanted = new Set(manifest.match.schemaTypes.map(schemaType));
  for (const script of html.matchAll(/<!--[\s\S]*?-->|<script\b((?:"[^"]*"|'[^']*'|[^'">])*)>([\s\S]*?)<\/script\s*>/gi)) {
    if (script[1] === undefined) continue; // A commented-out block is not a script element.
    let type: string | undefined;
    for (const attribute of script[1].matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
      if (attribute[1]?.toLowerCase() === "type" && type === undefined) type = attribute[2] ?? attribute[3] ?? attribute[4] ?? "";
    }
    if (type?.toLowerCase() !== "application/ld+json") continue;
    try {
      if (hasSchemaType(JSON.parse(script[2] ?? "") as unknown, wanted)) return true;
    } catch { /* One invalid block does not hide another valid JSON-LD block. */ }
  }
  return false;
}
