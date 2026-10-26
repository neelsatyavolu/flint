import { useState } from "react";
import { ChevronLeft } from "lucide-react";
import clsx from "clsx";
import type { Address, MessageView } from "@flint/core";
import { displayName } from "../../lib/format";
import { Popover } from "../../ui";
import { PersonCardBody } from "./PersonCard";
import styles from "./Message.module.css";

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export function recipientLabel(a: Address, selfAddresses: string[]): string {
  return selfAddresses.some((s) => same(s, a.address)) ? "me" : displayName(a);
}

/** Everyone the message went to, in header order. */
export function allRecipients(m: Pick<MessageView, "to" | "cc" | "bcc">): Address[] {
  return [...m.to, ...m.cc, ...m.bcc];
}

function Group({ title, people, onPick }: { title: string; people: Address[]; onPick: (a: Address) => void }) {
  if (people.length === 0) return null;
  return (
    <div className={styles.recipGroup}>
      <div className={clsx("t-label", styles.recipTitle)}>{title}</div>
      {people.map((a, i) => (
        <button key={`${a.address}${i}`} type="button" className={clsx("t-body", styles.recipRow)} onClick={() => onPick(a)} aria-label={`${a.name ? `${a.name}, ` : ""}${a.address}. Show card`}>
          {a.name ? <span className={styles.recipName}>{a.name}</span> : null}
          <span className={styles.recipAddr}>{a.address}</span>
        </button>
      ))}
    </div>
  );
}

/** "to Name +N" in the accent color. Clicking it lists From, To, Cc and Bcc with addresses; a row opens that person's card. */
export function RecipientsLine({ message: m, selfAddresses }: { message: MessageView; selfAddresses: string[] }) {
  const [person, setPerson] = useState<Address | null>(null);
  const people = allRecipients(m);
  if (people.length === 0) return <span className={styles.toPlain}>to undisclosed recipients</span>;
  const first = recipientLabel(people[0]!, selfAddresses);
  const extra = people.length - 1;
  const isSelf = (a: Address) => selfAddresses.some((s) => same(s, a.address));
  return (
    <>
      <span className={styles.toWord}>to</span>
      <Popover
        placement="bottom-start"
        label={person ? displayName(person) : "Recipients"}
        className={clsx(styles.recipPopover, person && styles.personPopover)}
        onOpenChange={(open) => !open && setPerson(null)}
        trigger={
          <button type="button" className={clsx("t-body", styles.toButton)} onClick={(e) => e.stopPropagation()} aria-label={`Recipients: ${first}${extra ? ` and ${extra} more` : ""}`}>
            {first}{extra > 0 ? ` +${extra}` : ""}
          </button>
        }
      >
        {(close) =>
          person ? (
            <PersonCardBody
              person={person}
              self={isSelf(person)}
              onDone={close}
              header={
                // The row that opened the card is gone, so focus lands here instead of falling to the page.
                <button type="button" autoFocus className={clsx("t-body", styles.personBack)} onClick={() => setPerson(null)}>
                  <ChevronLeft size={14} strokeWidth={1.5} aria-hidden />
                  Recipients
                </button>
              }
            />
          ) : (
            // Portaled, but React bubbles clicks to the message header; keep them from collapsing the card.
            <div onClick={(e) => e.stopPropagation()}>
              <Group title="From" people={m.from} onPick={setPerson} />
              <Group title="To" people={m.to} onPick={setPerson} />
              <Group title="Cc" people={m.cc} onPick={setPerson} />
              <Group title="Bcc" people={m.bcc} onPick={setPerson} />
            </div>
          )
        }
      </Popover>
    </>
  );
}
