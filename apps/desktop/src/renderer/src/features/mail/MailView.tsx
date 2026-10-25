import clsx from "clsx";
import { ResizeHandle, usePersistedSize } from "../../ui";
import { useApp } from "../../state/AppContext";
import { useNav } from "../../state/nav";
import { SearchField } from "../search/SearchField";
import { BatchBar } from "./BatchBar";
import { ListHeader } from "./ListHeader";
import { Reader } from "./Reader";
import { ThreadList } from "./ThreadList";
import { useMailList } from "./useMailList";
import styles from "./MailView.module.css";

export const LIST_MIN = 320;
export const LIST_MAX = 560;
export const LIST_DEFAULT = 380;

/** List and reader. Split layout shows both; full layout shows one at a time. */
export function MailView() {
  const { settings } = useApp();
  const openId = useNav((s) => s.openId);
  const selectedCount = useNav((s) => s.selected.length);
  const searchOpen = useNav((s) => s.searchOpen);
  const [width, setWidth] = usePersistedSize("flint.listWidth", LIST_DEFAULT, LIST_MIN, LIST_MAX);
  const split = settings.appearance.layout === "split";
  useMailList(true);

  return (
    <div className={styles.mail}>
      {split || openId === null ? (
        <div className={clsx(styles.list, !split && styles.listFull)} style={split ? { width } : undefined}>
          {selectedCount > 1 ? <BatchBar /> : <ListHeader />}
          {searchOpen ? <SearchField /> : null}
          <ThreadList />
        </div>
      ) : null}
      {split ? <ResizeHandle value={width} min={LIST_MIN} max={LIST_MAX} onResize={setWidth} onReset={() => setWidth(LIST_DEFAULT)} label="Resize list" /> : null}
      {split || openId !== null ? <Reader /> : null}
    </div>
  );
}
