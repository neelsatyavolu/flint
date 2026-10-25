import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sseResponse, textEvents } from "../src/ai/testing";
import { memorySecrets, type Platform } from "../src/platform";
import { createFlintService, type FlintService } from "../src/service";
import { FlintError, type AiChunk, type FlintEvent, type ThreadListItem } from "../src/types";
import { tryStartGreenMail, TEST_DOMAIN, type GreenMail } from "./greenmail";
import { waitFor } from "./harness";

const gm: GreenMail | null = await tryStartGreenMail({ users: ["aiuser"] });
afterAll(async () => { await gm?.stop(); });

type ModelCall = { url: string; body: string };

describe.skipIf(!gm)("FlintService AI against GreenMail and a fake Responses API", { timeout: 60_000 }, () => {
  let service: FlintService;
  const opened: string[] = [];
  const events: FlintEvent[] = [];
  const modelCalls: ModelCall[] = [];
  const secrets = memorySecrets();
  let answer: (body: string) => string = () => "";
  let lunch: ThreadListItem;

  const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (/\/responses$/.test(url)) {
      const body = String(init?.body ?? "");
      modelCalls.push({ url, body });
      return sseResponse(textEvents(answer(body)));
    }
    return new Response("", { status: 404 });
  }) as typeof fetch;

  const connect = () => secrets.set("ai:tokens", JSON.stringify({
    provider: "codex", tokens: { accessToken: "a", refreshToken: "r", expiresAt: Date.now() + 3_600_000, accountId: "acct" },
  }));

  const chunksFor = (runId: string): AiChunk[] =>
    events.flatMap((e) => (e.type === "ai" && e.chunk.runId === runId ? [e.chunk] : []));

  beforeAll(async () => {
    const to = `aiuser@${TEST_DOMAIN}`;
    await gm!.deliver({ to, from: "Maria <maria@remote.example>", subject: "Lunch on Friday", text: "Are you free for lunch on Friday at noon? The new ramen place opens." });
    await gm!.deliver({ to, from: "Omar <omar@remote.example>", subject: "Budget review", text: "The quarterly budget needs your sign-off by Monday." });
    const dataDir = mkdtempSync(join(tmpdir(), "flint-ai-"));
    const platform: Platform = {
      dataDir, downloadsDir: dataDir, secrets, appVersion: "0.0.0-test",
      openExternal: async (url) => { opened.push(url); }, openPath: async () => undefined, notify: () => undefined,
    };
    service = await createFlintService(platform, { fetch: fakeFetch, sync: { pollMs: 500, idlePollMs: 5_000, backoff: { minMs: 200, maxMs: 1000 } } });
    service.subscribe((e) => events.push(e));
    await service.start();
    await service.addAccount({
      email: `aiuser@${TEST_DOMAIN}`, name: "AI", password: "secret",
      server: { imapHost: gm!.host, imapPort: gm!.imapPort, imapSecure: false, smtpHost: gm!.host, smtpPort: gm!.smtpPort, smtpSecure: false, username: "aiuser" },
    });
    const items = await waitFor(async () => {
      const page = await service.listThreads({ view: "inbox" });
      return page.items.length >= 2 ? page.items : null;
    }, "initial sync", 30_000);
    lunch = items.find((t) => t.subject === "Lunch on Friday")!;
  });

  afterAll(async () => { await service?.stop(); });

  it("reports not connected and refuses tasks until connected", async () => {
    expect(await service.aiStatus()).toMatchObject({ connected: false, provider: null, enabled: true });
    await expect(service.aiRunToText({ kind: "summarize", threadId: lunch.id })).rejects.toMatchObject({ code: "ai_not_connected" });
  });

  it("opens the sign-in URL in the browser and reports the paste requirement", async () => {
    const r = await service.aiStartConnect("grok");
    expect(opened).toContain(r.url);
    expect(r.needsPaste).toBe(true);
    await service.aiDisconnect();
  });

  it("summarizes a thread with its real message text and caches the result", async () => {
    await connect();
    answer = () => "Maria asks whether you can do lunch on Friday at noon.";
    const status = await service.aiStatus();
    expect(status).toMatchObject({ connected: true, provider: "codex" });
    expect((await service.getSettings()).ai).toMatchObject({ provider: "codex", model: status.model });

    const before = modelCalls.length;
    const { text } = await service.aiRunToText({ kind: "summarize", threadId: lunch.id });
    expect(text).toBe("Maria asks whether you can do lunch on Friday at noon.");
    expect(modelCalls.length).toBe(before + 1);
    expect(modelCalls.at(-1)!.body).toContain("ramen place");

    await service.aiRunToText({ kind: "summarize", threadId: lunch.id });
    expect(modelCalls.length).toBe(before + 1); // served from kv_cache
  });

  it("streams a run as ai events", async () => {
    answer = () => "Short summary.";
    const { runId } = await service.aiRun({ kind: "reply", threadId: lunch.id, instructions: "say yes" });
    await waitFor(() => chunksFor(runId).some((c) => c.type === "done"), "done chunk");
    const chunks = chunksFor(runId);
    expect(chunks.some((c) => c.type === "text")).toBe(true);
    expect(chunks.find((c) => c.type === "done")).toMatchObject({ text: "Short summary." });
  });

  it("returns quick replies as a JSON array of three strings", async () => {
    answer = () => JSON.stringify(["Friday works.", "Can we do 1pm?", "Sorry, I can't."]);
    const { text } = await service.aiRunToText({ kind: "quickReplies", threadId: lunch.id });
    expect(JSON.parse(text)).toEqual(["Friday works.", "Can we do 1pm?", "Sorry, I can't."]);
  });

  it("answers ask with citations that point at real thread ids", async () => {
    answer = () => "Maria asked about lunch on Friday [1].";
    const { runId } = await service.aiRun({ kind: "ask", question: "What did Maria say about lunch?" });
    await waitFor(() => chunksFor(runId).some((c) => c.type === "done" || c.type === "error"), "ask finished");
    const chunks = chunksFor(runId);
    expect(chunks.find((c) => c.type === "error")).toBeUndefined();
    const cites = chunks.find((c) => c.type === "citations");
    expect(cites).toBeDefined();
    if (cites?.type !== "citations") throw new Error("no citations");
    expect(cites.threads.map((t) => t.threadId)).toEqual([lunch.id]);
    const detail = await service.getThread(cites.threads[0]!.threadId);
    expect(detail.subject).toBe("Lunch on Friday");
  });

  it("changes the model and mirrors it into settings", async () => {
    const { models } = await service.aiStatus();
    const pick = models[models.length - 1]!.id;
    const status = await service.aiSetModel(pick);
    expect(status.model).toBe(pick);
    expect((await service.getSettings()).ai.model).toBe(pick);
  });

  it("refuses to run when +AI is turned off", async () => {
    await service.updateSettings({ ai: { enabled: false } });
    const err = await service.aiRunToText({ kind: "summarize", threadId: lunch.id }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FlintError);
    expect(err).toMatchObject({ code: "ai_not_connected", message: "Turn on +AI in Settings to use this." });
    expect((await service.aiStatus()).enabled).toBe(false);
    await service.updateSettings({ ai: { enabled: true } });
  });

  it("clears provider and model in settings on disconnect", async () => {
    const status = await service.aiDisconnect();
    expect(status.connected).toBe(false);
    expect((await service.getSettings()).ai).toMatchObject({ provider: null, model: null });
  });
});
