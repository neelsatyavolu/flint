import type { JSX } from "react";
import { Button } from "../../ui/Button";

/** STUB: the settings engineer replaces this file. */
export function SettingsView(props: { section?: string; onClose: () => void }): JSX.Element {
  return (
    <div style={{ padding: 24 }}>
      <h1 className="t-title">Settings{props.section ? `: ${props.section}` : ""}</h1>
      <Button variant="ghost" onClick={props.onClose}>Close</Button>
    </div>
  );
}
