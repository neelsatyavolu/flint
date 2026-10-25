import type { NotifyRequest } from "../platform";
import type { FlintEvent, Settings } from "../types";

export type NewMailEvent = Extract<FlintEvent, { type: "new_mail" }>;
export type NotifySettings = Settings["notifications"];

const PREVIEW_CHARS = 140;
/** Group key shared by every summary alert, so a newer summary replaces the older one. */
export const SUMMARY_GROUP = "new-mail-summary";

/** Whether one new message should alert under the current settings. */
export function wantsAlert(n: NotifySettings, e: NewMailEvent): boolean {
  if (!n.enabled || n.scope === "none") return false;
  if (n.disabledAccounts.includes(e.accountId)) return false;
  if (n.scope === "people") return e.category === "people" || e.forced === true;
  return true;
}

/** The sound for an alert: null = silent, undefined = the system default, otherwise a macOS system sound name. */
export function soundFor(n: Pick<NotifySettings, "sound" | "soundName">): string | null | undefined {
  if (!n.sound) return null;
  return n.soundName === "default" ? undefined : n.soundName;
}

const cut = (s: string): string => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > PREVIEW_CHARS ? `${t.slice(0, PREVIEW_CHARS - 1).trimEnd()}...` : t;
};

const senderOf = (e: NewMailEvent): string => e.from.name.trim() || e.from.address || "Someone";

function single(n: NotifySettings, e: NewMailEvent): NotifyRequest {
  const base = { threadId: e.threadId, group: `thread-${e.threadId}`, actions: true, sound: soundFor(n) };
  if (n.preview === "none") return { ...base, title: "New mail", body: "" };
  const subject = e.subject.trim() || "(No subject)";
  const line = n.preview === "sender_subject_line" && e.snippet ? `\n${cut(e.snippet)}` : "";
  return { ...base, title: senderOf(e), body: `${subject}${line}` };
}

/** "Ann", "Ann and Bo", "Ann, Bo and 2 others" over distinct senders in arrival order. */
function senderList(events: NewMailEvent[]): string {
  const names = [...new Set(events.map(senderOf))];
  if (names.length === 1) return names[0]!;
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names[0]}, ${names[1]} and ${names.length - 2} others`;
}

/**
 * One alert for a burst of new mail. A burst in a single thread is shown as that thread's latest message; several threads
 * collapse into a "N new messages" summary that replaces any earlier summary. Returns null when nothing should alert.
 */
export function alertFor(n: NotifySettings, events: NewMailEvent[]): NotifyRequest | null {
  const wanted = events.filter((e) => wantsAlert(n, e));
  const last = wanted[wanted.length - 1];
  if (!last) return null;
  if (new Set(wanted.map((e) => e.threadId)).size === 1) return single(n, last);
  return {
    title: `${wanted.length} new messages`,
    body: n.preview === "none" ? "" : `From ${senderList(wanted)}`,
    group: SUMMARY_GROUP,
    sound: soundFor(n),
  };
}
