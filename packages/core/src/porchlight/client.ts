import { z } from "zod";
import { PORCHLIGHT_ORIGIN } from "../store/porchlight";
import type { PorchlightCarrierId } from "./carriers";

/** One item of POST /v1/imports/flint. Exactly these fields: never bodies (Porchlight SPEC §7). */
export type FlintImportItem = {
  trackingNumber: string;
  carrier?: PorchlightCarrierId;
  merchant: string | null;
  subject: string | null;
  messageDate: string;
  dedupeKey: string;
};
export type ImportResult = { dedupeKey: string; packageId: string | null; outcome: "created" | "updated" | "unchanged" | "rejected"; reason?: string };

/** A response that was not a success. `status` 0 means the request never got an answer (offline, timeout). */
export class PorchlightHttpError extends Error {
  constructor(readonly status: number, readonly retryAfterMs: number) {
    super(status === 0 ? "Porchlight could not be reached" : `Porchlight answered HTTP ${status}`);
    this.name = "PorchlightHttpError";
  }
}

const UUID = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
const Claim = z.object({ token: z.string().regex(/^plt_[A-Za-z0-9_-]{16,200}$/), tokenId: UUID, scopes: z.array(z.string()) });
const Imports = z.object({
  results: z.array(z.object({
    dedupeKey: z.string(), packageId: UUID.nullable(), outcome: z.enum(["created", "updated", "unchanged", "rejected"]), reason: z.string().optional(),
  })),
});
const Envelope = z.object({ ok: z.literal(true), data: z.unknown() });

const TIMEOUT_MS = 15_000;

export class PorchlightClient {
  constructor(private fetchImpl: typeof fetch, private origin: string = PORCHLIGHT_ORIGIN) {}

  /** POST /v1/pairing/claim. No auth: the one-time code is the credential. */
  async claim(code: string, label: string): Promise<z.infer<typeof Claim>> {
    return this.#call("POST", "/v1/pairing/claim", null, { code, label }, Claim);
  }

  /** POST /v1/imports/flint with 1-100 items. */
  async importFlint(token: string, items: FlintImportItem[]): Promise<ImportResult[]> {
    return (await this.#call("POST", "/v1/imports/flint", token, { items }, Imports)).results;
  }

  /** DELETE /v1/tokens/:id. Porchlight accepts this only from a signed-in session today, so false is the usual answer. */
  async revoke(token: string, tokenId: string): Promise<boolean> {
    try {
      await this.#call("DELETE", `/v1/tokens/${encodeURIComponent(tokenId)}`, token, undefined, z.unknown());
      return true;
    } catch {
      return false;
    }
  }

  async #call<T extends z.ZodType>(method: string, path: string, token: string | null, body: unknown, schema: T): Promise<z.infer<T>> {
    const headers: Record<string, string> = { accept: "application/json" };
    if (body !== undefined) headers["content-type"] = "application/json";
    if (token) headers.authorization = `Bearer ${token}`;
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.origin}${path}`, {
        method, headers, redirect: "error", signal: AbortSignal.timeout(TIMEOUT_MS),
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch {
      throw new PorchlightHttpError(0, 0);
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      const retryAfter = response.headers.get("retry-after")?.trim();
      throw new PorchlightHttpError(response.status, retryAfter && /^\d+$/.test(retryAfter) ? Number(retryAfter) * 1_000 : 0);
    }
    const outer = Envelope.safeParse(await response.json().catch(() => null));
    const parsed = outer.success ? schema.safeParse(outer.data.data) : null;
    // A 2xx we can't read is treated like a server error, so queued imports retry rather than vanish.
    if (!parsed?.success) throw new PorchlightHttpError(502, 0);
    return parsed.data as z.infer<T>;
  }
}
