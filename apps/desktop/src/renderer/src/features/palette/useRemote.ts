import { useEffect, useRef, useState } from "react";
import type { Contact, ThreadListItem } from "@flint/core";
import { flint } from "../../lib/api";
import type { Mode } from "./modes";
import type { Remote } from "./sections";

export const MAIL_DEBOUNCE_MS = 180;
export const CONTACT_DEBOUNCE_MS = 120;
/** A loading row only appears for a request slower than this, so quick answers never flash it. */
export const LOADING_DELAY_MS = 140;
const MAIL_LIMIT = 8;
const CONTACT_LIMIT = 5;

export function wantsMail(mode: Mode, text: string): boolean {
  return mode === "mail" ? text.length >= 1 : mode === "all" && text.length >= 2;
}
export function wantsContacts(mode: Mode, text: string): boolean {
  return mode === "contacts" ? text.length >= 1 : mode === "all" && text.length >= 2;
}

/**
 * Live mail and contact matches for the text in the palette. Typing is debounced, answers for older text are dropped,
 * and the previous results stay on screen until the new ones land, so the list never blanks between keystrokes.
 */
export function useRemote(mode: Mode, text: string, enabled: boolean): Remote {
  const [threads, setThreads] = useState<ThreadListItem[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [pending, setPending] = useState(false);
  const [slow, setSlow] = useState(false);
  const [mailError, setMailError] = useState(false);
  const mailSeq = useRef(0);
  const contactSeq = useRef(0);

  const mail = enabled && wantsMail(mode, text);
  const people = enabled && wantsContacts(mode, text);

  useEffect(() => {
    const seq = ++mailSeq.current;
    if (!mail) {
      setThreads([]);
      setPending(false);
      setSlow(false);
      setMailError(false);
      return;
    }
    let slowTimer: ReturnType<typeof setTimeout> | undefined;
    const timer = setTimeout(() => {
      setPending(true);
      slowTimer = setTimeout(() => { if (seq === mailSeq.current) setSlow(true); }, LOADING_DELAY_MS);
      flint.listThreads({ view: "search", search: text, limit: MAIL_LIMIT }).then(
        (page) => {
          if (seq !== mailSeq.current) return;
          setThreads(page.items);
          setMailError(false);
        },
        () => { if (seq === mailSeq.current) setMailError(true); },
      ).finally(() => {
        if (seq !== mailSeq.current) return;
        clearTimeout(slowTimer);
        setPending(false);
        setSlow(false);
      });
    }, MAIL_DEBOUNCE_MS);
    return () => { clearTimeout(timer); clearTimeout(slowTimer); };
  }, [mail, text]);

  useEffect(() => {
    const seq = ++contactSeq.current;
    if (!people) {
      setContacts([]);
      return;
    }
    const timer = setTimeout(() => {
      flint.suggestContacts(text, CONTACT_LIMIT).then(
        (list) => { if (seq === contactSeq.current) setContacts(list); },
        () => { if (seq === contactSeq.current) setContacts([]); },
      );
    }, CONTACT_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [people, text]);

  return { threads: mail ? threads : [], contacts: people ? contacts : [], mailLoading: mail && pending && slow, mailError: mail && mailError };
}
