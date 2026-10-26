import { cloneElement, useState, type ReactElement, type ReactNode, type Ref } from "react";
import {
  FloatingFocusManager, FloatingPortal, autoUpdate, flip, offset, shift, size, useClick, useDismiss, useFloating,
  useInteractions, useMergeRefs, useRole, type Placement,
} from "@floating-ui/react";
import clsx from "clsx";
import styles from "./Popover.module.css";

type PopoverProps = {
  trigger: ReactElement<{ ref?: Ref<unknown> } & Record<string, unknown>>;
  /** Content, or a function that receives `close`. */
  children: ReactNode | ((close: () => void) => ReactNode);
  placement?: Placement;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
  /** Accessible name of the popover. */
  label?: string;
};

/** Plane-3 floating panel opened by click, with focus trap-lite (focus moves in, Esc and outside click close, focus returns). */
export function Popover({ trigger, children, placement = "bottom-start", open: controlled, onOpenChange, className, label }: PopoverProps) {
  const [inner, setInner] = useState(false);
  const open = controlled ?? inner;
  const setOpen = (o: boolean) => {
    setInner(o);
    onOpenChange?.(o);
  };
  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    placement,
    whileElementsMounted: autoUpdate,
    middleware: [
      offset(4), flip({ padding: 8 }), shift({ padding: 8 }),
      // Long content (a big Cc list, the sync problems list) scrolls inside the panel instead of running off-screen.
      size({ apply({ elements, availableHeight }) { elements.floating.style.maxHeight = `${Math.max(120, availableHeight)}px`; }, padding: 8 }),
    ],
  });
  const { getReferenceProps, getFloatingProps } = useInteractions([
    useClick(context),
    useDismiss(context),
    useRole(context, { role: "dialog" }),
  ]);
  const ref = useMergeRefs([refs.setReference, trigger.props.ref ?? null]);
  const close = () => setOpen(false);
  return (
    <>
      {cloneElement(trigger, getReferenceProps({ ...trigger.props, ref }))}
      {open ? (
        <FloatingPortal>
          <FloatingFocusManager context={context} initialFocus={0} returnFocus>
            <div ref={refs.setFloating} style={floatingStyles} aria-label={label} className={clsx(styles.popover, className)} {...getFloatingProps()}>
              {typeof children === "function" ? children(close) : children}
            </div>
          </FloatingFocusManager>
        </FloatingPortal>
      ) : null}
    </>
  );
}
