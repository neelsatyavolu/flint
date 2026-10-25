import { z } from "zod";

/**
 * Wire schemas for the Flint receipts service.
 * Mirrors services/receipts/src/protocol.ts (copied, not imported, so core does not
 * depend on the Worker package or its Cloudflare types). Keep the two in step.
 */

export const TOKEN_RE = /^[A-Za-z0-9_-]{22}$/;
export const MAX_RECIPIENTS = 100;
export const MAX_EVENTS_LIMIT = 500;

export const EventKindSchema = z.enum(["open", "prefetch", "scanner", "self", "bot", "duplicate"]);

export const InstallResponseSchema = z.object({ installId: z.string().min(1), secret: z.string().min(1) });
export type InstallResponse = z.infer<typeof InstallResponseSchema>;

export const RegisterMessageRequestSchema = z.object({
  ref: z.string().min(1).max(256),
  recipients: z.array(z.object({ token: z.string().regex(TOKEN_RE) })).min(1).max(MAX_RECIPIENTS),
});
export type RegisterMessageRequest = z.infer<typeof RegisterMessageRequestSchema>;

export const ReceiptEventSchema = z.object({
  id: z.number().int(),
  token: z.string(),
  at: z.number().int(),
  kind: EventKindSchema,
  client: z.string().nullable(),
  device: z.string().nullable(),
  country: z.string().nullable(),
  city: z.string().nullable(),
  fingerprint: z.string(),
  possiblyForwarded: z.boolean(),
});
export type ReceiptEvent = z.infer<typeof ReceiptEventSchema>;

export const EventsResponseSchema = z.object({ events: z.array(ReceiptEventSchema), cursor: z.string() });
export type EventsResponse = z.infer<typeof EventsResponseSchema>;

export const ErrorResponseSchema = z.object({ error: z.object({ code: z.string(), message: z.string() }) });

export const RegisterMessageResponseSchema = z.object({ ref: z.string(), recipients: z.number().int() });
export const OkResponseSchema = z.object({ ok: z.literal(true) });
