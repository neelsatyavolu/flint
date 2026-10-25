import { describe, expect, it, vi } from "vitest";
import { AiStreamError, streamModel, upstreamError, type StreamParams } from "./stream";
import { sseResponse, textEvents } from "./testing";

const base: Omit<StreamParams, "onText"> = {
  provider: "codex",
  tokens: { accessToken: "tok", refreshToken: "r", expiresAt: 9e12, accountId: "acct" },
  model: "gpt-6-luna",
  system: "sys",
  messages: [{ role: "user", content: "hi" }],
  effort: "low",
  retryDelayMs: 0,
};

async function run(over: Partial<StreamParams>) {
  const chunks: string[] = [];
  const text = await streamModel({ ...base, ...over, onText: (t) => chunks.push(t) });
  return { text, chunks };
}

describe("streamModel", () => {
  it("streams Codex text with the account header and instructions", async () => {
    const f = vi.fn().mockResolvedValue(sseResponse(textEvents("Hel", "lo")));
    const { text, chunks } = await run({ fetch: f });
    expect(text).toBe("Hello");
    expect(chunks).toEqual(["Hel", "lo"]);
    const [url, init] = f.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("chatgpt.com/backend-api/codex/responses");
    expect((init.headers as Record<string, string>)["chatgpt-account-id"]).toBe("acct");
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ model: "gpt-6-luna", instructions: "sys", store: false, stream: true, reasoning: { effort: "low" } });
    expect(body.tools).toBeUndefined();
    expect(body.input[0].content).toEqual([{ type: "input_text", text: "hi" }]);
  });

  it("puts the system prompt first for Grok and never enables search", async () => {
    const f = vi.fn().mockResolvedValue(sseResponse(textEvents("ok")));
    await run({ fetch: f, provider: "grok", model: "grok-4.7" });
    const [url, init] = f.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.x.ai/v1/responses");
    const body = JSON.parse(init.body as string);
    expect(body.input[0]).toEqual({ role: "system", content: "sys" });
    expect(body.input[1]).toEqual({ role: "user", content: "hi" });
    expect(body.tools).toBeUndefined();
    expect(body.reasoning).toEqual({ effort: "low" });
  });

  it("sends assistant turns as output_text for Codex", async () => {
    const f = vi.fn().mockResolvedValue(sseResponse(textEvents("ok")));
    await run({ fetch: f, messages: [{ role: "user", content: "a" }, { role: "assistant", content: "b" }, { role: "user", content: "c" }] });
    const body = JSON.parse((f.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(body.input[1]).toEqual({ role: "assistant", content: [{ type: "output_text", text: "b" }] });
  });

  it("retries without effort when the backend rejects it", async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "Unsupported reasoning effort" } }), { status: 400 }))
      .mockResolvedValueOnce(sseResponse(textEvents("ok")));
    expect((await run({ fetch: f })).text).toBe("ok");
    expect(JSON.parse((f.mock.calls[1] as [string, RequestInit])[1].body as string).reasoning).toBeUndefined();
  });

  it("retries 429 and 5xx, then succeeds", async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 429 }))
      .mockResolvedValueOnce(new Response("", { status: 503 }))
      .mockResolvedValueOnce(sseResponse(textEvents("fine")));
    expect((await run({ fetch: f })).text).toBe("fine");
    expect(f).toHaveBeenCalledTimes(3);
  });

  it("retries a network failure", async () => {
    const f = vi.fn().mockRejectedValueOnce(new TypeError("fetch failed")).mockResolvedValueOnce(sseResponse(textEvents("back")));
    expect((await run({ fetch: f })).text).toBe("back");
  });

  it("gives up after repeated failures with the upstream message", async () => {
    const f = vi.fn().mockImplementation(async () => new Response("", { status: 429 }));
    await expect(run({ fetch: f })).rejects.toMatchObject({ status: 429, message: expect.stringMatching(/rate limit/) });
    expect(f).toHaveBeenCalledTimes(4);
  });

  it("does not retry auth failures and exposes the status", async () => {
    const f = vi.fn().mockResolvedValue(new Response("", { status: 401 }));
    await expect(run({ fetch: f })).rejects.toMatchObject({ status: 401 });
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("surfaces a stream error event", async () => {
    const f = vi.fn().mockResolvedValue(sseResponse([{ type: "response.output_text.delta", delta: "x" }, { type: "response.failed", response: { error: { message: "quota" } } }]));
    await expect(run({ fetch: f })).rejects.toThrow("quota");
  });

  it("reports a stream that ends without completing", async () => {
    const f = vi.fn().mockResolvedValue(sseResponse([{ type: "response.output_text.delta", delta: "par" }]));
    await expect(run({ fetch: f })).rejects.toThrow(/stopped before finishing/);
  });

  it("cancels through the abort signal", async () => {
    const ac = new AbortController();
    const f = vi.fn().mockImplementation(async (_u: string, init: RequestInit) => {
      const enc = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        start(c) { c.enqueue(enc.encode(`data: ${JSON.stringify({ type: "response.output_text.delta", delta: "a" })}\n\n`)); },
        pull() { return new Promise(() => {}); },
        cancel() {},
      });
      init.signal?.addEventListener("abort", () => {});
      return new Response(stream, { status: 200 });
    });
    const p = run({ fetch: f, signal: ac.signal, onText: undefined as never }).catch((e: unknown) => e);
    await new Promise((r) => setTimeout(r, 20));
    ac.abort();
    const err = await p;
    expect(err).toBeInstanceOf(AiStreamError);
    expect((err as AiStreamError).cancelled).toBe(true);
  });

  it("times out when the stream goes silent", async () => {
    const f = vi.fn().mockImplementation(async (_u: string, init: RequestInit) => {
      const stream = new ReadableStream<Uint8Array>({
        start(c) { init.signal?.addEventListener("abort", () => c.error(new Error("aborted"))); },
      });
      return new Response(stream, { status: 200 });
    });
    await expect(run({ fetch: f, idleTimeoutMs: 30 })).rejects.toThrow(/stopped responding/);
  });
});

it("upstreamError", () => {
  expect(upstreamError(500, '{"detail":"boom"}')).toBe("boom");
  expect(upstreamError(500, '{"error":{"message":"m"}}')).toBe("m");
  expect(upstreamError(429, "")).toMatch(/rate limit/);
  expect(upstreamError(403, "")).toMatch(/Reconnect/);
  expect(upstreamError(502, "")).toBe("The model request failed (HTTP 502).");
});
