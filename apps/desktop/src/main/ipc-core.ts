import { FLINT_METHODS, type FlintMethod } from "@flint/core/api";
import { join } from "node:path";
import { z } from "zod";

const METHOD_SET: ReadonlySet<string> = new Set(FLINT_METHODS);

const callSchema = z.object({
  method: z.string().refine((m) => METHOD_SET.has(m), { message: "unknown method" }),
  args: z.array(z.unknown()),
});

export type ParsedCall = { method: FlintMethod; args: unknown[] };
export type SerializedError = { code: string; message: string };
export type CallResult = { ok: true; value: unknown } | { ok: false; error: SerializedError };

/** The folder of the built extension for one browser family inside the bundled extension folder, or null for anything else. */
export function extensionFolder(extensionDir: string | null, family: unknown): string | null {
  if (!extensionDir || (family !== "chromium" && family !== "firefox")) return null;
  return join(extensionDir, family);
}

/** Validates the raw arguments of a 'flint:call' invocation. Throws on anything unexpected. */
export function parseCall(method: unknown, args: unknown): ParsedCall {
  const parsed = callSchema.safeParse({ method, args });
  if (!parsed.success) {
    throw Object.assign(new Error("Invalid call"), { code: "invalid" });
  }
  return { method: parsed.data.method as FlintMethod, args: parsed.data.args };
}

export function serializeError(err: unknown): SerializedError {
  if (err instanceof Error) {
    const code = (err as { code?: unknown }).code;
    return { code: typeof code === "string" ? code : "internal", message: err.message };
  }
  return { code: "internal", message: typeof err === "string" ? err : "Something went wrong" };
}

/** Runs a validated call against the service and wraps the outcome in a result envelope. */
export async function dispatchCall(
  api: Partial<Record<string, (...a: unknown[]) => unknown>>,
  method: unknown,
  args: unknown,
): Promise<CallResult> {
  try {
    const call = parseCall(method, args);
    const fn = api[call.method];
    if (typeof fn !== "function") {
      return { ok: false, error: { code: "invalid", message: "Unknown method" } };
    }
    const value = await fn.apply(api, call.args);
    return { ok: true, value: value === undefined ? null : value };
  } catch (err) {
    return { ok: false, error: serializeError(err) };
  }
}

/**
 * True when the URL belongs to the app origin. Compares protocol and host
 * because Node reports an opaque origin ("null") for custom schemes.
 */
export function isSameOrigin(url: string | undefined | null, origin: string): boolean {
  if (!url) return false;
  try {
    const a = new URL(url);
    const b = new URL(origin);
    return a.protocol === b.protocol && a.host === b.host;
  } catch {
    return false;
  }
}

export const isTrustedFrameUrl = isSameOrigin;

const EXTERNAL_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

export function isSafeExternalUrl(url: unknown): url is string {
  if (typeof url !== "string" || url.length > 8192) return false;
  try {
    return EXTERNAL_PROTOCOLS.has(new URL(url).protocol);
  } catch {
    return false;
  }
}
