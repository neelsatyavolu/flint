import type { JSX } from "react";
import { closeComposer, useComposers } from "./composerStore";
import { Button } from "../../ui/Button";

/** STUB: the compose engineer replaces this file. */
export function ComposerHost(): JSX.Element | null {
  const composers = useComposers();
  if (composers.length === 0) return null;
  return (
    <div style={{ position: "fixed", right: 16, bottom: 16, display: "flex", flexDirection: "column", gap: 8 }}>
      {composers.map((c) => (
        <div key={c.id} style={{ background: "var(--plane-3)", border: "1px solid var(--line-strong)", borderRadius: 4, padding: 12 }}>
          <span className="t-data">Composer placeholder</span>{" "}
          <Button size="sm" variant="ghost" onClick={() => closeComposer(c.id)}>Close</Button>
        </div>
      ))}
    </div>
  );
}
