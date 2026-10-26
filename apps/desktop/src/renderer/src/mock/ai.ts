import type { AiChunk, AiTask, ThreadId } from "@flint/core";
import type { MockState, MThread } from "./state";
import { unreadCount } from "./threads";

type Emit = (chunk: AiChunk) => void;

const STREAM_MS = 1000;
/** `?aiError` in the browser preview makes "Catch me up" fail after it starts, to show the error state. */
const failDigest = (): boolean => typeof window !== "undefined" && new URLSearchParams(window.location.search).has("aiError");

function threadOf(state: MockState, id: ThreadId) {
  return state.threads.find((t) => t.id === id);
}

const ASKS = /\?|please|let me know|can you|could you|confirm/i;

const lastOf = (t: MThread) => t.messages.at(-1);
const senderOf = (t: MThread) => lastOf(t)?.from[0]?.name.split(" ")[0] || "Someone";

/** Inbox threads in the order the real digest numbers them: unread people mail, newest first. */
export function digestThreads(state: MockState): MThread[] {
  return state.threads
    .filter((t) => t.location === "inbox" && t.category === "people" && unreadCount(t) > 0)
    .sort((a, b) => (lastOf(b)?.date ?? 0) - (lastOf(a)?.date ?? 0))
    .slice(0, 6);
}

/** Notifications or newsletters threads, unread first, as the bundle summary numbers them. */
export function bundleThreads(state: MockState, category: "notifications" | "newsletters"): MThread[] {
  return state.threads.filter((t) => t.location === "inbox" && t.category === category).sort((a, b) => unreadCount(b) - unreadCount(a)).slice(0, 8);
}

function fakeDigest(state: MockState): string {
  const list = digestThreads(state);
  if (list.length === 0) return "Nothing unread from people. You're caught up.";
  const asks = list.map((t, i) => ({ t, n: i + 1 })).filter(({ t }) => ASKS.test(lastOf(t)?.snippet ?? ""));
  const rest = list.map((t, i) => ({ t, n: i + 1 })).filter(({ t }) => !asks.some((a) => a.t === t));
  const line = ({ t, n }: { t: MThread; n: number }, verb: string) => `- ${senderOf(t)} ${verb} ${t.subject.replace(/^(re|fwd?):\s*/i, "")}. [${n}]`;
  return [
    asks.length ? ["Needs a reply", ...asks.map((a) => line(a, "is waiting on you about"))].join("\n") : "",
    rest.length ? ["Worth knowing", ...rest.map((r) => line(r, "wrote about"))].join("\n") : "",
  ].filter(Boolean).join("\n");
}

function fakeBundle(state: MockState, category: "notifications" | "newsletters"): string {
  const list = bundleThreads(state, category);
  if (list.length === 0) return "There's nothing in this bundle to summarize.";
  const items = list.slice(0, 4).map((t, i) => `- ${senderOf(t)}: ${t.subject}. [${i + 1}]`);
  return [...items, "The rest is routine."].join("\n");
}

function fakeNeedsReply(state: MockState): string {
  const rows = state.threads
    .filter((t) => t.location === "inbox" && t.category === "people" && !lastOf(t)?.isFromMe && ASKS.test(lastOf(t)?.snippet ?? ""))
    .sort((a, b) => (lastOf(b)?.date ?? 0) - (lastOf(a)?.date ?? 0))
    .slice(0, 5)
    .map((t) => {
      const m = lastOf(t)!;
      const from = m.from[0] ?? { name: "", address: "" };
      return { threadId: t.id, subject: t.subject, from, date: m.date, unreadCount: unreadCount(t), reason: /\?/.test(m.snippet) ? "question" : "request" };
    });
  return JSON.stringify(rows);
}

/** Canned output per task kind, shaped like the real tasks (see SPEC §7). */
export function fakeAiText(state: MockState, task: AiTask): string {
  switch (task.kind) {
    case "summarize": {
      const t = threadOf(state, task.threadId);
      if (t?.subject === "Freelancing Cycle 3") {
        return "Rodney sent the countersigned Cycle 3 agreement. Onboarding is in scope, the dashboard moves to cycle 4, and the in-app tour was cut to hold the earlier launch date.\n\nAction needed:\n- Confirm you can start Monday morning\n- Carla sends the kickoff invite";
      }
      const names = [...new Set((t?.messages ?? []).map((m) => (m.isFromMe ? "You" : m.from[0]?.name.split(" ")[0] ?? "Someone")))];
      return `${names.slice(0, 3).join(", ")} discuss "${t?.subject ?? "this thread"}". The scope was agreed, the date moved earlier, and the signed copy is now attached.\n\nAction needed:\n- Confirm you can start Monday morning\n- File the countersigned agreement`;
    }
    case "reply":
      return `Thanks for the update. That works for me, and I can start Monday morning.${task.instructions ? ` (${task.instructions})` : ""}\n\nI will file the agreement and send the kickoff notes tonight.`;
    case "quickReplies":
      return JSON.stringify(["Sounds good, thanks.", "Can we do Thursday instead?", "Let me check and get back to you."]);
    case "compose":
      return `Hi,\n\n${task.prompt.trim().replace(/^\w/, (c) => c.toUpperCase())}. Let me know if that works and I will take care of the rest.\n\nBest,\nAlex`;
    case "rewrite":
      return task.style === "shorter" ? task.text.split(/(?<=\.)\s/)[0] ?? task.text : `${task.text.trim()} (rewritten: ${task.style})`;
    case "translate":
      return task.text ? `[${task.language}] ${task.text}` : `Thanks for the update. That works for me, and I can start Monday morning.\n\nI will file the agreement tonight.`;
    case "digest":
      return fakeDigest(state);
    case "summarizeBundle":
      return fakeBundle(state, task.category);
    case "needsReply":
      return fakeNeedsReply(state);
    case "ask":
      return "The latest on Cycle 3: Rodney sent the countersigned agreement yesterday, and the kickoff is set for Monday. Invoice 2291 from Quillworks was approved on Oct 21 and is scheduled for payment on the 30th.";
  }
}

/**
 * Streams `text` as ~16 chunks over about a second, then citations (digest, bundle, ask) and a done chunk,
 * all as `ai` events, the path the catch-up store and useAiRun listen on. Returns a cancel function.
 */
export function streamFakeAi(state: MockState, runId: string, task: AiTask, emit: Emit): () => void {
  const full = fakeAiText(state, task);
  const parts = full.match(/\S+\s*/g) ?? [full];
  const per = Math.max(1, Math.ceil(parts.length / 16));
  const chunks: string[] = [];
  for (let i = 0; i < parts.length; i += per) chunks.push(parts.slice(i, i + per).join(""));
  const timers: ReturnType<typeof setTimeout>[] = [];
  const step = STREAM_MS / (chunks.length + 1);
  emit({ runId, type: "status", text: task.kind === "ask" ? "Searching your mail" : "Thinking" });
  if (task.kind === "digest" && failDigest()) {
    const t = setTimeout(() => emit({ runId, type: "error", message: "The AI provider didn't answer." }), STREAM_MS / 2);
    return () => clearTimeout(t);
  }
  chunks.forEach((c, i) => timers.push(setTimeout(() => emit({ runId, type: "text", text: c }), step * (i + 1))));
  timers.push(
    setTimeout(() => {
      if (task.kind === "digest" || task.kind === "summarizeBundle") {
        const list = task.kind === "digest" ? digestThreads(state) : bundleThreads(state, task.category);
        emit({ runId, type: "citations", threads: list.map((t) => ({ threadId: t.id, subject: t.subject })) });
      }
      if (task.kind === "ask") {
        const cited = state.threads.filter((t) => /Cycle 3|Invoice 2291/.test(t.subject)).slice(0, 2);
        emit({ runId, type: "citations", threads: cited.map((t) => ({ threadId: t.id, subject: t.subject })) });
      }
      emit({ runId, type: "done", text: full });
    }, STREAM_MS + 20),
  );
  return () => timers.forEach(clearTimeout);
}
