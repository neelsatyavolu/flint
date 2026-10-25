import type { JSX } from "react";
import { Button } from "../../ui/Button";
import { openSettings } from "./events";

/** Shown wherever AI is requested but no provider is connected. */
export function NotConnected({ compact = false }: { compact?: boolean }): JSX.Element {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", padding: compact ? "8px 0" : "12px 0" }}>
      <span className="t-body" style={{ color: "var(--fg-2)" }}>Connect ChatGPT or Grok in Settings → +AI</span>
      <Button size="sm" variant="ghost" onClick={() => openSettings("ai")}>Open settings</Button>
    </div>
  );
}
