import { z } from "zod";
import { logger } from "../log";
import { FlintError, type Address, type Category, type Settings, type ThreadId } from "../types";
import { formatAddress, neutralizeTags } from "./context";
import { categorizePrompt } from "./prompts";
import { isUncertain } from "./uncertain";

// AI second opinion for new inbox mail the heuristics filed as "people" but that
// looks bulk. Off unless settings.ai.autoCategorize. Batches of up to 20, a minimum
// gap between requests and an hourly cap, and a remembered verdict per sender, so
// the model sees as little mail as possible.

const log = logger("ai-categorize");

export const BATCH_SIZE = 20;
const POOL = 60;
const EXCERPT_CHARS = 300;
const CHECKED_TTL_MS = 30 * 86_400_000;
const SENDER_TTL_MS = 60 * 86_400_000;
const FAILED_TTL_MS = 6 * 3_600_000;
const NOT_CONNECTED_PAUSE_MS = 30 * 60_000;
const HEADERS_SHOWN = ["list-unsubscribe", "list-id", "precedence", "auto-submitted"] as const;

export type CategorizeCandidate = {
  messageId: number;
  threadId: ThreadId;
  from: Address;
  subject: string;
  /** Start of the plain text, up to 3000 characters. */
  text: string;
  headers: Record<string, string>;
  isReply: boolean;
  html: boolean;
  date: number;
};

export type CategorizerPorts = {
  getSettings(): Settings;
  now(): number;
  candidates(limit: number): CategorizeCandidate[];
  apply(verdicts: { messageId: number; category: Category }[]): ThreadId[];
  cacheGet(key: string): string | null;
  cacheSet(key: string, value: string, ttlMs: number): void;
  /** One model call with a system prompt and a user message; resolves to the raw text. */
  complete(system: string, user: string): Promise<string>;
  /** Called with the threads whose category changed. */
  onChanged(threadIds: ThreadId[]): void;
};

export type CategorizerOptions = {
  /** Smallest gap between two model requests. */
  minGapMs?: number;
  maxPerHour?: number;
  /** Wait after a poke so a burst of new mail becomes one batch. */
  debounceMs?: number;
};

export type RunResult =
  | { status: "off" | "idle" | "rate_limited" | "paused" }
  | { status: "memo"; changed: ThreadId[] }
  | { status: "asked"; sent: number; changed: ThreadId[] }
  | { status: "failed"; reason: string };

const verdictsSchema = z.array(z.object({ id: z.number().int().positive(), category: z.enum(["people", "notifications", "newsletters"]) })).min(1);

/** First JSON array in the model output, validated. Throws when unusable. */
export function parseVerdicts(raw: string): { id: number; category: Category }[] {
  const unfenced = raw.replace(/```(?:json)?/gi, "");
  const start = unfenced.indexOf("[");
  const end = unfenced.lastIndexOf("]");
  const value: unknown = JSON.parse(start >= 0 && end > start ? unfenced.slice(start, end + 1) : unfenced);
  return verdictsSchema.parse(value);
}

export function buildCategorizeRequest(batch: CategorizeCandidate[]): string {
  const blocks = batch.map((c, i) => {
    const headers = HEADERS_SHOWN.filter((h) => c.headers[h]).map((h) => `${h}: ${h === "list-unsubscribe" ? "yes" : (c.headers[h] ?? "").slice(0, 60)}`).join("; ");
    const text = c.text.replace(/\s+/g, " ").trim().slice(0, EXCERPT_CHARS);
    return `[${i + 1}] From: ${formatAddress(c.from)}\nSubject: ${c.subject.slice(0, 200) || "(no subject)"}${headers ? `\nHeaders: ${headers}` : ""}\nText: ${text || "(no text)"}`;
  });
  return `<mail_excerpts>\n${neutralizeTags(blocks.join("\n\n"))}\n</mail_excerpts>\n\nClassify these ${batch.length} messages.`;
}

const checkedKey = (id: number) => `ai:cat:m:${id}`;
const senderKey = (address: string) => `ai:cat:s:${address.toLowerCase()}`;

export function createAutoCategorizer(ports: CategorizerPorts, options: CategorizerOptions = {}) {
  const minGapMs = options.minGapMs ?? 30_000;
  const maxPerHour = options.maxPerHour ?? 12;
  const debounceMs = options.debounceMs ?? 8_000;
  let requests: number[] = [];
  let pausedUntil = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let disposed = false;

  const enabled = (): boolean => {
    const ai = ports.getSettings().ai;
    return ai.enabled && ai.autoCategorize;
  };

  function pending(): CategorizeCandidate[] {
    return ports.candidates(POOL).filter((c) => ports.cacheGet(checkedKey(c.messageId)) === null && isUncertain(c));
  }

  async function runOnce(): Promise<RunResult> {
    if (!enabled()) return { status: "off" };
    const now = ports.now();
    if (now < pausedUntil) return { status: "paused" };
    const todo = pending();
    if (todo.length === 0) return { status: "idle" };

    // Senders the model already judged keep their verdict without a new request.
    const memo: { messageId: number; category: Category }[] = [];
    const fresh: CategorizeCandidate[] = [];
    for (const c of todo) {
      const known = ports.cacheGet(senderKey(c.from.address));
      if (known === "people" || known === "notifications" || known === "newsletters") {
        memo.push({ messageId: c.messageId, category: known });
        ports.cacheSet(checkedKey(c.messageId), known, CHECKED_TTL_MS);
      } else {
        fresh.push(c);
      }
    }
    const memoChanged = memo.length ? ports.apply(memo.filter((v) => v.category !== "people")) : [];
    if (memoChanged.length) ports.onChanged(memoChanged);
    if (fresh.length === 0) return { status: "memo", changed: memoChanged };

    requests = requests.filter((t) => now - t < 3_600_000);
    const last = requests.at(-1);
    if (requests.length >= maxPerHour || (last !== undefined && now - last < minGapMs)) return { status: "rate_limited" };

    const batch = fresh.slice(0, BATCH_SIZE);
    requests.push(now);
    let verdicts: { id: number; category: Category }[];
    try {
      verdicts = parseVerdicts(await ports.complete(categorizePrompt(), buildCategorizeRequest(batch)));
    } catch (err) {
      if (err instanceof FlintError && (err.code === "ai_not_connected" || err.code === "auth")) {
        pausedUntil = now + NOT_CONNECTED_PAUSE_MS;
        return { status: "failed", reason: "AI is not connected" };
      }
      if (err instanceof SyntaxError || err instanceof z.ZodError) {
        for (const c of batch) ports.cacheSet(checkedKey(c.messageId), "failed", FAILED_TTL_MS);
        log.warn("categorization answer was unusable", { size: batch.length });
        return { status: "failed", reason: "unreadable answer" };
      }
      log.warn("categorization request failed", { error: err instanceof Error ? err.message : String(err) });
      return { status: "failed", reason: "request failed" };
    }

    const byIndex = new Map(verdicts.map((v) => [v.id, v.category]));
    const apply: { messageId: number; category: Category }[] = [];
    batch.forEach((c, i) => {
      const category = byIndex.get(i + 1);
      ports.cacheSet(checkedKey(c.messageId), category ?? "unanswered", CHECKED_TTL_MS);
      if (!category) return;
      ports.cacheSet(senderKey(c.from.address), category, SENDER_TTL_MS);
      if (category !== "people") apply.push({ messageId: c.messageId, category });
    });
    const changed = ports.apply(apply);
    if (changed.length) ports.onChanged(changed);
    return { status: "asked", sent: batch.length, changed };
  }

  function schedule(delayMs: number): void {
    if (disposed || timer) return;
    timer = setTimeout(() => {
      timer = null;
      void tick();
    }, delayMs);
    timer.unref?.();
  }

  async function tick(): Promise<void> {
    if (running || disposed) return;
    running = true;
    try {
      const result = await runOnce();
      if (result.status === "asked" || result.status === "rate_limited") schedule(minGapMs);
    } finally {
      running = false;
    }
  }

  return {
    runOnce,
    /** New mail arrived: look again shortly. Cheap when the setting is off. */
    poke(): void {
      if (enabled()) schedule(debounceMs);
    },
    dispose(): void {
      disposed = true;
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}
export type AutoCategorizer = ReturnType<typeof createAutoCategorizer>;
