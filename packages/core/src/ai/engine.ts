import { randomUUID } from "node:crypto";
import type { Provider } from "@neelsatyavolu/shared-ai-auth";
import { logger } from "../log";
import { FlintError, type AiChunk, type AiProvider, type AiStatus, type AiTask } from "../types";
import { createAuth, type AuthOptions } from "./auth";
import { createModelCatalog } from "./models";
import type { AiContext } from "./ports";
import { AiStreamError, streamModel, type ChatMessage } from "./stream";
import { OutputRejected, parseTask, planTask, type TaskPlan } from "./tasks";

const log = logger("ai");
export const MODEL_SECRET_KEY = "ai:model";

export type AiEngineOptions = AuthOptions & {
  /** Idle timeout for the model stream; tests shorten it. */
  idleTimeoutMs?: number;
  retryDelayMs?: number;
};

type Emit = (chunk: AiChunk extends infer C ? (C extends { runId: string } ? Omit<C, "runId"> : never) : never) => void;

function toFlintError(err: unknown): FlintError {
  if (err instanceof FlintError) return err;
  if (err instanceof AiStreamError) {
    const code = err.status === 401 || err.status === 403 ? "auth" : err.status === null || err.status === 429 || err.status >= 500 ? "network" : "internal";
    return new FlintError(code, err.message);
  }
  log.error("unexpected AI failure", { error: err instanceof Error ? err.message : String(err) });
  return new FlintError("internal", "Something went wrong with the AI request. Try again.");
}

export function createAiEngine(ctx: AiContext, options: AiEngineOptions = {}) {
  const auth = createAuth(ctx, options);
  const models = createModelCatalog({ ...(ctx.fetch ? { fetch: ctx.fetch } : {}), now: ctx.now });
  const runs = new Map<string, AbortController>();

  async function status(): Promise<AiStatus> {
    const ai = ctx.getSettings().ai;
    const current = await auth.stored();
    if (!current) return { provider: null, connected: false, model: null, models: [], enabled: ai.enabled };
    const list = await models.list(current.provider);
    const chosen = (await ctx.secrets.get(MODEL_SECRET_KEY)) ?? ai.model;
    const model = await models.resolve(current.provider, chosen);
    return { provider: current.provider as AiProvider, connected: true, model, models: list, enabled: ai.enabled };
  }

  async function setModel(model: string): Promise<AiStatus> {
    const current = await auth.stored();
    if (!current) throw new FlintError("ai_not_connected", "Connect ChatGPT or Grok in Settings → +AI");
    const list = await models.list(current.provider);
    if (!list.some((m) => m.id === model)) throw new FlintError("invalid", "That model isn't available on your plan.");
    await ctx.secrets.set(MODEL_SECRET_KEY, model);
    return status();
  }

  async function finishConnect(provider: Provider, pasted: string): Promise<AiStatus> {
    await auth.finishConnect(provider, pasted);
    return status();
  }

  async function disconnect(): Promise<AiStatus> {
    await auth.disconnect();
    await ctx.secrets.delete(MODEL_SECRET_KEY);
    return status();
  }

  /** Streams one pass; on a 401 refreshes the token once and tries again if nothing was sent yet. */
  async function streamPass(
    plan: TaskPlan, messages: ChatMessage[], signal: AbortSignal, onText: (t: string) => void,
  ): Promise<string> {
    let session = await auth.active();
    const model = await models.resolve(session.provider, (await ctx.secrets.get(MODEL_SECRET_KEY)) ?? ctx.getSettings().ai.model);
    let sent = false;
    for (let attempt = 0; ; attempt++) {
      try {
        return await streamModel({
          provider: session.provider,
          tokens: session.tokens,
          model,
          system: plan.system,
          messages,
          effort: plan.effort,
          signal,
          onText: (t) => { sent = true; onText(t); },
          ...(ctx.fetch ? { fetch: ctx.fetch } : {}),
          ...(options.idleTimeoutMs !== undefined ? { idleTimeoutMs: options.idleTimeoutMs } : {}),
          ...(options.retryDelayMs !== undefined ? { retryDelayMs: options.retryDelayMs } : {}),
        });
      } catch (err) {
        if (attempt === 0 && !sent && err instanceof AiStreamError && err.status === 401) {
          session = await auth.forceRefresh();
          continue;
        }
        throw err;
      }
    }
  }

  async function execute(task: AiTask, signal: AbortSignal, emit: Emit, partial: { text: string }): Promise<string> {
    if (task.kind === "ask") emit({ type: "status", text: "Searching your mail" });
    const plan = await planTask(task, ctx);
    if (plan.immediate !== undefined) {
      emit({ type: "text", text: plan.immediate });
      return plan.immediate;
    }
    if (plan.cacheKey) {
      const hit = ctx.cacheGet(plan.cacheKey);
      if (hit) {
        emit({ type: "text", text: hit });
        const cachedCitations = plan.citations?.(hit) ?? [];
        if (cachedCitations.length) emit({ type: "citations", threads: cachedCitations });
        return hit;
      }
    }
    await auth.active(); // fail fast, and refresh before the first request
    emit({ type: "status", text: "Thinking" });
    const onText = (t: string) => {
      partial.text += t;
      if (plan.streamText) emit({ type: "text", text: t });
    };
    let output = await streamPass(plan, plan.messages, signal, onText);
    if (plan.finalize) {
      try {
        output = plan.finalize(output);
      } catch (err) {
        if (!(err instanceof OutputRejected)) throw err;
        partial.text = "";
        const retry: ChatMessage[] = [...plan.messages, { role: "assistant", content: output }, { role: "user", content: err.feedback }];
        output = await streamPass(plan, retry, signal, onText);
        try {
          output = plan.finalize(output);
        } catch (second) {
          if (!(second instanceof OutputRejected)) throw second;
          throw new FlintError("internal", "Couldn't read the model's answer. Try again.");
        }
      }
      if (!plan.streamText) emit({ type: "text", text: output });
    }
    partial.text = output;
    if (plan.cacheKey && output.trim()) ctx.cacheSet(plan.cacheKey, output, plan.cacheTtlMs ?? 0);
    const cited = plan.citations?.(output) ?? [];
    if (cited.length) emit({ type: "citations", threads: cited });
    return output;
  }

  async function precheckConnected(): Promise<void> {
    if (!(await auth.stored())) throw new FlintError("ai_not_connected", "Connect ChatGPT or Grok in Settings → +AI");
  }

  async function precheck(rawTask: AiTask): Promise<AiTask> {
    const task = parseTask(rawTask);
    if (task.kind === "needsReply") return task; // local heuristic, no model call
    await precheckConnected();
    return task;
  }

  async function run(rawTask: AiTask, onChunk: (c: AiChunk) => void): Promise<{ runId: string }> {
    const task = await precheck(rawTask);
    const runId = randomUUID();
    const controller = new AbortController();
    runs.set(runId, controller);
    const send = (c: Parameters<Emit>[0]) => onChunk({ ...c, runId } as AiChunk);
    const partial = { text: "" };
    void (async () => {
      try {
        const text = await execute(task, controller.signal, send, partial);
        send({ type: "done", text });
      } catch (err) {
        if (err instanceof AiStreamError && err.cancelled) {
          if (partial.text && task.kind !== "quickReplies") send({ type: "done", text: partial.text });
          else send({ type: "error", message: "Cancelled." });
        } else {
          send({ type: "error", message: toFlintError(err).message });
        }
      } finally {
        runs.delete(runId);
      }
    })();
    return { runId };
  }

  /** One plain model call outside the task kinds (background classification). Throws ai_not_connected when no provider is signed in. */
  async function complete(system: string, user: string, signal: AbortSignal = new AbortController().signal): Promise<string> {
    await precheckConnected();
    await auth.active();
    const plan: TaskPlan = { system, messages: [{ role: "user", content: user }], effort: "low", streamText: false };
    try {
      return await streamPass(plan, plan.messages, signal, () => {});
    } catch (err) {
      throw toFlintError(err);
    }
  }

  function cancel(runId: string): void {
    runs.get(runId)?.abort();
  }

  async function runToText(rawTask: AiTask): Promise<{ text: string }> {
    const task = await precheck(rawTask);
    try {
      const text = await execute(task, new AbortController().signal, () => {}, { text: "" });
      return { text };
    } catch (err) {
      throw toFlintError(err);
    }
  }

  return {
    status,
    startConnect: (provider: Provider) => auth.startConnect(provider),
    finishConnect,
    disconnect,
    setModel,
    run,
    cancel,
    runToText,
    complete,
    /** Port of the Codex loopback listener while a sign-in is pending (tests, diagnostics). */
    callbackPort: () => auth.listenerPort(),
    dispose: () => { for (const c of runs.values()) c.abort(); runs.clear(); auth.dispose(); },
  };
}
export type AiEngine = ReturnType<typeof createAiEngine>;
