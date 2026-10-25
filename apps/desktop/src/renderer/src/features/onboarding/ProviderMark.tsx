import type { JSX } from "react";
import { Cloud, KeyRound, Mailbox, Server, ShieldCheck, Zap } from "lucide-react";
import type { ProviderId } from "./providers";

export type MarkId = ProviderId | "google";

const SVG = { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true } as const;

/** Quiet monochrome marks: simple glyphs that tell the rows apart, not brand logos. */
export function ProviderMark({ id }: { id: MarkId }): JSX.Element {
  switch (id) {
    case "google":
      return <svg {...SVG}><path d="M19 7.5A8 8 0 1 0 20 12h-8" /></svg>;
    case "yahoo":
      return <svg {...SVG}><path d="M5 5l7 9 7-9M12 14v6" /></svg>;
    case "gmail-app": return <KeyRound size={18} strokeWidth={1.5} />;
    case "icloud": return <Cloud size={18} strokeWidth={1.5} />;
    case "outlook": return <Mailbox size={18} strokeWidth={1.5} />;
    case "fastmail": return <Zap size={18} strokeWidth={1.5} />;
    case "proton-bridge": return <ShieldCheck size={18} strokeWidth={1.5} />;
    default: return <Server size={18} strokeWidth={1.5} />;
  }
}
