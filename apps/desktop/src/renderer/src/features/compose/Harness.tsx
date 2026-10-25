import { useState, type JSX } from "react";
import { Button } from "../../ui/Button";
import { AskLauncher } from "../ai/AskLauncher";
import { QuickReplies } from "../ai/QuickReplies";
import { ThreadSummary } from "../ai/ThreadSummary";
import { ComposerHost } from "./ComposerHost";
import { InlineReply } from "./InlineReply";
import { openComposer } from "./composerStore";
import { flint } from "../../lib/api";

/** Dev harness for the composer and AI surfaces (web preview only). Route with ?harness=compose. */
export function Harness(): JSX.Element {
  const [thread, setThread] = useState<{ id: number; messageId: number; count: number } | null>(null);
  const [seed, setSeed] = useState<string | undefined>();

  const load = async () => {
    const page = await flint.listThreads({ view: "inbox", limit: 50 });
    const item = page.items.find((i) => i.messageCount >= 3) ?? page.items[0]!;
    const detail = await flint.getThread(item.id);
    const last = [...detail.messages].reverse().find((m) => !m.isFromMe) ?? detail.messages.at(-1)!;
    setThread({ id: item.id, messageId: last.id, count: item.messageCount });
  };
  const reply = async () => {
    if (!thread) await load();
    const page = await flint.listThreads({ view: "inbox", limit: 50 });
    const item = page.items.find((i) => i.messageCount >= 3) ?? page.items[0]!;
    const detail = await flint.getThread(item.id);
    const last = [...detail.messages].reverse().find((m) => !m.isFromMe) ?? detail.messages.at(-1)!;
    openComposer({ mode: "reply", messageId: last.id });
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "232px 1fr", height: "100%" }}>
      <aside style={{ background: "var(--plane-0)", padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
        <Button variant="secondary" onClick={() => openComposer({ mode: "new" })}>New message</Button>
        <Button variant="ghost" onClick={() => void reply()}>Reply (full)</Button>
        <Button variant="ghost" onClick={() => void load()}>Load thread</Button>
        <Button variant="ghost" onClick={() => document.documentElement.setAttribute("data-theme", document.documentElement.getAttribute("data-theme") === "light" ? "dark" : "light")}>Toggle theme</Button>
      </aside>
      <main style={{ background: "var(--plane-2)", padding: 32, overflow: "auto" }}>
        {thread ? (
          <div style={{ maxWidth: 680, display: "flex", flexDirection: "column", gap: 16 }}>
            <ThreadSummary threadId={thread.id} messageCount={thread.count} wordCount={400} />
            <QuickReplies threadId={thread.id} onPick={setSeed} />
            <InlineReply threadId={thread.id} messageId={thread.messageId} seedText={seed} />
          </div>
        ) : null}
      </main>
      <ComposerHost />
      <AskLauncher />
    </div>
  );
}
