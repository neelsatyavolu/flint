import { useEffect } from "react";
import { flint } from "../../lib/api";
import { useApp } from "../../state/AppContext";
import { listStore } from "../../state/listStore";
import { buildQuery, navStore, useNav } from "../../state/nav";

const REFRESH_DEBOUNCE_MS = 120;
/** A search with fewer local results than this also asks the server, after the query settles. */
const FEW_LOCAL = 10;
const SERVER_SEARCH_DELAY_MS = 700;

/** Keeps the list store on the query for the current navigation, and refetches on mail events. */
export function useMailList(enabled: boolean): void {
  const { settings } = useApp();
  const view = useNav((s) => s.view);
  const accountId = useNav((s) => s.accountId);
  const folderId = useNav((s) => s.folderId);
  const category = useNav((s) => s.category);
  const search = useNav((s) => s.search);
  const searchOpen = useNav((s) => s.searchOpen);
  const focused = settings.inbox.focused;
  const sort = settings.inbox.sort;

  useEffect(() => {
    if (!enabled) return;
    const query = buildQuery({ view, accountId, folderId, category, search, searchOpen }, { inbox: { ...settings.inbox, focused, sort } });
    listStore.getState().setQuery(query);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, view, accountId, folderId, category, search, searchOpen, focused, sort]);

  useEffect(() => {
    if (!enabled || !searchOpen || !search.trim()) return;
    const timer = setTimeout(() => {
      const list = listStore.getState();
      if (list.status === "ready" && list.items.length < FEW_LOCAL) void list.searchServer();
    }, SERVER_SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [enabled, search, searchOpen, accountId]);

  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const off = flint.subscribe((e) => {
      if (e.type !== "mail_changed" && e.type !== "new_mail") return;
      if (e.type === "mail_changed") listStore.getState().forgetInSnapshots(e.threadIds);
      clearTimeout(timer);
      timer = setTimeout(() => void listStore.getState().refresh(), REFRESH_DEBOUNCE_MS);
    });
    return () => {
      clearTimeout(timer);
      off();
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled) navStore.getState().clearSelected();
  }, [enabled]);
}
