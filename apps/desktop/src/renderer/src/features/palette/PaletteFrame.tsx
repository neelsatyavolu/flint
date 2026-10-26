import type { JSX, ReactNode, RefObject } from "react";
import { FloatingFocusManager, FloatingPortal, useDismiss, useFloating, useInteractions, useRole } from "@floating-ui/react";
import clsx from "clsx";
import styles from "./CommandPalette.module.css";

type Props = { label: string; closing: boolean; initialFocus: RefObject<HTMLElement | null>; onDismiss: () => void; onKeyDown: (e: React.KeyboardEvent) => void; children: ReactNode };

/** The palette's own dialog shell: 120 ms fade and slight scale in and out, Escape left to the palette so it can step back first. */
export function PaletteFrame({ label, closing, initialFocus, onDismiss, onKeyDown, children }: Props): JSX.Element {
  const { refs, context } = useFloating({ open: true, onOpenChange: (o) => !o && onDismiss() });
  const { getFloatingProps } = useInteractions([useDismiss(context, { escapeKey: false, outsidePressEvent: "mousedown" }), useRole(context, { role: "dialog" })]);
  return (
    <FloatingPortal>
      <div className={clsx(styles.overlay, closing && styles.overlayOut)}>
        <FloatingFocusManager context={context} initialFocus={initialFocus} returnFocus>
          <div ref={refs.setFloating} aria-label={label} className={clsx(styles.panel, closing && styles.panelOut)} {...getFloatingProps({ onKeyDown })}>
            {children}
          </div>
        </FloatingFocusManager>
      </div>
    </FloatingPortal>
  );
}
