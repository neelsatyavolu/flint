import { RegisterMessageRequestSchema, type ReceiptEvent } from "./protocol";

/**
 * In-process stand-in for services/receipts used by tests. It follows the Worker's contract:
 * Bearer installId.secret auth, token uniqueness (409), cursor paging and the JSON error shape.
 * It does not classify hits; tests add events with addEvent().
 */
export class FakeReceiptsService {
  readonly calls: { method: string; path: string; auth: string | null }[] = [];
  readonly installs = new Map<string, string>();
  readonly messages = new Map<string, { installId: string; tokens: string[] }>();
  readonly events: ReceiptEvent[] = [];
  seenPings = 0;
  /** Set to make every request fail at the network layer. */
  offline = false;
  /** Set to make every request answer with this status. */
  forceStatus: number | null = null;
  /** Set to make DELETE answer 202 { ok: false, deleted: false } like the Worker when its storage fails. */
  deleteFails = false;
  pageLimit = 500;
  #nextId = 1;
  #installSeq = 0;

  readonly fetch = async (input: string, init: RequestInit = {}): Promise<Response> => {
    if (this.offline) throw new TypeError("fetch failed");
    const url = new URL(input);
    const method = init.method ?? "GET";
    const headers = new Headers(init.headers);
    this.calls.push({ method, path: url.pathname + url.search, auth: headers.get("authorization") });
    if (this.forceStatus !== null) return this.#error(this.forceStatus, "internal", "forced");
    if (url.pathname === "/v1/install" && method === "POST") {
      const installId = `inst${++this.#installSeq}`;
      const secret = `secret${this.#installSeq}`;
      this.installs.set(installId, secret);
      return this.#json(201, { installId, secret });
    }
    const installId = this.#authenticate(headers.get("authorization"));
    if (!installId) return this.#error(401, "unauthorized", "Missing or invalid credentials.");
    if (url.pathname === "/v1/messages" && method === "POST") return this.#register(installId, init.body);
    const del = /^\/v1\/messages\/([^/]+)$/.exec(url.pathname);
    if (del && method === "DELETE") {
      const ref = decodeURIComponent(del[1]!);
      if (this.messages.get(ref)?.installId !== installId) return this.#error(404, "not_found", "No such message.");
      if (this.deleteFails) return this.#json(202, { ok: false, deleted: false });
      this.messages.delete(ref);
      return this.#json(200, { ok: true });
    }
    if (url.pathname === "/v1/seen" && method === "POST") { this.seenPings++; return this.#json(200, { ok: true }); }
    if (url.pathname === "/v1/events" && method === "GET") return this.#listEvents(installId, url);
    return this.#error(404, "not_found", "No such endpoint.");
  };

  /** Simulates a classified pixel hit for a registered token. Returns the event id. */
  addEvent(token: string, over: Partial<ReceiptEvent> = {}): number {
    const id = this.#nextId++;
    this.events.push({
      id, token, at: 1_000_000 + id, kind: "open", client: "Gmail", device: "desktop", country: "US", city: "Austin",
      fingerprint: "fp1", possiblyForwarded: false, ...over,
    });
    return id;
  }

  tokensFor(ref: string): string[] {
    return this.messages.get(ref)?.tokens ?? [];
  }

  #authenticate(header: string | null): string | null {
    const m = /^Bearer ([^.]+)\.(.+)$/.exec(header ?? "");
    if (!m) return null;
    return this.installs.get(m[1]!) === m[2] ? m[1]! : null;
  }

  #register(installId: string, body: RequestInit["body"]): Response {
    const parsed = RegisterMessageRequestSchema.safeParse(JSON.parse(String(body ?? "null")));
    if (!parsed.success) return this.#error(400, "bad_request", "Invalid body.");
    const { ref, recipients } = parsed.data;
    const tokens = recipients.map((r) => r.token);
    const taken = new Set([...this.messages].filter(([r]) => r !== ref).flatMap(([, m]) => m.tokens));
    if (tokens.some((t) => taken.has(t))) return this.#error(409, "conflict", "Token already in use.");
    this.messages.set(ref, { installId, tokens });
    return this.#json(201, { ref, recipients: tokens.length });
  }

  #listEvents(installId: string, url: URL): Response {
    const after = Number(url.searchParams.get("after") ?? 0);
    const limit = Math.min(Number(url.searchParams.get("limit") ?? 500), this.pageLimit);
    const mine = new Set([...this.messages.values()].filter((m) => m.installId === installId).flatMap((m) => m.tokens));
    const page = this.events.filter((e) => e.id > after && mine.has(e.token)).slice(0, limit);
    const cursor = page.length ? String(page[page.length - 1]!.id) : String(after);
    return this.#json(200, { events: page, cursor });
  }

  #json(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }

  #error(status: number, code: string, message: string): Response {
    return this.#json(status, { error: { code, message } });
  }
}
