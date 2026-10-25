import type { ReactNode, RefObject } from "react";
import { FloatingFocusManager, FloatingOverlay, FloatingPortal, useDismiss, useFloating, useInteractions, useRole } from "@floating-ui/react";
import clsx from "clsx";
import styles from "./Modal.module.css";

type Props = {
  open: boolean;
  onClose: () => void;
  label: string;
  width?: number;
  /** Element to focus first; defaults to the first focusable element. */
  initialFocus?: RefObject<HTMLElement | null>;
  className?: string;
  children: ReactNode;
};

/** Headerless modal near the top of the window: command palette, pickers. Esc and outside press close. */
export function Modal({ open, onClose, label, width = 560, initialFocus, className, children }: Props) {
  const { refs, context } = useFloating({ open, onOpenChange: (o) => !o && onClose() });
  const { getFloatingProps } = useInteractions([useDismiss(context, { outsidePressEvent: "mousedown" }), useRole(context, { role: "dialog" })]);
  if (!open) return null;
  return (
    <FloatingPortal>
      <FloatingOverlay lockScroll className={styles.overlay}>
        <FloatingFocusManager context={context} initialFocus={initialFocus ?? 0} returnFocus>
          <div ref={refs.setFloating} aria-label={label} style={{ width }} className={clsx(styles.panel, className)} {...getFloatingProps()}>
            {children}
          </div>
        </FloatingFocusManager>
      </FloatingOverlay>
    </FloatingPortal>
  );
}
