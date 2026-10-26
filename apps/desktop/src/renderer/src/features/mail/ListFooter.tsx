import clsx from "clsx";
import { listStore, useList } from "../../state/listStore";
import { useNav } from "../../state/nav";
import styles from "./ListFooter.module.css";

/** What a list's local rows leave unsaid: older mail still on the server, or a search the server has not answered. */
export function ListFooter({ empty = false }: { empty?: boolean }) {
  const searching = useList((s) => s.query?.view === "search");
  const hasMore = useList((s) => s.nextCursor !== null);
  const olderOnServer = useList((s) => s.olderOnServer);
  const loadingOlder = useList((s) => s.loadingOlder);
  const olderError = useList((s) => s.olderError);
  const serverSearch = useList((s) => s.serverSearch);
  const loadingMore = useList((s) => s.loadingMore);
  const pageError = useList((s) => s.pageError);
  // The "Has attachments" filter runs as a search too, but it is not one the user typed.
  const filterSearch = useNav((s) => s.listFilter !== "all" && !(s.searchOpen && s.search.trim()));
  if (pageError && !loadingMore) {
    return (
      <div className={styles.foot} role="status">
        <span className={styles.text}>Couldn't load more.</span>
        <button type="button" className={styles.link} onClick={() => void (hasMore ? listStore.getState().loadMore() : listStore.getState().refresh())}>Try again</button>
      </div>
    );
  }
  if (hasMore || loadingMore) return null;

  if (loadingOlder) return <div className={styles.foot} role="status"><span className={clsx(styles.text, styles.pulse)}>Loading older mail</span></div>;
  if (serverSearch === "searching") return <div className={styles.foot} role="status"><span className={clsx(styles.text, styles.pulse)}>Searching the server…</span></div>;
  if (olderError) {
    return (
      <div className={styles.foot} role="status">
        <span className={styles.text}>Couldn't load older mail. {olderError}</span>
        <button type="button" className={styles.link} onClick={() => void listStore.getState().loadOlder()}>Try again</button>
      </div>
    );
  }
  if (serverSearch === "error") {
    return (
      <div className={styles.foot} role="status">
        <span className={styles.text}>Couldn't search the server. Check your connection.</span>
        <button type="button" className={styles.link} onClick={() => void listStore.getState().searchServer({ explicit: true })}>Try again</button>
      </div>
    );
  }
  if (olderOnServer) {
    return (
      <div className={styles.foot}>
        <span className={styles.text}>Older mail isn't on this computer yet</span>
        <span className={styles.dot} aria-hidden>·</span>
        <button type="button" className={styles.link} onClick={() => void listStore.getState().loadOlder()}>Load more</button>
      </div>
    );
  }
  if (searching && !filterSearch && (serverSearch === "idle" || serverSearch === "done") && !empty) {
    return (
      <div className={styles.foot}>
        <span className={styles.text}>Not seeing it?</span>
        <button type="button" className={styles.link} onClick={() => void listStore.getState().searchServer({ explicit: true })}>Search the server</button>
      </div>
    );
  }
  return null;
}
