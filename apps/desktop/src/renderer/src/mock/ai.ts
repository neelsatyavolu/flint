import type { AiChunk, AiTask, ThreadId } from "@flint/core";
import type { MockState } from "./state";

type Emit = (chunk: AiChunk) => void;

const STREAM_MS = 1000;

function threadOf(state: MockState, id: ThreadId) {
  return state.threads.find((t) => t.id === id);
}

/** Canned output per task kind, shaped like the real tasks (see SPEC §7). */
export function fakeAiText(state: MockState, task: AiTask): string {
  switch (task.kind) {
    case "summarize": {
      const t = threadOf(state, task.threadId);
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
      return `[${task.language}] ${task.text ?? "Thanks for the update. That works for me."}`;
    case "ask":
      return "The latest on Cycle 3: Rodney sent the countersigned agreement yesterday, and the kickoff is set for Monday. Invoice 2291 from Quillworks was approved on Oct 21 and is scheduled for payment on the 30th.";
  }
}

/** Streams `text` as ~16 chunks over about a second, then a done chunk. Returns a cancel function. */
export function streamFakeAi(state: MockState, runId: string, task: AiTask, emit: Emit): () => void {
  const full = fakeAiText(state, task);
  const parts = full.match(/\S+\s*/g) ?? [full];
  const per = Math.max(1, Math.ceil(parts.length / 16));
  const chunks: string[] = [];
  for (let i = 0; i < parts.length; i += per) chunks.push(parts.slice(i, i + per).join(""));
  const timers: ReturnType<typeof setTimeout>[] = [];
  const step = STREAM_MS / (chunks.length + 1);
  emit({ runId, type: "status", text: task.kind === "ask" ? "Searching your mail" : "Thinking" });
  chunks.forEach((c, i) => timers.push(setTimeout(() => emit({ runId, type: "text", text: c }), step * (i + 1))));
  timers.push(
    setTimeout(() => {
      if (task.kind === "ask") {
        const cited = state.threads.filter((t) => /Cycle 3|Invoice 2291/.test(t.subject)).slice(0, 2);
        emit({ runId, type: "citations", threads: cited.map((t) => ({ threadId: t.id, subject: t.subject })) });
      }
      emit({ runId, type: "done", text: full });
    }, STREAM_MS + 20),
  );
  return () => timers.forEach(clearTimeout);
}
