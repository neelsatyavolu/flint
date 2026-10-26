import type { ReactElement, ReactNode, Ref } from "react";
import { Ban, Copy, Paperclip, Search, SquarePen } from "lucide-react";
import clsx from "clsx";
import type { Address } from "@flint/core";
import { flint } from "../../lib/api";
import { displayName } from "../../lib/format";
import { Avatar, Popover, useToast } from "../../ui";
import { navStore } from "../../state/nav";
import { openComposer } from "../compose/composerStore";
import { blockSender } from "./blockSender";
import styles from "./Message.module.css";

/** Opens the search view on `query`. An open search field keeps its own text, so it is closed and reopened. */
export function searchFor(query: string): void {
  const nav = navStore.getState();
  const apply = () => {
    const n = navStore.getState();
    n.openSearch();
    n.setSearch(query);
  };
  if (!nav.searchOpen) return apply();
  nav.closeSearch();
  requestAnimationFrame(apply);
}

type CardProps = {
  person: Address;
  /** Hides Block sender, e.g. for the user's own addresses. */
  self?: boolean;
  onDone: () => void;
  /** Shown above the card, e.g. a Back row inside the recipients popover. */
  header?: ReactNode;
};

function Action({ icon, label, danger, onClick }: { icon: ReactNode; label: string; danger?: boolean; onClick: () => void }) {
  return (
    <button type="button" className={clsx(styles.personAction, danger && styles.personDanger)} onClick={onClick}>
      <span className={styles.personIcon} aria-hidden>{icon}</span>
      <span className={styles.personActionText}>{label}</span>
    </button>
  );
}

const I = { size: 14, strokeWidth: 1.5 } as const;

/** Who someone is and what you can do with them: copy, write, find their mail, block. */
export function PersonCardBody({ person, self = false, onDone, header }: CardProps) {
  const toast = useToast();
  const name = displayName(person);
  const done = (fn: () => void) => () => {
    onDone();
    fn();
  };
  const copy = () =>
    void navigator.clipboard.writeText(person.address).then(
      () => toast.show({ message: `Copied ${person.address}` }),
      () => toast.show({ message: "Couldn't copy the address.", level: "error" }),
    );
  return (
    // The popover is portaled, but React still bubbles its clicks to the message header, which would collapse the card.
    <div className={styles.person} onClick={(e) => e.stopPropagation()}>
      {header}
      <div className={styles.personHead}>
        <Avatar address={person.address} name={person.name} size={32} />
        <div className={styles.personText}>
          <div className={clsx("t-strong selectable", styles.personName)}>{name}</div>
          <div className={clsx("t-body selectable", styles.personAddr)}>{person.address}</div>
        </div>
      </div>
      <div className={styles.personActions}>
        <Action icon={<Copy {...I} />} label="Copy address" onClick={done(copy)} />
        <Action icon={<SquarePen {...I} />} label="New message" onClick={done(() => openComposer({ mode: "new", to: [person] }))} />
        <Action icon={<Search {...I} />} label={`All mail from ${name}`} onClick={done(() => searchFor(`from:${person.address}`))} />
        <Action icon={<Paperclip {...I} />} label={`Attachments from ${name}`} onClick={done(() => searchFor(`from:${person.address} has:attachment`))} />
        {self ? null : <Action icon={<Ban {...I} />} label="Block sender" danger onClick={done(() => void blockSender(flint, toast, person.address))} />}
      </div>
    </div>
  );
}

/** The person card in a popover, opened by clicking a name. */
export function PersonCard({ person, self, trigger }: { person: Address; self?: boolean; trigger: ReactElement<{ ref?: Ref<unknown> } & Record<string, unknown>> }) {
  return (
    <Popover placement="bottom-start" label={displayName(person)} className={styles.personPopover} trigger={trigger}>
      {(close) => <PersonCardBody person={person} self={self} onDone={close} />}
    </Popover>
  );
}
