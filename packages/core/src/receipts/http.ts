import type { ZodType } from "zod";
import { FlintError } from "../types";
import { ErrorResponseSchema } from "./protocol";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** The service answered with a non-2xx status. */
export class ServiceHttpError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
    this.name = "ServiceHttpError";
  }
}

export type CallOptions = {
  fetch: FetchLike;
  baseUrl: string;
  timeoutMs: number;
  bearer?: string;
};

/** One JSON call to the receipts service. Throws ServiceHttpError for HTTP errors and FlintError('network') for transport or shape problems. */
export async function callService<T>(
  opts: CallOptions,
  method: "GET" | "POST" | "DELETE",
  path: string,
  schema: ZodType<T>,
  body?: unknown,
): Promise<T> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (opts.bearer) headers.authorization = `Bearer ${opts.bearer}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  let res: Response;
  try {
    res = await opts.fetch(`${opts.baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(opts.timeoutMs),
    });
  } catch {
    throw new FlintError("network", "Couldn't reach the receipts service.");
  }
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  if (!res.ok) {
    const err = ErrorResponseSchema.safeParse(json);
    throw new ServiceHttpError(res.status, err.success ? err.data.error.code : "unknown", err.success ? err.data.error.message : `HTTP ${res.status}`);
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) throw new FlintError("network", "The receipts service sent an unexpected reply.");
  return parsed.data;
}
