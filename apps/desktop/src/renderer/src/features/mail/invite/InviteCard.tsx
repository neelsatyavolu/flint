import { useEffect, useState } from "react";
import clsx from "clsx";
import { CalendarDays, ChevronRight, ExternalLink, MapPin, Repeat, Video } from "lucide-react";
import { FlintError } from "@flint/core/types";
import type { Invite, InviteAttendee, InviteConflicts, MessageView, RsvpResponse } from "@flint/core/types";
import { flint } from "../../../lib/api";
import { openExternal } from "../../../lib/host";
import { Button, TextArea, useToast } from "../../../ui";
import { displayName } from "../../../lib/format";
import { navStore } from "../../../state/nav";
import { durationText, localZoneAbbr, organizerZoneText, RESPONSE_LABEL, whenText } from "./inviteFormat";
import styles from "./InviteCard.module.css";

const GUESTS_SHOWN = 5;
const ANSWERS: { value: RsvpResponse; label: string }[] = [
  { value: "accepted", label: "Yes" },
  { value: "tentative", label: "Maybe" },
  { value: "declined", label: "No" },
];

/** True when this invite still takes an answer. */
export function canAnswer(i: Invite): boolean {
  return (i.state === "new" || i.state === "updated") && i.rsvpVia !== "none" && i.invitedAs !== null;
}

const eventState = (i: Invite) => i.state === "new" || i.state === "updated" || i.state === "past";

function mapsUrl(location: string): string {
  return /^https?:\/\//i.test(location) ? location : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location)}`;
}

function heading(i: Invite): string {
  switch (i.state) {
    case "updated": return "Updated invitation";
    case "cancelled": return "Cancelled";
    case "past": return "Past event";
    case "superseded": return "Earlier version";
    case "reply": return "Reply";
    case "counter": return "Calendar message";
    default: return i.method === "PUBLISH" ? "Event" : "Invitation";
  }
}

function conflictText(c: InviteConflicts): { text: string; clash: boolean } | null {
  if (c.status === "free") return { text: "Free at this time", clash: false };
  if (c.status !== "conflict" || c.events.length === 0) return null;
  const [first, ...rest] = c.events;
  return { text: `Conflicts with ${first!.title}${rest.length ? ` and ${rest.length} more` : ""}`, clash: true };
}

function Guests({ invite }: { invite: Invite }) {
  const [all, setAll] = useState(false);
  const ordered = [...invite.attendees].sort((a, b) => Number(b.role === "chair") - Number(a.role === "chair") || Number(b.isYou) - Number(a.isYou));
  if (ordered.length === 0) return null;
  const shown = all ? ordered : ordered.slice(0, GUESTS_SHOWN);
  const counts = (["accepted", "tentative", "declined", "needs-action"] as const)
    .map((r) => [r, ordered.filter((a) => a.response === r).length] as const)
    .filter(([, n]) => n > 0)
    .map(([r, n]) => `${n} ${RESPONSE_LABEL[r].toLowerCase()}`);
  const label = (a: InviteAttendee) => (a.isYou ? "You" : a.name || a.address);
  return (
    <div className={styles.guests}>
      <div className={clsx("t-label", styles.dim)}>{ordered.length} {ordered.length === 1 ? "guest" : "guests"} · {counts.join(", ")}</div>
      <ul className={styles.guestList} aria-label="Guests">
        {shown.map((a) => (
          <li key={a.address} className={styles.guest}>
            <span className={styles.guestName} title={a.address}>{label(a)}{a.role === "chair" ? <span className={styles.dim}> · Organizer</span> : a.role === "optional" ? <span className={styles.dim}> · Optional</span> : null}</span>
            <span className={clsx("t-data", styles.status, styles[a.response === "needs-action" ? "pending" : a.response])}>{RESPONSE_LABEL[a.response]}</span>
          </li>
        ))}
      </ul>
      {ordered.length > GUESTS_SHOWN ? (
        <button type="button" className={styles.link} aria-expanded={all} onClick={() => setAll((v) => !v)}>
          {all ? "Show fewer" : `Show ${ordered.length - GUESTS_SHOWN} more`}
        </button>
      ) : null}
    </div>
  );
}

type Props = { message: MessageView; onUpdated: () => void };

export function InviteCard({ message, onUpdated }: Props) {
  const toast = useToast();
  const [invite, setInvite] = useState<Invite | undefined>(message.invite);
  const [sending, setSending] = useState<RsvpResponse | null>(null);
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState("");
  const [conflicts, setConflicts] = useState<InviteConflicts | null>(null);
  const [connecting, setConnecting] = useState(false);
  useEffect(() => setInvite(message.invite), [message.invite]);

  const wantsConflicts = invite !== undefined && eventState(invite) && invite.state !== "past" && !invite.allDay;
  const via = invite?.rsvpVia;
  useEffect(() => {
    if (!wantsConflicts || via === "google-needs-scope" || via === "none") { setConflicts(null); return; }
    let live = true;
    flint.inviteConflicts(message.id).then((c) => { if (live) setConflicts(c); }, () => { if (live) setConflicts(null); });
    return () => { live = false; };
  }, [message.id, wantsConflicts, via]);

  if (!invite) return null;
  const i = invite;
  const active = i.state === "new" || i.state === "updated";
  const cancelled = i.state === "cancelled";
  const answerable = canAnswer(i);
  const zone = organizerZoneText(i);
  const length = durationText(i);
  const openInGoogle = i.googleEventUrl !== null && i.source === "google" && !cancelled && i.state !== "reply";
  const struck = cancelled ? styles.struck : undefined;
  const clash = conflicts ? conflictText(conflicts) : null;

  async function answer(response: RsvpResponse) {
    if (sending) return;
    const before = i;
    setSending(response);
    setInvite({ ...i, yourResponse: response, attendees: i.attendees.map((a) => (a.isYou ? { ...a, response } : a)) });
    try {
      const next = await flint.rsvp(message.id, response, note.trim() || undefined);
      setInvite(next);
      setNote("");
      setNoteOpen(false);
      toast.show({ message: i.organizer ? `Answer sent to ${displayName(i.organizer)}` : "Answer sent" });
      onUpdated();
    } catch (e) {
      setInvite(before);
      toast.show({ message: e instanceof FlintError && e.message ? e.message : "Couldn't send your answer. Try again.", level: "error" });
    } finally {
      setSending(null);
    }
  }

  async function addGoogleCalendar() {
    const address = i.invitedAs?.address;
    if (!address) return;
    setConnecting(true);
    try {
      await flint.addGoogleCalendarAccount({ loginHint: address });
      onUpdated();
    } catch (e) {
      toast.show({ message: e instanceof FlintError && e.message ? e.message : "Couldn't connect Google Calendar. Try again.", level: "error" });
    } finally {
      setConnecting(false);
    }
  }

  async function connect() {
    setConnecting(true);
    try {
      await flint.connectGoogleCalendar(message.accountId);
      onUpdated();
    } catch (e) {
      toast.show({ message: e instanceof FlintError && e.message ? e.message : "Couldn't connect Google Calendar. Try again.", level: "error" });
    } finally {
      setConnecting(false);
    }
  }

  const replyVerb = { accepted: "accepted", declined: "declined", tentative: "said maybe to", "needs-action": "has not answered" } as const;
  const sentence = i.reply ? `${displayName(i.reply.from)} ${replyVerb[i.reply.response]} your invitation` : null;

  return (
    <section className={clsx(styles.card, styles[i.state])} aria-label={`${heading(i)}: ${i.title}`} data-invite-state={i.state}>
      <div className={styles.top}>
        <span className={clsx("t-label", styles.dim)}><CalendarDays size={13} strokeWidth={1.5} aria-hidden className={styles.inlineIcon} />{heading(i)}</span>
      </div>
      <h3 className={clsx("t-title", styles.title, cancelled && styles.struck)}>{i.title}</h3>
      {sentence ? <p className={styles.replyLine}><strong>{sentence}</strong>{i.reply?.comment ? <span className={styles.quote}>{i.reply.comment}</span> : null}</p> : null}
      {cancelled ? <p className={styles.notice} role="status">The organizer cancelled this event.</p> : null}
      {i.state === "superseded" ? <p className={styles.notice} role="status">A newer version of this invitation is in this thread.</p> : null}
      {i.state === "past" ? <p className={styles.notice} role="status">This event has ended.</p> : null}
      {i.changes.length > 0 ? (
        <ul className={styles.changes} aria-label="What changed">
          {i.changes.map((c) => (
            <li key={c.field}><span className={styles.dim}>{c.field === "time" ? "Time" : c.field === "location" ? "Where" : c.field[0]!.toUpperCase() + c.field.slice(1)}: </span><s className={styles.dim}>{c.before ?? "none"}</s> <span aria-hidden>{"->"}</span><span className="sr-only"> changed to </span> <strong>{c.after ?? "none"}</strong></li>
          ))}
        </ul>
      ) : null}

      <dl className={styles.meta}>
        <div className={struck}><dt>When</dt><dd><span>{whenText(i)}{zone ? <span className={styles.nowrap}> {localZoneAbbr(i.start)}</span> : null}{length ? <span className={clsx(styles.dim, styles.nowrap)}> · {length}</span> : null}</span>{zone ? <span className={clsx("t-data", styles.dim, styles.sub)}>{zone}</span> : null}</dd></div>
        {i.recurrence ? <div className={struck}><dt><Repeat size={14} strokeWidth={1.5} aria-label="Repeats" /></dt><dd>{i.recurrence.summary}{i.recurrence.hasExceptions ? <span className={styles.dim}> · some dates differ</span> : null}</dd></div> : null}
        {i.location ? <div className={struck}><dt><MapPin size={14} strokeWidth={1.5} aria-label="Where" /></dt><dd><button type="button" className={styles.link} onClick={() => openExternal(mapsUrl(i.location!))} title="Open in Maps">{i.location}</button></dd></div> : null}
        {i.conference ? <div className={struck}><dt><Video size={14} strokeWidth={1.5} aria-label="Video call" /></dt><dd>{i.conference.label}{i.conference.code ? <span className={clsx("t-data", styles.dim)}> · ID {i.conference.code}</span> : null}{i.conference.phone ? <span className={clsx("t-data", styles.dim)}> · {i.conference.phone}</span> : null}</dd></div> : null}
        {i.organizer && i.state !== "reply" ? <div><dt>From</dt><dd>{displayName(i.organizer)}</dd></div> : null}
      </dl>

      {(i.conference && active) || openInGoogle ? (
        <div className={styles.actions}>
          {i.conference && active ? <Button variant="primary" size="sm" icon={<Video size={14} strokeWidth={1.5} />} onClick={() => openExternal(i.conference!.url)}>Join {i.conference.label}</Button> : null}
          {openInGoogle ? <Button variant="ghost" size="sm" icon={<ExternalLink size={14} strokeWidth={1.5} />} onClick={() => openExternal(i.googleEventUrl as string)}>Open in Google Calendar</Button> : null}
        </div>
      ) : null}

      {clash && active ? <p className={clsx(styles.conflict, clash.clash && styles.clash)} role="status">{clash.text}</p> : null}

      {i.description && active ? <p className={clsx("selectable", styles.description)}>{i.description}</p> : null}

      {i.state !== "reply" && i.state !== "counter" && !cancelled ? <Guests invite={i} /> : null}

      {answerable ? (
        <div className={styles.rsvp}>
          <div className={styles.rsvpRow} role="group" aria-label="Your response">
            <span className={clsx("t-label", styles.dim)}>{i.yourResponse === "needs-action" ? "Going?" : `You: ${RESPONSE_LABEL[i.yourResponse]}`}</span>
            <div className={styles.answers}>
              {ANSWERS.map((a) => (
                <Button key={a.value} size="sm" variant="ghost" className={clsx(styles.answer, i.yourResponse === a.value && styles.chosen)} aria-pressed={i.yourResponse === a.value} aria-busy={sending === a.value} disabled={sending !== null} onClick={() => void answer(a.value)}>
                  {sending === a.value ? "Sending…" : a.label}
                </Button>
              ))}
            </div>
            <button type="button" className={styles.link} aria-expanded={noteOpen} onClick={() => setNoteOpen((v) => !v)}>
              <ChevronRight size={12} strokeWidth={1.5} className={clsx(styles.chev, noteOpen && styles.turned)} aria-hidden />Add a note
            </button>
          </div>
          {noteOpen ? <TextArea className={styles.note} rows={2} value={note} placeholder="Sent with your answer" aria-label="Note to the organizer" onChange={(e) => setNote(e.target.value)} /> : null}
          {i.yourNote && !noteOpen ? <p className={clsx("t-data", styles.dim)}>Your note: {i.yourNote}</p> : null}
          {i.rsvpVia === "google-needs-scope" ? (
            <p className={styles.connect}>
              <span className={styles.dim}>Answers are sent as an email reply. Connect Google Calendar to update your calendar and see conflicts.</span>
              <button type="button" className={styles.link} disabled={connecting} onClick={() => void connect()}>{connecting ? "Connecting" : "Connect Google Calendar"}</button>
            </p>
          ) : null}
          {i.rsvpVia === "imip" && i.invitedAs ? (
            <p className={styles.connect}>
              <span className={styles.dim}>Invites to {i.invitedAs.address} are answered by email. Add a calendar to update your calendar too.</span>
              <button type="button" className={styles.link} disabled={connecting} onClick={() => void addGoogleCalendar()}>{connecting ? "Connecting" : "Add Google Calendar"}</button>
              <button type="button" className={styles.link} onClick={() => navStore.getState().openSettings(`calendars/${i.invitedAs!.address}`)}>Add iCloud or other calendar</button>
            </p>
          ) : null}
        </div>
      ) : i.state === "past" && i.yourResponse !== "needs-action" ? <p className={clsx("t-data", styles.dim)}>You answered: {RESPONSE_LABEL[i.yourResponse]}</p> : null}
    </section>
  );
}

/** The sender's generated invite email stays out of the way behind "Show original". */
export function OriginalToggle({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={clsx(styles.link, styles.original)} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <ChevronRight size={12} strokeWidth={1.5} className={clsx(styles.chev, open && styles.turned)} aria-hidden />{open ? "Hide original" : "Show original"}
      </button>
      {open ? children : null}
    </>
  );
}
