import type { JSX } from "react";
import type { Account } from "@flint/core";
import { Button } from "../../ui/Button";

/** STUB: the onboarding engineer replaces this file. */
export function AddAccount(props: { onDone: (account: Account) => void; onCancel?: () => void; welcome?: boolean }): JSX.Element {
  return (
    <div style={{ padding: 24 }}>
      <h1 className="t-title">{props.welcome ? "Welcome to Flint" : "Add account"}</h1>
      {props.onCancel ? <Button variant="ghost" onClick={props.onCancel}>Cancel</Button> : null}
    </div>
  );
}
