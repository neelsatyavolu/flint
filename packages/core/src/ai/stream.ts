import type { Provider, Tokens } from "@neelsatyavolu/shared-ai-auth";
import { createSseSplitter, responsesEvent } from "./sse";

// Streams one model response from the user's own subscription through the
// Responses API. Codex and Grok speak the same event format but differ in
// URL, headers and where the system prompt goes.

export const CODEX_RESPONSES_URL = "https://chatgpt.com/backend-api/codex/responses";
export const GROK_RESPONSES_URL = "https://api.x.ai/v1/responses";
const DEFAULT_IDLE_TIMEOUT_MS = 90_000;
const DEFAULT_RETRY_DELAY_MS = 800;
const MAX_ATTEMPTS = 4;

export type Effort = "low" | "medium" | "high";
export type ChatMessage = { role: "user" | "assistant"; content: string };

export type StreamParams = {
  provider: Provider;
  tokens: Tokens;
  model: string;
  system: string;
  messages: ChatMessage[];
  effort: Effort;
  onText: (text: string) => void;
  fetch?: typeof fetch;
  signal?: AbortSignal;
  idleTimeoutMs?: number;
  retryDelayMs?: number;
};

export class AiStreamError extends Error {
  constructor(message: string, readonly status: number | null = null, readonly cancelled = false) {
    super(message);
    this.name = "AiStreamError";
  }
}

function inputItems({ provider, system, messages }: StreamParams): object[] {
  const items = messages.map((m) =>
    m.role === "assistant"
      ? { role: "assistant", content: provider === "grok" ? m.content : [{ type: "output_text", text: m.content }] }
      : { role: "user", content: provider === "grok" ? m.content : [{ type: "input_text", text: m.content }] },
  );
  return provider === "grok" ? [{ role: "system", content: system }, ...items] : items;
}

function buildRequest(params: StreamParams, effort: Effort | null): [string, RequestInit] {
  const { provider, tokens, model, system } = params;
  const shared = { model, input: inputItems(params), store: false, stream: true };
  if (provider === "codex") {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${tokens.accessToken}`,
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      originator: "codex_cli_rs",
      "OpenAI-Beta": "responses=v1",
    };
    if (tokens.accountId) headers["chatgpt-account-id"] = tokens.accountId;
    const body = { ...shared, instructions: system, ...(effort ? { reasoning: { effort } } : {}) };
    return [CODEX_RESPONSES_URL, { method: "POST", headers, body: JSON.stringify(body) }];
  }
  const body = {
    ...shared,
    temperature: 0.3,
    ...(effort && /^grok-4/.test(model) ? { reasoning: { effort } } : {}),
  };
  return [
    GROK_RESPONSES_URL,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokens.accessToken}`,
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        "User-Agent": "grok-cli/1.0",
      },
      body: JSON.stringify(body),
    },
  ];
}

export function upstreamError(status: number, text: string): string {
  try {
    const json = JSON.parse(text) as { error?: { message?: unknown }; detail?: unknown; message?: unknown };
    const message = json?.error?.message ?? json?.detail ?? json?.message;
    if (typeof message === "string" && message) return message;
  } catch {
    /* not JSON */
  }
  if (status === 401 || status === 403) return "Your AI connection expired. Reconnect it in Settings → +AI.";
  if (status === 429) return "Your subscription's rate limit was hit. Try again in a moment.";
  return `The model request failed (HTTP ${status}).`;
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (ms <= 0 || signal?.aborted) return resolve();
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => { clearTimeout(t); resolve(); }, { once: true });
  });

type Opened = { body: ReadableStream<Uint8Array> };

/**
 * Opens the response. Retries: a 400 about effort/reasoning drops the effort;
 * 429 and 5xx responses and network failures back off and try again.
 */
async function open(params: StreamParams, signal: AbortSignal, f: typeof fetch): Promise<Opened> {
  const delay = params.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  let effort: Effort | null = params.effort;
  let failure = new AiStreamError("The model request failed.");
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (signal.aborted) throw new AiStreamError("Cancelled.", null, true);
    const [url, init] = buildRequest(params, effort);
    let res: Response;
    try {
      res = await f(url, { ...init, signal });
    } catch {
      if (signal.aborted) throw new AiStreamError("Cancelled.", null, true);
      failure = new AiStreamError("Could not reach the model. Check your connection.");
      await sleep(delay * (attempt + 1), signal);
      continue;
    }
    if (res.ok && res.body) return { body: res.body };
    const text = await res.text().catch(() => "");
    failure = new AiStreamError(upstreamError(res.status, text), res.status);
    if (res.status === 400 && effort && /effort|reasoning/i.test(text)) {
      effort = null;
      continue;
    }
    if (res.status === 429 || res.status >= 500) {
      await sleep(delay * (attempt + 1), signal);
      continue;
    }
    break;
  }
  throw failure;
}

/** Streams the answer; resolves with the full text. Throws AiStreamError. */
export async function streamModel(params: StreamParams): Promise<string> {
  const f = params.fetch ?? fetch;
  const controller = new AbortController();
  let timedOut = false;
  let idle: ReturnType<typeof setTimeout> | undefined;
  const arm = () => {
    clearTimeout(idle);
    idle = setTimeout(() => { timedOut = true; controller.abort(); }, params.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS);
  };
  const onAbort = () => controller.abort();
  if (params.signal?.aborted) controller.abort();
  params.signal?.addEventListener("abort", onAbort, { once: true });

  try {
    arm();
    const { body } = await open(params, controller.signal, f);
    let full = "";
    let error: string | null = null;
    let ended = false;
    const splitter = createSseSplitter((data) => {
      const event = responsesEvent(data);
      if (!event || ended) return;
      if (event.text) {
        full += event.text;
        params.onText(event.text);
      }
      if (event.error) error = event.error;
      ended = Boolean(event.error || event.done);
    });
    const decoder = new TextDecoder();
    const reader = body.getReader();
    controller.signal.addEventListener("abort", () => { reader.cancel().catch(() => {}); }, { once: true });
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      arm();
      splitter.push(decoder.decode(value, { stream: true }));
      if (ended) {
        reader.cancel().catch(() => {});
        break;
      }
    }
    splitter.flush();
    if (controller.signal.aborted) throw new Error("aborted");
    if (error) throw new AiStreamError(error);
    if (!ended) throw new AiStreamError("The model stopped before finishing. Try again.");
    return full;
  } catch (err) {
    if (err instanceof AiStreamError) throw err;
    if (params.signal?.aborted) throw new AiStreamError("Cancelled.", null, true);
    throw new AiStreamError(timedOut ? "The model stopped responding." : "Could not reach the model. Check your connection.");
  } finally {
    clearTimeout(idle);
    params.signal?.removeEventListener("abort", onAbort);
  }
}
