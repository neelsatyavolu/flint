import { z } from "zod";

const itemSchema = z.object({
  threadId: z.number().int().positive(),
  subject: z.string(),
  from: z.object({ name: z.string(), address: z.string() }),
  date: z.number(),
  unreadCount: z.number().int().nonnegative(),
  reason: z.enum(["question", "request"]),
});
export type NeedsReplyRow = z.infer<typeof itemSchema>;

/** The needs-reply task answers with JSON text. Anything unreadable becomes an empty list. */
export function parseNeedsReply(text: string): NeedsReplyRow[] {
  try {
    const parsed = z.array(itemSchema).safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

export const REASON_LABEL: Record<NeedsReplyRow["reason"], string> = { question: "Asks a question", request: "Asks for something" };
