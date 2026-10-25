import type { ReactNode } from "react";
import { FloatingFocusManager, FloatingOverlay, FloatingPortal, useDismiss, useFloating, useInteractions, useRole } from "@floating-ui/react";
import { X } from "lucide-react";
import clsx from "clsx";
import { IconButton } from "./IconButton";
import styles from "./Dialog.module.css";

type Common = {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Hides the visible title but keeps it as the accessible name. */
  hideTitle?: boolean;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
};

function Layer({ variant, width, open, onClose, title, hideTitle, children, footer, className }: Common & { variant: "dialog" | "sheet"; width: number }) {
  const { refs, context } = useFloating({ open, onOpenChange: (o) => !o && onClose() });
  const { getFloatingProps } = useInteractions([useDismiss(context, { outsidePressEvent: "mousedown" }), useRole(context, { role: "dialog" })]);
  if (!open) return null;
  return (
    <FloatingPortal>
      <FloatingOverlay lockScroll className={clsx(styles.overlay, variant === "sheet" && styles.sheetOverlay)}>
        <FloatingFocusManager context={context} initialFocus={0} returnFocus>
          <section
            ref={refs.setFloating}
            aria-label={title}
            style={{ width }}
            className={clsx(styles.panel, variant === "sheet" ? styles.sheet : styles.dialog, className)}
            {...getFloatingProps()}
          >
            <header className={styles.header}>
              <h2 className={clsx("t-title", hideTitle && "sr-only")}>{title}</h2>
              <IconButton label="Close" shortcut="Escape" onClick={onClose} className={styles.close}><X size={16} strokeWidth={1.5} /></IconButton>
            </header>
            <div className={styles.body}>{children}</div>
            {footer ? <footer className={styles.footer}>{footer}</footer> : null}
          </section>
        </FloatingFocusManager>
      </FloatingOverlay>
    </FloatingPortal>
  );
}

/** Centered modal. Focus is trapped; Esc and outside press close. */
export function Dialog({ width = 440, ...rest }: Common & { width?: number }) {
  return <Layer variant="dialog" width={width} {...rest} />;
}

/** Right-edge sheet (side panels over the reader). Same behavior as Dialog. */
export function Sheet({ width = 380, ...rest }: Common & { width?: number }) {
  return <Layer variant="sheet" width={width} {...rest} />;
}
