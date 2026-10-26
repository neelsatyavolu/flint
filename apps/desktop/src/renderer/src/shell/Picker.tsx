import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import clsx from "clsx";
import { filterItems, type PickItem } from "../features/palette/filter";
import { Kbd } from "../ui";
import { Modal } from "./Modal";
import styles from "./Picker.module.css";

export type PickerItem = PickItem & { icon?: ReactNode; shortcut?: string };

type Props = {
  label: string;
  placeholder: string;
  items: PickerItem[];
  onPick: (item: PickerItem) => void;
  onClose: () => void;
  emptyText?: string;
  width?: number;
};

/** Typeahead list in a modal: type to filter, arrows to move, Enter to pick. */
export function Picker({ label, placeholder, items, onPick, onClose, emptyText = "Nothing matches.", width }: Props) {
  const uid = useId().replace(/:/g, "");
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const shown = useMemo(() => filterItems(items, query), [items, query]);
  const at = Math.min(active, Math.max(0, shown.length - 1));

  useEffect(() => {
    list.current?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView?.({ block: "nearest" });
  }, [at, shown]);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown") setActive((at + 1) % Math.max(1, shown.length));
    else if (e.key === "ArrowUp") setActive((at - 1 + shown.length) % Math.max(1, shown.length));
    else if (e.key === "Enter") {
      const item = shown[at];
      if (item) onPick(item);
    } else return;
    e.preventDefault();
  };

  let lastGroup: string | undefined;
  return (
    <Modal open onClose={onClose} label={label} width={width} initialFocus={input}>
      <input
        ref={input}
        className={clsx("t-body", styles.input)}
        value={query}
        placeholder={placeholder}
        aria-label={label}
        role="combobox"
        aria-expanded
        aria-controls={`${uid}-list`}
        aria-activedescendant={shown[at] ? `${uid}-opt-${at}` : undefined}
        onChange={(e) => { setQuery(e.target.value); setActive(0); }}
        onKeyDown={onKeyDown}
        spellCheck={false}
        autoComplete="off"
      />
      <div ref={list} id={`${uid}-list`} role="listbox" aria-label={label} className={styles.list}>
        {shown.length === 0 ? <p className={clsx("t-body", styles.empty)}>{emptyText}</p> : null}
        {shown.map((item, i) => {
          const header = !query && item.group && item.group !== lastGroup ? item.group : null;
          lastGroup = item.group;
          return (
            <div key={item.id}>
              {header ? <div className={clsx("t-label", styles.group)}>{header}</div> : null}
              <button
                type="button"
                id={`${uid}-opt-${i}`}
                role="option"
                aria-selected={i === at}
                data-active={i === at}
                tabIndex={-1}
                className={clsx(styles.item, i === at && styles.on)}
                onMouseMove={() => setActive(i)}
                onClick={() => onPick(item)}
              >
                {item.icon ? <span className={styles.icon}>{item.icon}</span> : null}
                <span className={styles.text}>{item.label}</span>
                {item.shortcut ? <Kbd combo={item.shortcut} /> : (item.hint ?? (query ? item.group : undefined)) ? <span className={clsx("t-data", styles.hint)}>{item.hint ?? item.group}</span> : null}
              </button>
            </div>
          );
        })}
      </div>
    </Modal>
  );
}
