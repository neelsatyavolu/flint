import { afterEach, describe, expect, it } from "vitest";
import type { AiChunk } from "../types";
import { createAiEngine, MODEL_SECRET_KEY, type AiEngine } from "./engine";
import { TOKENS_KEY } from "./auth";
import { fakeFetch, makeContext, sseResponse, textEvents, tokenResponse, type FakeRoutes } from "./testing";

const a = { name: "Ana", address: "ana@x.com" };
const thread = { subject: "Lunch", messages: [{ from: a, to: [], date: 200, text: "Lunch Friday?" }] };
const engines: AiEngine[] = [];
afterEach(() => { engines.splice(0).forEach((e) => e.dispose()); });

async function setup(routes: FakeRoutes = {}, opts: { provider?: "codex" | "grok"; expiresAt?: number; connected?: boolean } = {}) {
  const f = fakeFetch(routes);
  const ctx = makeContext({ fetch: f, getThreadForAi: async () => thread });
  if (opts.connected !== false) {
    await ctx.secrets.set(TOKENS_KEY, JSON.stringify({
      provider: opts.provider ?? "codex",
      tokens: { accessToken: "tok", refreshToken: "ref", expiresAt: opts.expiresAt ?? ctx.now() + 3_600_000, accountId: "acct" },
    }));
  }
  const engine = createAiEngine(ctx, { loopback: null, retryDelayMs: 0, idleTimeoutMs: 200 });
  engines.push(engine);
  return { f, ctx, engine };
}

function collect(engine: AiEngine, task: Parameters<AiEngine["run"]>[0]) {
  const chunks: AiChunk[] = [];
  const finished = new Promise<void>((resolve) => {
    void engine.run(task, (c) => { chunks.push(c); if (c.type === "done" || c.type === "error") resolve(); }).catch(() => resolve());
  });
  return { chunks, finished };
}

describe("status and models", () => {
  it("is disconnected without tokens", async () => {
    const { engine } = await setup({}, { connected: false });
    expect(await engine.status()).toMatchObject({ connected: false, provider: null, model: null, models: [] });
  });
  it("lists models from the bundled catalog when the network catalog is unreachable and sets a model", async () => {
    const { engine, ctx } = await setup();
    const s = await engine.status();
    expect(s).toMatchObject({ connected: true, provider: "codex" });
    expect(s.models.map((m) => m.id)).toContain("gpt-6-luna");
    expect((await engine.setModel("gpt-6-luna")).model).toBe("gpt-6-luna");
    expect(await ctx.secrets.get(MODEL_SECRET_KEY)).toBe("gpt-6-luna");
    await expect(engine.setModel("nope")).rejects.toMatchObject({ code: "invalid" });
  });
  it("setModel needs a connection", async () => {
    const { engine } = await setup({}, { connected: false });
    await expect(engine.setModel("x")).rejects.toMatchObject({ code: "ai_not_connected" });
  });
  it("disconnect clears the connection and model", async () => {
    const { engine, ctx } = await setup();
    await engine.setModel("gpt-6-luna");
    expect((await engine.disconnect()).connected).toBe(false);
    expect(await ctx.secrets.get(MODEL_SECRET_KEY)).toBeNull();
  });
});

describe("connect via the engine", () => {
  it("startConnect then finishConnect returns the new status", async () => {
    const { engine } = await setup({}, { connected: false });
    const { url, needsPaste } = await engine.startConnect("grok");
    expect(needsPaste).toBe(true);
    expect(url).toContain("auth.x.ai");
    const s = await engine.finishConnect("grok", "code-1");
    expect(s).toMatchObject({ connected: true, provider: "grok" });
  });
});

describe("run", () => {
  it("throws ai_not_connected before doing anything", async () => {
    const { engine, f } = await setup({}, { connected: false });
    await expect(engine.run({ kind: "summarize", threadId: 1 }, () => {})).rejects.toMatchObject({ code: "ai_not_connected", message: "Connect ChatGPT or Grok in Settings → +AI" });
    await expect(engine.runToText({ kind: "summarize", threadId: 1 })).rejects.toMatchObject({ code: "ai_not_connected" });
    expect(f.calls).toHaveLength(0);
  });
  it("rejects invalid tasks", async () => {
    const { engine } = await setup();
    await expect(engine.run({ kind: "rewrite", text: "", style: "fix" }, () => {})).rejects.toMatchObject({ code: "invalid" });
  });

  it("streams Codex text and finishes with done", async () => {
    const { engine } = await setup({ responses: () => sseResponse(textEvents("Hel", "lo")) });
    const { chunks, finished } = collect(engine, { kind: "reply", threadId: 1 });
    await finished;
    const texts = chunks.filter((c) => c.type === "text").map((c) => (c as { text: string }).text);
    expect(texts).toEqual(["Hel", "lo"]);
    expect(chunks.at(-1)).toMatchObject({ type: "done", text: "Hello" });
    expect(new Set(chunks.map((c) => c.runId)).size).toBe(1);
  });

  it("streams Grok text", async () => {
    const { engine, f } = await setup({ responses: () => sseResponse(textEvents("ok")) }, { provider: "grok" });
    const { chunks, finished } = collect(engine, { kind: "rewrite", text: "hey", style: "fix" });
    await finished;
    expect(chunks.at(-1)).toMatchObject({ type: "done", text: "ok" });
    expect(f.calls.find((c) => c.url.includes("x.ai"))).toBeTruthy();
  });

  it("caches summaries and serves repeats without calling the model", async () => {
    let n = 0;
    const { engine, ctx, f } = await setup({ responses: () => { n++; return sseResponse(textEvents("A summary.")); } });
    expect((await engine.runToText({ kind: "summarize", threadId: 1 })).text).toBe("A summary.");
    expect(ctx.cache.get("ai:summary:1:200")).toBe("A summary.");
    expect((await engine.runToText({ kind: "summarize", threadId: 1 })).text).toBe("A summary.");
    expect(n).toBe(1);
    expect(f.calls.filter((c) => c.url.endsWith("/responses"))).toHaveLength(1);
  });

  it("quickReplies retries once on bad output then returns normalized JSON", async () => {
    const outputs = ["Sure, here are some ideas", '```json\n["Yes.","No.","Later."]\n```'];
    let i = 0;
    const { engine, f } = await setup({ responses: () => sseResponse(textEvents(outputs[i++]!)) });
    const { chunks, finished } = collect(engine, { kind: "quickReplies", threadId: 1 });
    await finished;
    expect(chunks.filter((c) => c.type === "text")).toHaveLength(1);
    expect(chunks.at(-1)).toMatchObject({ type: "done", text: '["Yes.","No.","Later."]' });
    const second = JSON.parse(f.calls.filter((c) => c.url.endsWith("/responses"))[1]!.init.body as string);
    expect(second.input.at(-1).content[0].text).toMatch(/JSON array/);
  });

  it("quickReplies fails cleanly after two bad outputs", async () => {
    const { engine } = await setup({ responses: () => sseResponse(textEvents("nope")) });
    await expect(engine.runToText({ kind: "quickReplies", threadId: 1 })).rejects.toMatchObject({ code: "internal" });
  });

  it("emits error chunks for stream failures", async () => {
    const { engine } = await setup({ responses: () => sseResponse([{ type: "response.failed", response: { error: { message: "quota used up" } } }]) });
    const { chunks, finished } = collect(engine, { kind: "reply", threadId: 1 });
    await finished;
    expect(chunks.at(-1)).toEqual(expect.objectContaining({ type: "error", message: "quota used up" }));
  });

  it("refreshes before the request when the token is about to expire", async () => {
    const { engine, ctx } = await setup(
      { token: () => tokenResponse({ access_token: "fresh" }), responses: (_u, init) => {
        expect((init.headers as Record<string, string>).Authorization).toBe("Bearer fresh");
        return sseResponse(textEvents("ok"));
      } },
      { expiresAt: 1_700_000_000_000 + 5_000 },
    );
    expect((await engine.runToText({ kind: "rewrite", text: "x", style: "fix" })).text).toBe("ok");
    expect(JSON.parse((await ctx.secrets.get(TOKENS_KEY))!).tokens.accessToken).toBe("fresh");
  });

  it("refreshes and retries once on a 401", async () => {
    let calls = 0;
    const { engine } = await setup({
      token: () => tokenResponse({ access_token: "fresh" }),
      responses: (_u, init) => {
        calls++;
        return (init.headers as Record<string, string>).Authorization === "Bearer fresh" ? sseResponse(textEvents("ok")) : new Response("", { status: 401 });
      },
    });
    expect((await engine.runToText({ kind: "rewrite", text: "x", style: "fix" })).text).toBe("ok");
    expect(calls).toBe(2);
  });

  it("ask streams the answer then emits citations before done", async () => {
    const ctx = makeContext({
      fetch: fakeFetch({ responses: () => sseResponse(textEvents("Friday ", "[1].")) }),
      getThreadForAi: async () => thread,
      searchForAi: async () => [
        { threadId: 7, subject: "Lunch", date: 200, from: a, snippet: "Lunch Friday?" },
        { threadId: 8, subject: "Other", date: 100, from: a, snippet: "x" },
      ],
    });
    await ctx.secrets.set(TOKENS_KEY, JSON.stringify({ provider: "codex", tokens: { accessToken: "t", refreshToken: "r", expiresAt: ctx.now() + 3_600_000 } }));
    const engine = createAiEngine(ctx, { loopback: null });
    engines.push(engine);
    const { chunks, finished } = collect(engine, { kind: "ask", question: "when is lunch?" });
    await finished;
    const types = chunks.map((c) => c.type);
    expect(types.indexOf("citations")).toBeGreaterThan(types.indexOf("text"));
    expect(types.at(-1)).toBe("done");
    expect(chunks.find((c) => c.type === "citations")).toMatchObject({ threads: [{ threadId: 7, subject: "Lunch" }] });
    expect(chunks[0]).toMatchObject({ type: "status", text: "Searching your mail" });
  });

  it("ask with no matches answers without calling the model", async () => {
    const { engine, f } = await setup();
    const { chunks, finished } = collect(engine, { kind: "ask", question: "invoice acme" });
    await finished;
    expect(chunks.at(-1)).toMatchObject({ type: "done" });
    expect(f.calls).toHaveLength(0);
  });

  it("cancels a running stream and keeps the partial text", async () => {
    const hang = () => {
      const enc = new TextEncoder();
      return new Response(new ReadableStream<Uint8Array>({
        start(c) { c.enqueue(enc.encode(`data: ${JSON.stringify({ type: "response.output_text.delta", delta: "Part" })}\n\n`)); },
      }), { status: 200 });
    };
    const { engine } = await setup({ responses: hang });
    const chunks: AiChunk[] = [];
    let end!: () => void;
    const finished = new Promise<void>((r) => { end = r; });
    const { runId } = await engine.run({ kind: "reply", threadId: 1 }, (c) => {
      chunks.push(c);
      if (c.type === "text") engine.cancel(c.runId);
      if (c.type === "done" || c.type === "error") end();
    });
    await finished;
    expect(chunks.at(-1)).toMatchObject({ type: "done", text: "Part", runId });
  });

  it("cancel before any text reports Cancelled", async () => {
    const { engine } = await setup({ responses: (_u, init) => new Promise<Response>((_res, rej) => {
      init.signal?.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError")));
    }) });
    const chunks: AiChunk[] = [];
    let end!: () => void;
    const finished = new Promise<void>((r) => { end = r; });
    const { runId } = await engine.run({ kind: "reply", threadId: 1 }, (c) => { chunks.push(c); if (c.type === "error" || c.type === "done") end(); });
    await new Promise((r) => setTimeout(r, 20));
    engine.cancel(runId);
    await finished;
    expect(chunks.at(-1)).toMatchObject({ type: "error", message: "Cancelled." });
    engine.cancel("unknown");
  });
});
