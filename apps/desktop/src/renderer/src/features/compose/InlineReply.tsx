import type { JSX } from "react";
/** STUB: the compose engineer replaces this file. */
export function InlineReply(props: { threadId: number; messageId: number; mode?: "reply" | "replyAll" }): JSX.Element {
  return <div className="t-body" style={{ color: "var(--fg-3)" }} data-thread={props.threadId} data-message={props.messageId}>Reply…</div>;
}
