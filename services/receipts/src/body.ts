import type { z } from "zod";
import { MAX_BODY_BYTES } from "./protocol";
import { HttpError } from "./http";

export async function parseJsonBody<S extends z.ZodType>(request: Request, schema: S): Promise<z.infer<S>> {
  const declared = Number(request.headers.get("Content-Length") ?? "0");
  if (declared > MAX_BODY_BYTES) throw new HttpError("payload_too_large", "Request body is too large.");
  const text = await request.text();
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) throw new HttpError("payload_too_large", "Request body is too large.");
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new HttpError("bad_request", "Body must be valid JSON.");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new HttpError("bad_request", `Invalid request: ${issue ? `${issue.path.join(".") || "body"} ${issue.message}` : "body"}.`);
  }
  return parsed.data;
}
