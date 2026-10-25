import type { AiTask } from "../types";
import { askPrompt } from "./prompts";
import { buildAskContext, citedThreads, extractQueries, retrieve, type Hit } from "./ask";
import type { AiContext } from "./ports";
import type { TaskPlan } from "./tasks";

const NO_MATCH = "I couldn't find any mail that matches that. Try a sender's name, a distinctive word or a date.";
const MAX_HISTORY = 10;

type AskTask = Extract<AiTask, { kind: "ask" }>;

export async function planAsk(task: AskTask, ctx: AiContext): Promise<{ plan: TaskPlan; hits: Hit[] }> {
  const history = task.history ?? [];
  const queries = extractQueries(task.question, history);
  const hits = queries.length ? await retrieve(ctx, queries) : [];
  const today = new Date(ctx.now()).toISOString().slice(0, 10);
  if (hits.length === 0) {
    return { hits, plan: { system: "", messages: [], effort: "medium", streamText: true, immediate: NO_MATCH } };
  }
  const excerpts = await buildAskContext(ctx, hits);
  const prior = history.slice(-MAX_HISTORY);
  return {
    hits,
    plan: {
      system: askPrompt(today),
      messages: [
        ...prior,
        { role: "user", content: `<mail_excerpts>\n${excerpts}\n</mail_excerpts>\n\nQuestion: ${task.question}` },
      ],
      effort: "medium",
      streamText: true,
    },
  };
}

export function askCitationsFor(text: string, hits: Hit[]) {
  return citedThreads(text, hits);
}
