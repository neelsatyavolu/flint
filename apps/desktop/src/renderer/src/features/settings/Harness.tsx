import { useState, type JSX } from "react";
import { AddAccount } from "../onboarding/AddAccount";
import { SettingsView } from "./SettingsView";

/**
 * Preview harness for the settings and onboarding views, for the web preview.
 * Route it from main.tsx on ?harness=settings (&section=rules), ?harness=welcome or ?harness=add-account.
 */
export function SettingsHarness({ params }: { params: URLSearchParams }): JSX.Element {
  const kind = params.get("harness");
  const [closed, setClosed] = useState(false);
  if (kind === "welcome") return <div style={{ height: "100vh" }}><AddAccount welcome onDone={() => setClosed(true)} /></div>;
  if (kind === "add-account") return <div style={{ padding: 32, maxWidth: 520 }}><AddAccount onDone={() => setClosed(true)} onCancel={() => setClosed(true)} /></div>;
  if (closed) return <div style={{ padding: 32 }} role="status">Closed</div>;
  return <div style={{ height: "100vh" }}><SettingsView section={params.get("section") ?? undefined} onClose={() => setClosed(true)} /></div>;
}
