import { afterEach, describe, expect, it } from "vitest";
import type { AiChunk } from "../types";
import { createAiEngine, type AiEngine } from "./engine";
import { TOKENS_KEY } from "./auth";
import type { AiThreadBrief } from "./ports";
import { fakeFetch, makeContext, sseResponse, textEvents } from "./testing";

const engines: AiEngine[] = [];
afterEach(() => { engines.splice(0).forEach((e) => e.dispose()); });

const brief: AiThreadBrief = {
  threadId: 5, subject: "Agreement", date: 1_699_990_000_000, from: { name: "Rodney", address: "r@x.com" },
  lastText: "Can you confirm Monday?", unreadCount: 1, messageCount: 1, lastFromMe: false, answered: false,
};

async function setup(connected: boolean, reply = "Needs a reply\n- Rodney asks you to confirm Monday. [1]") {
  const f = fakeFetch({ responses: () => sseResponse(textEvents(reply)) });
  const ctx = makeContext({ fetch: f, timeZone: "UTC", listThreadsForAi: async () => [brief] });
  if (connected) {
    await ctx.secrets.set(TOKENS_KEY, JSON.stringify({ provider: "codex", tokens: { accessToken: "t", refreshToken: "r", expiresAt: ctx.now() + 3_600_000, accountId: "a" } }));
  }
  const engine = createAiEngine(ctx, { loopback: null, retryDelayMs: 0, idleTimeoutMs: 200 });
  engines.push(engine);
  return { f, ctx, engine };
}

const collect = (engine: AiEngine, task: Parameters<AiEngine["run"]>[0]) => {
  const chunks: AiChunk[] = [];
  const done = new Promise<void>((resolve) => { void engine.run(task, (c) => { chunks.push(c); if (c.type === "done" || c.type === "error") resolve(); }); });
  return { chunks, done };
};

describe("inbox tasks in the engine", () => {
  it("needsReply works without a connected provider and never calls the model", async () => {
    const { engine, f } = await setup(false);
    const { text } = await engine.runToText({ kind: "needsReply" });
    expect(JSON.parse(text)).toHaveLength(1);
    expect(f.calls.filter((c) => /responses$/.test(c.url))).toHaveLength(0);
  });

  it("digest streams text then index-aligned citations, and a repeat comes from the cache with citations", async () => {
    const { engine, f } = await setup(true);
    const first = collect(engine, { kind: "digest" });
    await first.done;
    expect(first.chunks.find((c) => c.type === "citations")).toMatchObject({ threads: [{ threadId: 5 }] });
    const second = collect(engine, { kind: "digest" });
    await second.done;
    expect(second.chunks.find((c) => c.type === "citations")).toMatchObject({ threads: [{ threadId: 5 }] });
    expect(f.calls.filter((c) => /responses$/.test(c.url))).toHaveLength(1);
  });

  it("complete returns raw model text and needs a connection", async () => {
    const { engine } = await setup(true, "[]");
    expect(await engine.complete("sys", "user")).toBe("[]");
    const off = await setup(false);
    await expect(off.engine.complete("s", "u")).rejects.toMatchObject({ code: "ai_not_connected" });
  });
});
