import { z } from "zod";

/** Wire types and schemas for the Flint receipts service. The desktop client mirrors these. */

export const TOKEN_RE = /^[A-Za-z0-9_-]{22}$/;
export const MAX_RECIPIENTS = 100;
export const MAX_BODY_BYTES = 32 * 1024;
export const MAX_EVENTS_LIMIT = 500;

export const EventKindSchema = z.enum(["open", "prefetch", "scanner", "self", "bot", "duplicate"]);
export type EventKind = z.infer<typeof EventKindSchema>;

export const TokenSchema = z.string().regex(TOKEN_RE);

export const InstallResponseSchema = z.object({ installId: z.string(), secret: z.string() });
export type InstallResponse = z.infer<typeof InstallResponseSchema>;

export const RegisterMessageRequestSchema = z.object({
  ref: z.string().min(1).max(256),
  recipients: z.array(z.object({ token: TokenSchema })).min(1).max(MAX_RECIPIENTS),
});
export type RegisterMessageRequest = z.infer<typeof RegisterMessageRequestSchema>;

export const RegisterMessageResponseSchema = z.object({ ref: z.string(), recipients: z.number().int() });
export type RegisterMessageResponse = z.infer<typeof RegisterMessageResponseSchema>;

export const OkResponseSchema = z.object({ ok: z.literal(true) });
export type OkResponse = z.infer<typeof OkResponseSchema>;

export const EventsQuerySchema = z.object({
  after: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(MAX_EVENTS_LIMIT).default(MAX_EVENTS_LIMIT),
});
export type EventsQuery = z.infer<typeof EventsQuerySchema>;

export const ReceiptEventSchema = z.object({
  id: z.number().int(),
  token: z.string(),
  at: z.number().int(), // epoch ms
  kind: EventKindSchema,
  client: z.string().nullable(),
  device: z.string().nullable(),
  country: z.string().nullable(),
  city: z.string().nullable(),
  fingerprint: z.string(), // per-install re-hash
  possiblyForwarded: z.boolean(),
});
export type ReceiptEvent = z.infer<typeof ReceiptEventSchema>;

export const EventsResponseSchema = z.object({ events: z.array(ReceiptEventSchema), cursor: z.string() });
export type EventsResponse = z.infer<typeof EventsResponseSchema>;

export const ErrorCodeSchema = z.enum([
  "bad_request", "unauthorized", "not_found", "method_not_allowed", "conflict", "payload_too_large", "rate_limited", "internal",
]);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;
export const ErrorResponseSchema = z.object({ error: z.object({ code: ErrorCodeSchema, message: z.string() }) });
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
