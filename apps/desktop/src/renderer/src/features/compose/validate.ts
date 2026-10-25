import type { Address } from "@flint/core";
import { countRecipients } from "./recipients";

export type SendCheck = "ok" | "no_recipients" | "no_subject";

/** Decides whether a draft can go out now. A missing subject is a soft stop the user can confirm past. */
export function checkSend(draft: { to: Address[]; cc: Address[]; bcc: Address[]; subject: string }): SendCheck {
  if (countRecipients(draft) === 0) return "no_recipients";
  if (draft.subject.trim() === "") return "no_subject";
  return "ok";
}
