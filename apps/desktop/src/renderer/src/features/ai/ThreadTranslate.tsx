import { useEffect, useMemo, useState, type JSX } from "react";
import { ChevronDown, ChevronRight, Languages } from "lucide-react";
import { Button } from "../../ui/Button";
import { Skeleton } from "../../ui/Skeleton";
import { splitQuoted } from "../mail/quotedText";
import { useThread } from "../mail/useThread";
import { detectLanguage } from "./detectLanguage";
import { ProseText } from "./ProseText";
import { RunAnnouncer, runAnnouncement } from "./RunAnnouncer";
import { userLanguage } from "./translateLanguage";
import { isBusy } from "./aiRun";
import { useAiRun } from "./useAiRun";
import styles from "./ThreadTranslate.module.css";

/** Wait this long before reading the thread for language detection, so skimming costs nothing. */
export const TRANSLATE_PROBE_DELAY_MS = 400;
const SAMPLE_MESSAGES = 3;

const cache = new Map<string, string>();

/** What the people in the thread wrote, without quotes: the newest messages, newest first. */
export function languageSample(messages: { text: string | null; html: string | null; isFromMe: boolean }[]): string {
  return messages
    .filter((m) => !m.isFromMe)
    .slice(-SAMPLE_MESSAGES)
    .reverse()
    .map((m) => splitQuoted(m.text ?? (m.html ?? "").replace(/<style[\s\S]*?<\/style>|<[^>]+>/g, " ")).body)
    .join("\n\n");
}

/** The translation keeps From/Date lines and --- separators; show the separators as blank lines. */
const readable = (text: string): string => text.replace(/^\s*-{3,}\s*$/gm, "");

/**
 * Offers to translate the open thread when it looks to be in another language than the user's.
 * Renders nothing otherwise. The translation streams in under the offer and can be hidden.
 */
export function ThreadTranslate({ threadId }: { threadId: number }): JSX.Element | null {
  const [probe, setProbe] = useState(false);
  const { thread } = useThreadWhen(threadId, probe);
  const { state, start, reset } = useAiRun();
  const [open, setOpen] = useState(true);
  const [requested, setRequested] = useState<string | null>(null);
  const target = userLanguage();

  useEffect(() => {
    setProbe(false);
    setRequested(null);
    setOpen(true);
    reset();
    const timer = setTimeout(() => setProbe(true), TRANSLATE_PROBE_DELAY_MS);
    return () => clearTimeout(timer);
    // reset is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId]);

  const detected = useMemo(() => (thread ? detectLanguage(languageSample(thread.messages)) : null), [thread]);
  const cacheKey = thread ? `${threadId}:${thread.messages.length}:${target}` : "";
  const cached = cache.get(cacheKey);

  useEffect(() => {
    if (state.status === "done" && state.text.trim() && cacheKey) cache.set(cacheKey, state.text);
  }, [state.status, state.text, cacheKey]);

  if (!thread || !detected || detected.toLowerCase() === target.toLowerCase()) return null;

  const shown = requested === cacheKey ? (cached ?? state.text) : cached;
  const busy = isBusy(state);
  const translate = () => {
    setRequested(cacheKey);
    setOpen(true);
    if (!cached) void start({ kind: "translate", threadId, language: target });
  };

  // First in both branches, so React keeps the same live region when the offer turns into the translation.
  const announcer = (
    <RunAnnouncer message={requested === cacheKey ? runAnnouncement(state, { busy: `Translating to ${target}`, done: "Translation ready", error: "Couldn't translate" }) : ""} />
  );

  if (shown === undefined || shown === "") {
    return (
      <>
      {announcer}
      <div className={styles.offer}>
        <Languages size={14} strokeWidth={1.5} aria-hidden />
        <span className={`t-body ${styles.hint}`}>This looks like {detected}.</span>
        <Button size="sm" variant="ghost" onClick={translate} disabled={busy}>Translate to {target}</Button>
        {state.status === "error" && requested === cacheKey ? <span className={`t-body ${styles.hint}`}>Couldn't translate. Try again.</span> : null}
        {busy && requested === cacheKey ? <Skeleton width={120} height={12} /> : null}
      </div>
      </>
    );
  }

  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <>
    {announcer}
    <section className={styles.block} aria-label={`Translation to ${target}`}>
      <div className={styles.head}>
        <button type="button" onClick={() => setOpen(!open)} aria-expanded={open}>
          <Chevron size={12} strokeWidth={1.5} aria-hidden />
          <span className="t-label">Translation · {detected} to {target}</span>
        </button>
      </div>
      {open ? (
        <div className={styles.text}>
          <ProseText text={readable(shown)} />
          {busy ? <span className={styles.caret} aria-hidden /> : null}
        </div>
      ) : null}
    </section>
    </>
  );
}

/** useThread, but only once `enabled`, so the probe waits for the dwell time. */
function useThreadWhen(id: number, enabled: boolean) {
  const { thread } = useThread(enabled ? id : null);
  return { thread };
}
