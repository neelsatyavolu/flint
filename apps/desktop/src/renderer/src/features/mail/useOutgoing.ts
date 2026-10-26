import { useEffect, useRef, useState } from "react";
import type { MessageView, OutgoingSend, ThreadDetail } from "@flint/core";
import type { Departed } from "./OutgoingCard";

/** How long a sent reply's card waits for its Sent copy before it goes anyway. */
export const DEPARTED_MAX_MS = 60_000;

type Snapshot = { outgoing: OutgoingSend[]; draftIds: number[]; messages: Pick<MessageView, "isFromMe" | "date">[] };

/** True once the thread holds a message of ours dated at or after the send (its Sent copy synced in). */
const arrived = (d: Departed, messages: Snapshot["messages"]): boolean => messages.some((m) => m.isFromMe && m.date >= d.sendAt - 5_000);

/**
 * The sends whose cards stay up as "Sent": a queued send that left the thread's outgoing list without its draft coming
 * back (an undo or a failure brings the draft back) went out, and keeps its card until the real message shows up.
 */
export function settleDeparted(prevOutgoing: OutgoingSend[], departed: Departed[], next: Snapshot, now: number): Departed[] {
  const gone = prevOutgoing
    .filter((p) => !next.outgoing.some((o) => o.scheduledId === p.scheduledId) && !next.draftIds.includes(p.draftId))
    .filter((p) => !departed.some((d) => d.scheduledId === p.scheduledId))
    .map((p) => ({ ...p, goneAt: now }));
  return [...departed, ...gone].filter((d) => now - d.goneAt < DEPARTED_MAX_MS && !arrived(d, next.messages));
}

export type OutgoingCardItem = { send: OutgoingSend; departed: boolean };

/** The outgoing cards for the open thread: queued sends, then sent ones still waiting for their Sent copy. */
export function useOutgoing(thread: ThreadDetail): OutgoingCardItem[] {
  const outgoing = thread.outgoing ?? [];
  const prev = useRef<{ threadId: number; outgoing: OutgoingSend[] }>({ threadId: thread.id, outgoing });
  const [departed, setDeparted] = useState<Departed[]>([]);

  useEffect(() => {
    const before = prev.current.threadId === thread.id ? prev.current.outgoing : [];
    prev.current = { threadId: thread.id, outgoing };
    setDeparted((d) => settleDeparted(before, prev.current.threadId === thread.id ? d : [], { outgoing, draftIds: thread.draftIds, messages: thread.messages }, Date.now()));
    // thread is the input; outgoing is derived from it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thread]);

  // Ends a card whose Sent copy never arrived (another client deleted it, or the account does not keep Sent mail).
  useEffect(() => {
    if (departed.length === 0) return;
    const next = Math.min(...departed.map((d) => d.goneAt + DEPARTED_MAX_MS)) - Date.now();
    const t = setTimeout(() => setDeparted((d) => d.filter((x) => Date.now() - x.goneAt < DEPARTED_MAX_MS)), Math.max(0, next));
    return () => clearTimeout(t);
  }, [departed]);

  const shown = departed.filter((d) => !outgoing.some((o) => o.scheduledId === d.scheduledId));
  return [...outgoing.map((send) => ({ send, departed: false })), ...shown.map((d) => ({ send: d, departed: true }))];
}
