import { cloneElement, useRef, useState, type MouseEvent, type ReactElement, type ReactNode, type Ref } from "react";
import {
  FloatingFocusManager, FloatingPortal, autoUpdate, flip, offset, shift, size, useClick, useDismiss, useFloating,
  useInteractions, useListNavigation, useMergeRefs, useRole, useTypeahead, type Placement, type UseFloatingReturn,
} from "@floating-ui/react";
import clsx from "clsx";
import { Kbd } from "./Kbd";
import styles from "./Menu.module.css";

export type MenuAction = {
  id: string;
  label: string;
  icon?: ReactNode;
  /** Combo string for the hint at the right, e.g. "e". */
  shortcut?: string;
  disabled?: boolean;
  danger?: boolean;
  /** Renders a check mark (radio/checkbox style menus). */
  checked?: boolean;
  onSelect: () => void;
};
export type MenuItem = MenuAction | { type: "separator"; id?: string } | { type: "label"; label: string; id?: string };

const isAction = (i: MenuItem): i is MenuAction => !("type" in i);

type PopupProps = {
  items: MenuItem[];
  floating: UseFloatingReturn;
  context: UseFloatingReturn["context"];
  activeIndex: number | null;
  getFloatingProps: (props?: Record<string, unknown>) => Record<string, unknown>;
  getItemProps: (props?: Record<string, unknown>) => Record<string, unknown>;
  listRef: React.MutableRefObject<(HTMLElement | null)[]>;
  close: () => void;
};

function MenuPopup({ items, floating, context, getFloatingProps, getItemProps, listRef, activeIndex, close }: PopupProps) {
  let actionIndex = -1;
  return (
    <FloatingPortal>
      <FloatingFocusManager context={context} initialFocus={0} returnFocus>
        <div ref={floating.refs.setFloating} style={floating.floatingStyles} className={styles.menu} {...getFloatingProps()}>
          {items.map((item, i) => {
            if (!isAction(item)) {
              return "label" in item
                ? <div key={item.id ?? `l${i}`} role="presentation" className={clsx(styles.label, "t-label")}>{item.label}</div>
                : <div key={item.id ?? `s${i}`} role="separator" className={styles.separator} />;
            }
            const idx = ++actionIndex;
            return (
              <button
                key={item.id}
                type="button"
                role="menuitem"
                disabled={item.disabled}
                tabIndex={activeIndex === idx ? 0 : -1}
                ref={(node) => { listRef.current[idx] = item.disabled ? null : node; }}
                className={clsx(styles.item, item.danger && styles.danger, activeIndex === idx && styles.active)}
                {...getItemProps({
                  onClick: () => {
                    item.onSelect();
                    close();
                  },
                })}
              >
                <span className={styles.icon}>{item.icon}</span>
                <span className={styles.text}>{item.label}</span>
                {item.checked ? <span className={styles.check} aria-hidden>✓</span> : null}
                {item.shortcut ? <Kbd combo={item.shortcut} /> : null}
              </button>
            );
          })}
        </div>
      </FloatingFocusManager>
    </FloatingPortal>
  );
}

function useMenuFloating(items: MenuItem[], open: boolean, setOpen: (o: boolean) => void, placement: Placement, extra: Parameters<typeof useInteractions>[0] = []) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const listRef = useRef<(HTMLElement | null)[]>([]);
  const labelsRef = useRef<(string | null)[]>([]);
  const actions = items.filter(isAction);
  labelsRef.current = actions.map((a) => (a.disabled ? null : a.label));

  const floating = useFloating({
    open,
    onOpenChange: setOpen,
    placement,
    whileElementsMounted: autoUpdate,
    middleware: [
      offset(4), flip({ padding: 8 }), shift({ padding: 8 }),
      size({ apply({ elements, availableHeight }) { elements.floating.style.maxHeight = `${Math.max(120, availableHeight)}px`; }, padding: 8 }),
    ],
  });
  const interactions = useInteractions([
    useRole(floating.context, { role: "menu" }),
    useDismiss(floating.context),
    useListNavigation(floating.context, { listRef, activeIndex, onNavigate: setActiveIndex, loop: true }),
    useTypeahead(floating.context, { listRef: labelsRef, activeIndex, onMatch: open ? setActiveIndex : undefined }),
    ...extra,
  ]);
  return { floating, ...interactions, activeIndex, setActiveIndex, listRef };
}

type MenuProps = {
  items: MenuItem[];
  /** A single element (usually an IconButton or Button) that opens the menu on click. */
  trigger: ReactElement<{ ref?: Ref<unknown> } & Record<string, unknown>>;
  placement?: Placement;
};

/** Click-to-open menu. Arrow keys, Home/End, typeahead, Enter/Space to pick, Esc to close. */
export function Menu({ items, trigger, placement = "bottom-start" }: MenuProps) {
  const [open, setOpen] = useState(false);
  const m = useMenuFloating(items, open, setOpen, placement, []);
  const click = useClick(m.floating.context);
  const { getReferenceProps } = useInteractions([click]);
  const ref = useMergeRefs([m.floating.refs.setReference, trigger.props.ref ?? null]);
  return (
    <>
      {cloneElement(trigger, m.getReferenceProps(getReferenceProps({ ...trigger.props, ref, "aria-haspopup": "menu" })))}
      {open ? (
        <MenuPopup
          items={items}
          floating={m.floating}
          context={m.floating.context}
          activeIndex={m.activeIndex}
          getFloatingProps={m.getFloatingProps}
          getItemProps={m.getItemProps}
          listRef={m.listRef}
          close={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

/** Right-click menu over `children`. */
export function ContextMenu({ items, children, className }: { items: MenuItem[]; children: ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  const m = useMenuFloating(items, open, setOpen, "bottom-start");
  const onContextMenu = (e: MouseEvent) => {
    e.preventDefault();
    m.floating.refs.setPositionReference({
      getBoundingClientRect: () => ({ x: e.clientX, y: e.clientY, width: 0, height: 0, top: e.clientY, right: e.clientX, bottom: e.clientY, left: e.clientX }),
    });
    setOpen(true);
  };
  return (
    <div className={className} onContextMenu={onContextMenu}>
      {children}
      {open ? (
        <MenuPopup
          items={items}
          floating={m.floating}
          context={m.floating.context}
          activeIndex={m.activeIndex}
          getFloatingProps={m.getFloatingProps}
          getItemProps={m.getItemProps}
          listRef={m.listRef}
          close={() => setOpen(false)}
        />
      ) : null}
    </div>
  );
}
