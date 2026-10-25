import type { ErrorCode, ErrorResponse } from "./protocol";

const STATUS: Record<ErrorCode, number> = {
  bad_request: 400, unauthorized: 401, not_found: 404, method_not_allowed: 405, conflict: 409,
  payload_too_large: 413, rate_limited: 429, internal: 500,
};

export class HttpError extends Error {
  constructor(readonly code: ErrorCode, message: string) {
    super(message);
  }
}

// No Access-Control-* headers anywhere: CORS stays closed.
const BASE_HEADERS = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...BASE_HEADERS, "Content-Type": "application/json" } });
}

export function errorResponse(code: ErrorCode, message: string, extraHeaders: Record<string, string> = {}): Response {
  const body: ErrorResponse = { error: { code, message } };
  return new Response(JSON.stringify(body), {
    status: STATUS[code],
    headers: { ...BASE_HEADERS, "Content-Type": "application/json", ...extraHeaders },
  });
}

export function fromError(err: unknown): Response {
  if (err instanceof HttpError) return errorResponse(err.code, err.message);
  console.error("receipts: unhandled error", err instanceof Error ? err.message : String(err));
  return errorResponse("internal", "Something went wrong on the server.");
}
