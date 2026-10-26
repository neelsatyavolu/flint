import clsx from "clsx";
import type { InviteChip as Chip } from "@flint/core/types";
import { chipText, chipWhen, RESPONSE_LABEL } from "./inviteFormat";
import styles from "./InviteChip.module.css";

/** "Invite · Tue 3 PM" on a thread row. Quiet once answered, struck when cancelled. */
export function InviteChip({ invite, now }: { invite: Chip | undefined; now: number }) {
  if (!invite) return null;
  const answered = invite.state !== "cancelled" && invite.state !== "reply" && invite.yourResponse !== "needs-action";
  const tone = invite.state === "cancelled" ? styles.cancelled : invite.state === "updated" ? styles.updated : answered || invite.state === "past" || invite.state === "reply" ? styles.quiet : "";
  const label = `${invite.title}, ${invite.state === "reply" ? "reply" : chipWhen(invite, now)}${answered ? `, ${RESPONSE_LABEL[invite.yourResponse]}` : ""}`;
  return <span className={clsx("t-data", styles.chip, tone)} title={label} aria-label={`Calendar invitation: ${label}`}>{chipText(invite, now)}</span>;
}
