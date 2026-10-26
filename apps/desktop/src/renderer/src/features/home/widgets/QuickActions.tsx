import type { JSX } from "react";
import { Inbox, PenLine, Search, Sparkles } from "lucide-react";
import { Button, Kbd } from "../../../ui";
import { navStore } from "../../../state/nav";
import { compose } from "../../mail/mailCommands";
import { openAsk } from "../../ai/events";
import styles from "../HomeView.module.css";

const I = { size: 14, strokeWidth: 1.5, "aria-hidden": true } as const;

function openSearch(): void {
  // Search lives in the mail list, so it opens over the inbox.
  navStore.getState().go({ view: "inbox" });
  navStore.getState().openSearch();
}

/** Ghost buttons for the first things people do from Home, with their shortcuts. */
export function QuickActions(): JSX.Element {
  return (
    <div className={styles.actions} role="group" aria-label="Quick actions">
      <Button size="sm" variant="ghost" onClick={compose}><PenLine {...I} />New message<Kbd combo="c" /></Button>
      <Button size="sm" variant="ghost" onClick={openSearch}><Search {...I} />Search<Kbd combo="/" /></Button>
      <Button size="sm" variant="ghost" onClick={() => openAsk()}><Sparkles {...I} />Ask</Button>
      <Button size="sm" variant="ghost" onClick={() => navStore.getState().go({ view: "inbox" })}><Inbox {...I} />Open inbox<Kbd combo="g i" /></Button>
    </div>
  );
}
