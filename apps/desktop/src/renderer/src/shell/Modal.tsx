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
  /** Opens beside this element (its rect) instead of at the top centre, without dimming the window. */
  anchor?: DOMRect | null;
  children: ReactNode;
};

/** Headerless modal near the top of the window: command palette, pickers. Esc and outside press close. */
export function Modal({ open, onClose, label, width = 560, initialFocus, className, anchor, children }: Props) {
  const { refs, context } = useFloating({ open, onOpenChange: (o) => !o && onClose() });
  const { getFloatingProps } = useInteractions([useDismiss(context, { outsidePressEvent: "mousedown" }), useRole(context, { role: "dialog" })]);
  if (!open) return null;
  const placed = anchor ? anchoredStyle(anchor, width) : undefined;
  return (
    <FloatingPortal>
      <FloatingOverlay lockScroll className={clsx(styles.overlay, anchor && styles.anchored)}>
        <FloatingFocusManager context={context} initialFocus={initialFocus ?? 0} returnFocus>
          <div ref={refs.setFloating} aria-label={label} style={{ width, ...placed }} className={clsx(styles.panel, className)} {...getFloatingProps()}>
            {children}
          </div>
        </FloatingFocusManager>
      </FloatingOverlay>
    </FloatingPortal>
  );
}

const PANEL_ALLOWANCE = 380;

/** Below the anchor, left edges aligned, kept inside the window. */
export function anchoredStyle(anchor: DOMRect, width: number): { position: "fixed"; top: number; left: number } {
  const left = Math.max(8, Math.min(anchor.left, window.innerWidth - width - 8));
  const below = anchor.bottom + 6;
  const top = below + PANEL_ALLOWANCE > window.innerHeight ? Math.max(8, window.innerHeight - PANEL_ALLOWANCE - 8) : below;
  return { position: "fixed", top, left };
}
