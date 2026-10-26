import { Component, type ReactNode } from "react";
import clsx from "clsx";
import { Button } from "./Button";
import { FlintMark } from "./FlintMark";
import styles from "./ErrorBoundary.module.css";

type Props = { children: ReactNode; className?: string };
type State = { error: Error | null };

/**
 * Catches a render crash below it and shows "Something went wrong" with a Reload button instead of a blank window.
 * Wraps the whole app; panes can wrap themselves too so one bad message doesn't take the rest down.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: unknown): State {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className={clsx(styles.plane, this.props.className)} role="alert">
        <FlintMark size={48} className={styles.mark} />
        <h2 className="t-title">Something went wrong</h2>
        <p className={styles.desc}>Flint hit an error it couldn't recover from. Reload to start this window again; your mail and drafts are saved.</p>
        {error.message ? <p className={clsx("t-data", styles.detail)}>{error.message}</p> : null}
        <Button onClick={() => window.location.reload()}>Reload</Button>
      </div>
    );
  }
}
