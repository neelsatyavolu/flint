// Incremental Server-Sent Events parsing for the "responses" stream that both
// ChatGPT's Codex backend and xAI (Grok) speak. Ported from Mullwell; web
// search sources and tool items are dropped because mail tasks use neither.

export type StreamEvent = {
  text?: string;
  error?: string;
  done?: boolean;
};

/** Splits a byte stream into SSE `data:` payloads, tolerating chunk boundaries anywhere. */
export function createSseSplitter(onData: (data: string) => void) {
  let buffer = "";
  return {
    push(chunk: string): void {
      buffer += chunk;
      let idx: number;
      while ((idx = buffer.search(/\r?\n/)) !== -1) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + (buffer[idx] === "\r" ? 2 : 1));
        if (line.startsWith("data:")) onData(line.slice(5).trim());
      }
    },
    flush(): void {
      if (buffer.startsWith("data:")) onData(buffer.slice(5).trim());
      buffer = "";
    },
  };
}

type RawEvent = {
  type?: string;
  delta?: unknown;
  error?: { message?: string } | null;
  response?: { error?: { message?: string } | null } | null;
  message?: string;
};

export function responsesEvent(data: string): StreamEvent | null {
  if (!data) return null;
  if (data === "[DONE]") return { done: true };
  let e: RawEvent;
  try {
    e = JSON.parse(data) as RawEvent;
  } catch {
    return null;
  }
  if (typeof e !== "object" || e === null) return null;
  if (e.type === "response.output_text.delta" && typeof e.delta === "string") return { text: e.delta };
  if (e.type === "response.completed") return { done: true };
  if (e.type === "response.incomplete") {
    return { error: "The answer was cut off before it finished. Try again with less text." };
  }
  const error = e.error?.message ?? e.response?.error?.message ?? (e.type === "error" ? e.message : undefined);
  if (error || e.type === "response.failed") return { error: error ?? "The model request failed." };
  return null;
}
