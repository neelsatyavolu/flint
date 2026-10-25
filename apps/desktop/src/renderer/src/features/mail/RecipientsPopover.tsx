import clsx from "clsx";
import type { Address, MessageView } from "@flint/core";
import { displayName } from "../../lib/format";
import { Popover } from "../../ui";
import styles from "./Message.module.css";

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export function recipientLabel(a: Address, selfAddresses: string[]): string {
  return selfAddresses.some((s) => same(s, a.address)) ? "me" : displayName(a);
}

/** Everyone the message went to, in header order. */
export function allRecipients(m: Pick<MessageView, "to" | "cc" | "bcc">): Address[] {
  return [...m.to, ...m.cc, ...m.bcc];
}

function Group({ title, people }: { title: string; people: Address[] }) {
  if (people.length === 0) return null;
  return (
    <div className={styles.recipGroup}>
      <div className={clsx("t-label", styles.recipTitle)}>{title}</div>
      {people.map((a, i) => (
        <div key={`${a.address}${i}`} className={clsx("t-body selectable", styles.recipRow)}>
          {a.name ? <span className={styles.recipName}>{a.name}</span> : null}
          <span className={styles.recipAddr}>{a.address}</span>
        </div>
      ))}
    </div>
  );
}

/** "to Name +N" in the accent color. Clicking it lists From, To, Cc and Bcc with addresses. */
export function RecipientsLine({ message: m, selfAddresses }: { message: MessageView; selfAddresses: string[] }) {
  const people = allRecipients(m);
  if (people.length === 0) return <span className={styles.toPlain}>to undisclosed recipients</span>;
  const first = recipientLabel(people[0]!, selfAddresses);
  const extra = people.length - 1;
  return (
    <>
      <span className={styles.toWord}>to</span>
      <Popover
        placement="bottom-start"
        label="Recipients"
        className={styles.recipPopover}
        trigger={
          <button type="button" className={clsx("t-body", styles.toButton)} onClick={(e) => e.stopPropagation()} aria-label={`Recipients: ${first}${extra ? ` and ${extra} more` : ""}`}>
            {first}{extra > 0 ? ` +${extra}` : ""}
          </button>
        }
      >
        <Group title="From" people={m.from} />
        <Group title="To" people={m.to} />
        <Group title="Cc" people={m.cc} />
        <Group title="Bcc" people={m.bcc} />
      </Popover>
    </>
  );
}
