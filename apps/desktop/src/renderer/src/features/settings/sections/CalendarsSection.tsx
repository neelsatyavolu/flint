import { useEffect, useRef, useState } from "react";
import { CalendarDays, ChevronDown, ChevronRight, Plus } from "lucide-react";
import { calendarCovers, type CalendarAccount } from "@flint/core/types";
import { flint } from "../../../lib/api";
import { Button, Dialog, useToast } from "../../../ui";
import { SectionPage } from "../fields";
import { errorText, useAccounts } from "../useAccounts";
import { AddCalendarDialog } from "../calendars/AddCalendarDialog";
import { CalendarDetail } from "../calendars/CalendarDetail";
import { KIND_LABEL, type CalendarKind } from "../calendars/calendarForm";
import { useCalendars } from "../calendars/useCalendars";
import styles from "../settings.module.css";

const KINDS: CalendarKind[] = ["google", "icloud", "fastmail", "other"];
const ADD_LABEL: Record<CalendarKind, string> = { google: "Add Google Calendar", icloud: "Add iCloud Calendar", fastmail: "Add Fastmail Calendar", other: "Add other CalDAV" };

/** The deep-link page under Calendars: an email address opens the chooser with that address filled in. */
export function calendarPage(page: string | undefined): string | null {
  return page && page.includes("@") ? page : null;
}

function statusOf(c: CalendarAccount): { text: string; tone: "ok" | "warn" | "err" } {
  if (c.status === "needs-signin") return { text: "Sign-in expired", tone: "err" };
  if (c.status === "error") return { text: c.statusMessage ?? "Can't reach the calendar", tone: "err" };
  return { text: c.kind === "caldav" && c.scheduling === false ? "Connected, answers also sent by email" : "Connected", tone: "ok" };
}

export function CalendarsSection({ page }: { page?: string }) {
  const toast = useToast();
  const { calendars, loading, refetch } = useCalendars();
  const { accounts } = useAccounts();
  const [open, setOpen] = useState<string | null>(null);
  const [choosing, setChoosing] = useState<string | null>(null);
  const [kind, setKind] = useState<CalendarKind | null>(null);
  const [address, setAddress] = useState<string | undefined>(undefined);
  const linked = useRef(false);

  // "calendars/<address>" (from an invitation): offer the ways to add a calendar for that address, once.
  useEffect(() => {
    const target = calendarPage(page);
    if (linked.current || !target) return;
    linked.current = true;
    setChoosing(target);
  }, [page]);

  const list = calendars ?? [];
  const uncovered = (accounts ?? []).filter((a) => a.enabled && !calendarCovers(a, list));

  const start = (k: CalendarKind, addr?: string) => { setChoosing(null); setAddress(addr); setKind(k); };
  const guard = async (fn: () => Promise<unknown>, fallback: string) => {
    try {
      await fn();
      refetch();
    } catch (err) {
      toast.show({ message: errorText(err, fallback), level: "error" });
    }
  };

  return (
    <SectionPage title="Calendars" description="Where Flint answers invitations, whatever mail account they arrive on. Changes apply at once.">
      <div className={styles.calendarAdds}>
        {KINDS.map((k) => (
          <Button key={k} size="sm" variant={k === "google" ? "primary" : "ghost"} icon={<Plus size={14} strokeWidth={1.5} />} onClick={() => start(k)}>{ADD_LABEL[k]}</Button>
        ))}
      </div>
      <div className={styles.listTop}>
        {list.map((c) => {
          const isOpen = open === c.id;
          const status = statusOf(c);
          return (
            <div key={c.id} className={styles.hair}>
              <div className={`${styles.row} ${styles.rowBare}`}>
                <button type="button" className={`${styles.rowGrow} ${styles.bareBtn} ${styles.disclosure}`} aria-expanded={isOpen} aria-label={`${c.name}, ${isOpen ? "hide" : "show"} details`} onClick={() => setOpen(isOpen ? null : c.id)}>
                  {isOpen ? <ChevronDown size={14} strokeWidth={1.5} color="var(--fg-3)" aria-hidden /> : <ChevronRight size={14} strokeWidth={1.5} color="var(--fg-3)" aria-hidden />}
                  <CalendarDays size={18} strokeWidth={1.5} color="var(--fg-2)" aria-hidden />
                  <span className={styles.rowGrow}>
                    <span className={`${styles.rowTitle} ${styles.block}`}>{c.name}</span>
                    <span className={`${styles.mono} ${styles.muted} ${styles.block}`}>{c.kind === "google" ? "Google" : c.preset === "icloud" ? "iCloud" : c.preset === "fastmail" ? "Fastmail" : "CalDAV"} · {c.addresses.join(", ")}</span>
                    <span className={`${styles.mono} ${styles[status.tone]} ${styles.block}`}>{status.text}</span>
                  </span>
                </button>
              </div>
              {isOpen ? (
                <CalendarDetail
                  calendar={c}
                  onRename={(name) => guard(() => flint.updateCalendarAccount(c.id, { name }), "Couldn't rename the calendar. Try again.")}
                  onAddresses={(extraAddresses) => guard(() => flint.updateCalendarAccount(c.id, { extraAddresses }), "Couldn't update the addresses. Try again.")}
                  onRemove={() => guard(async () => { await flint.removeCalendarAccount(c.id); setOpen(null); }, "Couldn't remove the calendar. Try again.")}
                  onSignIn={c.kind === "google" ? () => guard(() => flint.addGoogleCalendarAccount({ loginHint: c.email }), "Google sign-in didn't finish. Try again.") : undefined}
                />
              ) : null}
            </div>
          );
        })}
        {!loading && list.length === 0 ? <p className={styles.empty}>No calendars yet. Without one, invitations are answered by email only.</p> : null}
      </div>

      {uncovered.length > 0 ? (
        <div className={styles.group}>
          <h3 className={`t-label ${styles.groupLabel}`}>Mail accounts without a calendar</h3>
          <div className={styles.listTop}>
            {uncovered.map((a) => (
              <div key={a.id} className={styles.row}>
                <span className={styles.rowGrow}>
                  <span className={`${styles.rowTitle} ${styles.block}`}>{a.email}</span>
                  <span className={`${styles.muted} ${styles.block}`}>Invites to {a.email} are answered by email. Add a calendar to update your calendar too.</span>
                </span>
                <Button variant="ghost" onClick={() => setChoosing(a.email)}>Add calendar</Button>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <Dialog open={choosing !== null} onClose={() => setChoosing(null)} title="Add a calendar" width={440}>
        <div className={styles.stack}>
          {choosing ? <p className={styles.prose}>Pick where {choosing} keeps its calendar.</p> : null}
          {KINDS.map((k) => <Button key={k} variant="ghost" onClick={() => start(k, choosing ?? undefined)}>{KIND_LABEL[k]}</Button>)}
        </div>
      </Dialog>
      <AddCalendarDialog
        kind={kind}
        address={address}
        onClose={() => setKind(null)}
        onAdded={(c) => { setKind(null); setOpen(c.id); refetch(); toast.show({ message: `${c.name} added` }); }}
      />
    </SectionPage>
  );
}
