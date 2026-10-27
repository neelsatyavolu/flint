import type { PairingUiEvent } from "@flint/core/pairing/controller";

/** What the dialog shows. Built from the main process's events and nothing else. */
export type PairingView =
  | { step: "starting" }
  | { step: "listening"; svg: string; expiresAt: number; addrs: string[] }
  | { step: "approval"; deviceName: string; sas: string; passwordAccounts: number }
  | { step: "sending" }
  | { step: "done"; deviceName: string; counts: Extract<PairingUiEvent, { type: "done" }>["counts"] }
  | { step: "ended"; message: string; retry: boolean };

export const START: PairingView = { step: "starting" };

const ENDED: Record<Extract<PairingUiEvent, { type: "closed" }>["reason"], { message: string; retry: boolean }> = {
  expired: { message: "The code expired. Show a new one when you are ready.", retry: true },
  cancelled: { message: "Pairing cancelled.", retry: true },
  denied: { message: "Pairing cancelled. Nothing was sent.", retry: true },
  too_many_attempts: { message: "Too many failed attempts, so Flint closed this code. Show a new one.", retry: true },
  connection_lost: { message: "The iPhone disconnected before it finished. Nothing was saved on your Mac.", retry: true },
  failed: { message: "Pairing didn't complete. Nothing was sent that your iPhone could use. Show a new code to try again.", retry: true },
  no_ack: { message: "The iPhone didn't confirm that it finished. Check your iPhone, then pair again if the accounts are missing.", retry: true },
};

/** Pure: the next view for an event. A closed event after "done" does not replace the summary. */
export function nextView(view: PairingView, event: PairingUiEvent): PairingView {
  switch (event.type) {
    case "listening": return { step: "listening", svg: event.svg, expiresAt: event.expiresAt, addrs: event.addrs };
    case "approval": return { step: "approval", deviceName: event.deviceName, sas: event.sas, passwordAccounts: event.passwordAccounts };
    case "sending": return { step: "sending" };
    case "done": return { step: "done", deviceName: event.deviceName, counts: event.counts };
    case "closed": return view.step === "done" ? view : { step: "ended", ...ENDED[event.reason] };
    case "error": return { step: "ended", message: event.message, retry: true };
  }
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** "Added 2 accounts, 1 signature, 12 rules." Zero counts are left out. */
export function countsSentence(c: Extract<PairingUiEvent, { type: "done" }>["counts"]): string {
  const parts = [
    c.accounts && plural(c.accounts, "account", "accounts"), c.signatures && plural(c.signatures, "signature", "signatures"),
    c.templates && plural(c.templates, "template", "templates"), c.rules && plural(c.rules, "rule", "rules"),
    c.blockedSenders && plural(c.blockedSenders, "blocked sender", "blocked senders"),
  ].filter(Boolean);
  return parts.length ? `Added ${parts.join(", ")}.` : "Nothing new to add. Your iPhone already had everything.";
}

/** m:ss until `expiresAt`, never negative. */
export function countdown(expiresAt: number, now: number): string {
  const s = Math.max(0, Math.ceil((expiresAt - now) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
