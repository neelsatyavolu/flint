import { createHash } from "node:crypto";
import { z } from "zod";
import { assertPublicConnectorUrl } from "./network";
import type { ConnectorManifest, RuleCondition } from "../types";

/**
 * Remote patterns run in the main process through the existing rule matcher. Keep their regex subset small:
 * no backreferences/lookaround, repeated groups, or multiple variable repetitions. Fixed repeats are bounded.
 * This is deliberately more restrictive than rules the user writes locally.
 */
function safeRemotePattern(pattern: string): boolean {
  let inClass = false;
  let variableRepetitions = 0;
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i];
    if (char === "\\") {
      if (!inClass && /[1-9k]/.test(pattern[i + 1] ?? "")) return false;
      i++;
      continue;
    }
    if (char === "[") { inClass = true; continue; }
    if (char === "]") { inClass = false; continue; }
    if (inClass) continue;
    if (char === "(" && pattern[i + 1] === "?") {
      if (pattern[i + 2] !== ":") return false;
      i += 2;
      continue;
    }
    if (char === ")" && /^[*+?{]/.test(pattern[i + 1] ?? "")) return false;
    if (char === "*" || char === "+" || char === "?") {
      variableRepetitions++;
      if (pattern[i + 1] === "?") i++; // Lazy modifier belongs to the same repetition.
    }
    if (char === "{") {
      const repeat = /^\{(\d+)(?:,(\d*))?\}/.exec(pattern.slice(i));
      if (!repeat) continue;
      if (Number(repeat[1]) > 1_000 || (repeat[2] && Number(repeat[2]) > 1_000)) return false;
      if (repeat[2] !== undefined && repeat[2] !== repeat[1]) variableRepetitions++;
      i += repeat[0].length - 1;
      if (pattern[i + 1] === "?") i++;
    }
    if (variableRepetitions > 1) return false;
  }
  return true;
}

const conditionSchema = z.object({
  field: z.enum(["from", "to", "cc", "subject", "body", "any_recipient", "list_id", "has_attachment"]),
  op: z.enum(["contains", "equals", "ends_with", "matches", "is_true"]),
  value: z.string(),
}).strict().superRefine((condition, ctx) => {
  const fail = (message: string) => ctx.addIssue({ code: "custom", message });
  if (condition.field === "has_attachment") {
    if (condition.op !== "is_true") fail("Attachment conditions must use is_true.");
    return;
  }
  if (!condition.value.trim()) { fail("Match conditions need a nonempty value."); return; }
  if (condition.op === "is_true") fail("is_true is only supported for attachments.");
  if (condition.op !== "matches") return;
  if (condition.value.length > 200) { fail("Match patterns must be at most 200 characters."); return; }
  try {
    const pattern = new RegExp(condition.value, "i");
    if (!safeRemotePattern(condition.value)) {
      fail("Connector patterns cannot use repeated groups, backreferences, lookaround or multiple variable repetitions.");
      return;
    }
    // Empty-string matches are unconditional substring matches, even when wrapped in groups or alternatives.
    const probes = ["a", "z", "0", " ", "hello world", "someone@example.test", "A\nB"];
    if (pattern.test("") || probes.every((probe) => pattern.test(probe))) fail("Match patterns must not match all mail.");
  } catch { fail("Invalid match pattern."); }
});

const manifestSchema = z.object({
  flintConnector: z.literal(1),
  id: z.string().trim().min(1),
  name: z.string().trim().min(1),
  description: z.string(),
  homepage: z.string(),
  pairPage: z.string(),
  pairEndpoint: z.string(),
  deliverEndpoint: z.string(),
  revokeEndpoint: z.string(),
  match: z.object({ any: z.array(conditionSchema), schemaTypes: z.array(z.string().trim().min(1)) }).strict(),
  fields: z.array(z.enum(["messageId", "from", "to", "subject", "date", "text", "html"])).min(1),
  historyDays: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER / 86_400_000),
}).strict();

function httpsUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.hash) {
    throw new Error("Connected app URLs must use HTTPS without credentials or fragments.");
  }
  return url;
}

export function manifestUrlFor(input: string): string {
  const url = httpsUrl(input.trim());
  if (url.pathname === "/" && !url.search) url.pathname = "/.well-known/flint-connector.json";
  return url.href;
}

export function validateManifest(value: unknown, manifestUrl: string): ConnectorManifest {
  const origin = httpsUrl(manifestUrl);
  const manifest = manifestSchema.parse(value);
  for (const field of ["homepage", "pairPage", "pairEndpoint", "deliverEndpoint", "revokeEndpoint"] as const) {
    if (httpsUrl(manifest[field]).host !== origin.host) throw new Error(`${field} must be on the manifest's own host.`);
  }
  return manifest;
}

export async function fetchManifest(url: string, fetchImpl: typeof fetch, checkUrl = assertPublicConnectorUrl): Promise<ConnectorManifest> {
  httpsUrl(url);
  await checkUrl(url);
  const response = await fetchImpl(url, { redirect: "error", signal: AbortSignal.timeout(15_000), headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`Couldn't load the connector manifest (HTTP ${response.status}).`);
  const reader = response.body?.getReader();
  if (!reader) throw new Error("The connector manifest is empty.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 1_048_576) throw new Error("The connector manifest is too large.");
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  return validateManifest(JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown, url);
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** v1 does not prescribe serialization: hash sorted object keys, retaining array order, as UTF-8 JSON. */
export function manifestHash(manifest: ConnectorManifest): string {
  return createHash("sha256").update(canonical(manifest)).digest("hex");
}

function conditionWithin(next: RuleCondition, approved: RuleCondition): boolean {
  if (next.field !== approved.field || next.op !== approved.op) return false;
  if (next.field === "has_attachment") return true;
  // Regex implication is intentionally not guessed. A changed regex needs fresh consent.
  if (next.op === "matches") return next.value === approved.value;
  const value = next.value.toLowerCase();
  const before = approved.value.toLowerCase();
  if (next.op === "contains") return value.includes(before);
  if (next.op === "ends_with") return value.endsWith(before);
  return value === before;
}

/** Only provable subsets are silently adopted. Changing a destination also requires consent. */
export function needsApproval(approved: ConnectorManifest, next: ConnectorManifest): boolean {
  if (next.id !== approved.id || next.historyDays > approved.historyDays) return true;
  for (const field of ["homepage", "pairPage", "pairEndpoint", "deliverEndpoint", "revokeEndpoint"] as const) {
    if (next[field] !== approved[field]) return true;
  }
  return next.fields.some((field) => !approved.fields.includes(field)) ||
    next.match.schemaTypes.some((type) => !approved.match.schemaTypes.includes(type)) ||
    next.match.any.some((condition) => !approved.match.any.some((old) => conditionWithin(condition, old)));
}
