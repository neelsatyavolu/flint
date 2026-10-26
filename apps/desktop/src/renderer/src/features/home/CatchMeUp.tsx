import { useEffect, useId, useRef, useState, type JSX } from "react";
import { format } from "date-fns";
import { Sparkles } from "lucide-react";
import clsx from "clsx";
import { useFlintQuery } from "../../lib/hooks";
import { pluralize } from "../../lib/format";
import { readStoredNumber, writeStored } from "../../lib/storage";
import { Button, Skeleton, Toggle } from "../../ui";
import { navStore } from "../../state/nav";
import { parseDigest } from "../ai/digestParse";
import { DigestList } from "../ai/DigestList";
import { openSettings } from "../ai/events";
import { useAiAvailability } from "../ai/useAiRun";
import { catchUp, dueAt, useCatchUp, type CatchUpState } from "./catchUpStore";
import { HOME_SEEN_KEY, sinceLabel, sinceParts, sinceStart } from "./sinceSummary";
import hs from "./HomeView.module.css";
import styles from "./CatchMeUp.module.css";

const openThread = (id: number) => navStore.getState().openThread(id, { fromOutside: true });
const refresh = () => void catchUp.refresh();

/** Home is on screen: announcements from a hidden Home or a background window would be noise. */
const homeVisible = () => {
  const nav = navStore.getState();
  return nav.view === "home" && !nav.settingsOpen && document.visibilityState === "visible";
};

function itemCount(s: CatchUpState): number {
  return s.result ? parseDigest(s.result.text, s.result.citations).groups.reduce((n, g) => n + g.items.length, 0) : 0;
}

/** One polite, visually hidden line for screen readers. Never moves focus. */
function useAnnouncement(): string {
  const status = useCatchUp((s) => s.status);
  const [said, setSaid] = useState("");
  const prev = useRef(status);
  useEffect(() => {
    const was = prev.current;
    prev.current = status;
    if (was === status || !homeVisible()) return;
    const s = catchUp.store.getState();
    if (status === "running") setSaid("Writing your catch-up…");
    else if (status === "ready" && was === "running") setSaid(`Catch-up ready, ${pluralize(itemCount(s), "item")}`);
    else if (status === "error") setSaid(s.error ?? "Couldn't catch you up.");
  }, [status]);
  return said;
}

function Footer({ s }: { s: CatchUpState }): JSX.Element {
  const now = Date.now();
  const due = dueAt(s);
  const running = s.status === "running";
  return (
    <div className={styles.foot}>
      <p className={clsx("t-data", styles.meta)}>
        {running ? <span>Refreshing…</span> : null}
        {!running && s.status === "error" ? <span className={styles.error}>{s.error}</span> : null}
        {!running && s.status !== "error" && s.result ? <span>Updated {sinceLabel(s.result.at, now)}</span> : null}
        {!running && s.auto && due > now ? <><span aria-hidden>·</span><span>Next at {format(due, "h:mm a")}</span></> : null}
        {!running ? (
          <>
            {s.result || s.status === "error" ? <span aria-hidden>·</span> : null}
            <button type="button" className={styles.link} onClick={refresh}>{s.status === "error" ? "Try again" : "Refresh"}</button>
          </>
        ) : null}
      </p>
      <span className={clsx("t-data", styles.auto)}>
        <span aria-hidden>Refresh automatically every 3 hours</span>
        <Toggle checked={s.auto} onChange={catchUp.setAuto} label="Refresh automatically every 3 hours" />
      </span>
    </div>
  );
}

/** The +AI digest, rendered from the catch-up store so it keeps running when Home unmounts. */
function AiCatchUp({ titleId }: { titleId: string }): JSX.Element {
  const s = useCatchUp((x) => x);
  const running = s.status === "running";
  const text = running ? s.run.text : s.result?.text ?? "";
  const threads = running ? s.run.citations : s.result?.citations ?? [];

  let body: JSX.Element;
  if (text) body = <DigestList text={text} threads={threads} busy={running} onOpen={openThread} />;
  else if (running) {
    body = (
      <div className={styles.lines} aria-hidden>
        <Skeleton height={14} width="90%" /><Skeleton height={14} width="75%" /><Skeleton height={14} width="82%" />
      </div>
    );
  } else {
    const hint = s.status === "not_connected" ? "Connect ChatGPT or Grok in Settings to use this."
      : s.status === "error" ? `Couldn't catch you up. ${s.error ?? ""}`.trim()
      : "A short read of your unread mail from people, and what needs a reply.";
    return (
      <section className={hs.block} aria-labelledby={titleId}>
        <Head titleId={titleId} ai />
        <div className={styles.ask}>
          <p className={clsx("t-body", styles.hint)}>{hint}</p>
          <Button size="sm" variant="ghost" onClick={s.status === "not_connected" ? () => openSettings("ai") : refresh}>
            {s.status === "not_connected" ? "Open settings" : s.status === "error" ? "Try again" : <><Sparkles size={14} strokeWidth={1.5} aria-hidden />Catch me up</>}
          </Button>
        </div>
      </section>
    );
  }
  return (
    <section className={hs.block} aria-labelledby={titleId} aria-busy={running}>
      <Head titleId={titleId} ai />
      {body}
      <Footer s={s} />
    </section>
  );
}

function Head({ titleId, ai = false }: { titleId: string; ai?: boolean }): JSX.Element {
  return (
    <div className={hs.blockHead}>
      <h2 id={titleId} className={clsx("t-label", hs.blockLabel)}>Catch me up</h2>
      {ai ? <span className={`t-data ${hs.tag}`}>+AI</span> : null}
    </div>
  );
}

/** Without +AI: what arrived since the last Home visit, counted locally, and how to get the written catch-up. */
function LocalCatchUp({ titleId, since, connected }: { titleId: string; since: number; connected: boolean }): JSX.Element {
  const q = useFlintQuery((api) => api.listThreads({ view: "inbox", focused: true }), []);
  const parts = q.data ? sinceParts(q.data, since) : null;
  return (
    <section className={hs.block} aria-labelledby={titleId}>
      <Head titleId={titleId} />
      {parts === null ? (
        <div className={styles.lines} aria-hidden><Skeleton height={14} width="70%" /></div>
      ) : (
        <p className={clsx("t-body", styles.since)}>
          Since {sinceLabel(since, Date.now())}:{" "}
          {parts.length === 0 ? "nothing new." : parts.map((p, i) => (
            <span key={p.key}>
              {i > 0 ? <span aria-hidden> · </span> : null}
              <button type="button" className={styles.link} onClick={() => navStore.getState().go(p.target)}>{p.text}</button>
            </span>
          ))}
        </p>
      )}
      <div className={styles.connect}>
        <p className="t-body">{connected ? "Turn on +AI to get a written catch-up" : "Connect ChatGPT or Grok to get a written catch-up"}</p>
        <Button size="sm" variant="ghost" onClick={() => openSettings("ai")}>{connected ? "Open settings" : "Connect"}</Button>
      </div>
    </section>
  );
}

/** "Catch me up" on Home: the +AI digest when it is available, a local since-your-last-visit line otherwise. */
export function CatchMeUp(): JSX.Element | null {
  const ai = useAiAvailability();
  const titleId = useId();
  const said = useAnnouncement();
  const [since] = useState(() => sinceStart(readStoredNumber(HOME_SEEN_KEY, 0), Date.now()));
  useEffect(() => {
    // Quitting or reloading on Home closes the window without unmounting, so save on the way out too.
    const seen = () => writeStored(HOME_SEEN_KEY, String(Date.now()));
    window.addEventListener("pagehide", seen);
    window.addEventListener("beforeunload", seen);
    return () => {
      window.removeEventListener("pagehide", seen);
      window.removeEventListener("beforeunload", seen);
      seen();
    };
  }, []);

  if (ai.loading) return null;
  return (
    <>
      {ai.ready ? <AiCatchUp titleId={titleId} /> : <LocalCatchUp titleId={titleId} since={since} connected={ai.connected} />}
      <div className="sr-only" role="status" aria-live="polite">{ai.ready ? said : ""}</div>
    </>
  );
}
