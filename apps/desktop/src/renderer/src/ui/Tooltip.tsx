import { cloneElement, useState, type ReactElement, type Ref } from "react";
import {
  FloatingPortal, autoUpdate, flip, offset, shift, useDismiss, useFloating, useFocus, useHover,
  useInteractions, useMergeRefs, useRole, safePolygon,
} from "@floating-ui/react";
import { Kbd } from "./Kbd";
import styles from "./Tooltip.module.css";

type Props = {
  label: string;
  /** Combo string shown as a hint, e.g. "e" or "mod+shift+z". */
  shortcut?: string;
  placement?: "top" | "bottom" | "left" | "right";
  delay?: number;
  children: ReactElement<{ ref?: Ref<unknown> } & Record<string, unknown>>;
};

export function Tooltip({ label, shortcut, placement = "bottom", delay = 450, children }: Props) {
  const [open, setOpen] = useState(false);
  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    placement,
    whileElementsMounted: autoUpdate,
    middleware: [offset(6), flip(), shift({ padding: 8 })],
  });
  const { getReferenceProps, getFloatingProps } = useInteractions([
    useHover(context, { move: false, delay: { open: delay, close: 0 }, handleClose: safePolygon() }),
    useFocus(context, { visibleOnly: true }),
    // Escape closes the tooltip and still reaches the dialog or composer behind it (one press, not two).
    useDismiss(context, { referencePress: true, bubbles: { escapeKey: true } }),
    useRole(context, { role: "tooltip" }),
  ]);
  const ref = useMergeRefs([refs.setReference, children.props.ref ?? null]);

  return (
    <>
      {cloneElement(children, getReferenceProps({ ...children.props, ref }))}
      {open ? (
        <FloatingPortal>
          <div ref={refs.setFloating} style={floatingStyles} className={styles.tip} {...getFloatingProps()}>
            <span>{label}</span>
            {shortcut ? <Kbd combo={shortcut} /> : null}
          </div>
        </FloatingPortal>
      ) : null}
    </>
  );
}
