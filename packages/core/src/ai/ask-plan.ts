import type { AiTask } from "../types";
import { formatToday } from "./context";
import { askPrompt } from "./prompts";
import {
  buildAskContext, citedThreads, extractQueries, extractSearchPlan, retrieve, retrieveRanked, stripDateFilters, type Hit,
} from "./ask";
import type { AiContext } from "./ports";
import type { TaskPlan } from "./tasks";

const NO_MATCH = "I couldn't find any mail that matches that. Try a sender's name, a distinctive word or a date.";
const MAX_HISTORY = 10;

type AskTask = Extract<AiTask, { kind: "ask" }>;

export async function planAsk(task: AskTask, ctx: AiContext): Promise<{ plan: TaskPlan; hits: Hit[] }> {
  const history = task.history ?? [];
  let hits: Hit[];
  if (ctx.rankedSearchForAi) {
    const search = extractSearchPlan(task.question, history, ctx.now(), ctx.timeZone);
    hits = search ? await retrieveRanked(ctx, search) : [];
    if (hits.length === 0 && search && (search.after !== undefined || search.before !== undefined)) {
      // A date window that was guessed wrong should not hide everything.
      const { after: _a, before: _b, ...undated } = search;
      hits = await retrieveRanked(ctx, undated);
    }
  } else {
    const queries = extractQueries(task.question, history, ctx.now(), ctx.timeZone);
    hits = queries.length ? await retrieve(ctx, queries) : [];
    if (hits.length === 0 && queries.length) {
      const undated = queries.map(stripDateFilters).filter((q, i) => q !== queries[i] && q);
      if (undated.length) hits = await retrieve(ctx, undated);
    }
  }
  const today = formatToday(ctx.now(), ctx.timeZone);
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
