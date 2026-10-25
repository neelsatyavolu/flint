import { useMemo } from "react";
import { compose, deleteDraftRow, openDraftRow, openMovePicker, openSnooze, replyTo } from "../features/mail/mailCommands";
import type { ReplyMode } from "../state/compose";
import { stepKey, threadIdOf } from "../state/grouping";
import { listStore } from "../state/listStore";
import { navStore, targetIds } from "../state/nav";
import { useThreadActions } from "../state/useActions";
import { useApp } from "../state/AppContext";
import { useToast } from "../ui/Toast";

const PURE_MAIL_VIEWS = new Set(["home", "receipts", "agent_activity", "scheduled"]);

/** Imperative app commands shared by keyboard shortcuts, the native menu and the command palette. */
export function useAppCommands() {
  const { run, undo } = useThreadActions();
  const toast = useToast();
  const { settings, updateSettings, narrow, accounts } = useApp();
  const split = settings.appearance.layout === "split";

  return useMemo(() => {
    const targets = () => targetIds(navStore.getState());
    const items = () => {
      const ids = new Set(targets());
      return listStore.getState().raw.filter((i) => ids.has(i.id));
    };
    const soleTarget = (): number | null => {
      const ids = targets();
      return ids.length === 1 ? ids[0]! : null;
    };
    const inMailView = () => !navStore.getState().settingsOpen && !PURE_MAIL_VIEWS.has(navStore.getState().view);

    const openCursor = () => {
      const n = navStore.getState();
      const key = n.cursorKey;
      if (!key) return;
      if (key.startsWith("b:")) {
        n.openCategory(key.slice(2) as "notifications" | "newsletters");
        return;
      }
      const id = threadIdOf(key);
      if (id === null) return;
      const row = listStore.getState().raw.find((i) => i.id === id);
      if (n.view === "drafts" && row) void openDraftRow(row, toast.show);
      else if (n.view !== "drafts") n.openThread(id);
    };

    const step = (delta: 1 | -1) => {
      const n = navStore.getState();
      const current = n.cursorKey ?? (n.openId !== null ? `t${n.openId}` : null);
      const key = stepKey(listStore.getState().entries, current, delta, true);
      if (!key) return;
      const id = threadIdOf(key);
      if (split && id !== null && n.view !== "drafts") n.openThread(id);
      else n.setCursor(key);
    };

    return {
      inMailView,
      /** True when a thread is open, checked or under the cursor, so thread actions have something to act on. */
      hasTarget: () => targets().length > 0,
      compose,
      undo,
      step,
      openCursor,
      archive: () => void run({ type: "archive" }),
      trash: () => {
        const drafts = navStore.getState().view === "drafts" ? items().flatMap((i) => (i.draft?.draftId != null ? [i.draft.draftId] : [])) : [];
        for (const draftId of drafts) void deleteDraftRow(draftId, toast.show);
        if (drafts.length === 0) { void run({ type: "trash" }); return; }
        const rest = items().filter((i) => i.draft?.draftId == null).map((i) => i.id);
        if (rest.length) void run({ type: "trash" }, rest);
      },
      spam: () => void run({ type: "spam", spam: true }),
      snooze: () => openSnooze(targets()),
      move: () => openMovePicker(targets()),
      moveToInbox: () => void run({ type: "inbox" }),
      togglePin: () => {
        const list = items();
        const allPinned = list.length > 0 && list.every((i) => i.pinned);
        void run({ type: "pin", pinned: !allPinned });
      },
      toggleRead: () => {
        const anyUnread = items().some((i) => i.unreadCount > 0);
        void run({ type: "read", read: anyUnread });
      },
      toggleMute: () => {
        const list = items();
        const allMuted = list.length > 0 && list.every((i) => i.muted);
        void run({ type: "mute", muted: !allMuted });
      },
      reply: (mode: ReplyMode) => {
        const id = soleTarget();
        if (id !== null) replyTo(id, mode);
      },
      toggleSelect: () => {
        const n = navStore.getState();
        const id = threadIdOf(n.cursorKey);
        if (id !== null) n.toggleSelected(id);
      },
      toggleSidebar: () => navStore.getState().toggleSidebar(narrow),
      toggleFocused: () => void updateSettings({ inbox: { focused: !settings.inbox.focused } }),
      setLayout: (layout: "split" | "full") => void updateSettings({ appearance: { layout } }),
      goAccount: (index: number) => {
        const a = accounts[index];
        if (a) navStore.getState().go({ view: "inbox", accountId: a.id }, a.email);
      },
    };
  }, [run, undo, settings.inbox.focused, split, narrow, accounts, updateSettings, toast.show]);
}

export type AppCommands = ReturnType<typeof useAppCommands>;
