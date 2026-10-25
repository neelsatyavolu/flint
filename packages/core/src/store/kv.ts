import { FlintError, type AgentActivity } from "../types";
import { parseJson, type Sql } from "./sql";

export class KvRepo {
  constructor(protected q: Sql) {}

  /** Value stored under key, or null when missing or past its TTL. */
  kvGet(key: string, now: number = Date.now()): string | null {
    const row = this.q.get<{ value: string }>("SELECT value FROM kv_cache WHERE key = ?", key);
    if (!row) return null;
    const env = parseJson<{ v: string; exp: number | null } | null>(row.value, null);
    if (!env || typeof env.v !== "string") return null;
    if (env.exp !== null && env.exp <= now) {
      this.q.run("DELETE FROM kv_cache WHERE key = ?", key);
      return null;
    }
    return env.v;
  }

  kvSet(key: string, value: string, ttlMs?: number, now: number = Date.now()): void {
    const env = JSON.stringify({ v: value, exp: ttlMs === undefined ? null : now + ttlMs });
    this.q.run("INSERT INTO kv_cache (key, value, created_at) VALUES (?,?,?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, created_at = excluded.created_at", key, env, now);
  }

  kvDelete(key: string): void {
    this.q.run("DELETE FROM kv_cache WHERE key = ?", key);
  }

  /** Deletes entries whose TTL has passed. Returns how many. */
  kvPurgeExpired(now: number = Date.now()): number {
    return this.q.run("DELETE FROM kv_cache WHERE json_extract(value, '$.exp') IS NOT NULL AND json_extract(value, '$.exp') <= ?", now).changes;
  }
}

type ActivityRow = { id: number; at: number; agent: string; method: string; summary: string; status: string; detail_json: string };
const toActivity = (r: ActivityRow): AgentActivity => ({
  id: r.id, at: r.at, agent: r.agent, method: r.method, summary: r.summary,
  status: r.status as AgentActivity["status"], detail: parseJson<Record<string, unknown>>(r.detail_json, {}),
});

export class ActivityRepo {
  constructor(protected q: Sql) {}

  insertActivity(input: { agent: string; method: string; summary: string; status: AgentActivity["status"]; detail?: Record<string, unknown>; at?: number }): AgentActivity {
    const id = this.q.run(
      "INSERT INTO agent_activity (at, agent, method, summary, status, detail_json) VALUES (?,?,?,?,?,?)",
      input.at ?? Date.now(), input.agent, input.method, input.summary, input.status, JSON.stringify(input.detail ?? {}),
    ).lastInsertRowid;
    return this.#requireActivity(id);
  }

  getActivity(id: number): AgentActivity | null {
    const r = this.q.get<ActivityRow>("SELECT * FROM agent_activity WHERE id = ?", id);
    return r ? toActivity(r) : null;
  }

  #requireActivity(id: number): AgentActivity {
    const a = this.getActivity(id);
    if (!a) throw new FlintError("not_found", "That activity entry no longer exists.");
    return a;
  }

  /** Newest first. `before` is an `at` timestamp for paging. */
  listActivity(opts: { limit?: number; before?: number } = {}): AgentActivity[] {
    const limit = Math.max(1, Math.min(opts.limit ?? 50, 500));
    const rows = opts.before === undefined
      ? this.q.all<ActivityRow>("SELECT * FROM agent_activity ORDER BY at DESC, id DESC LIMIT ?", limit)
      : this.q.all<ActivityRow>("SELECT * FROM agent_activity WHERE at < ? ORDER BY at DESC, id DESC LIMIT ?", opts.before, limit);
    return rows.map(toActivity);
  }

  /** Updates status and, when given, merges `detail` over the stored detail. */
  updateActivity(id: number, patch: { status?: AgentActivity["status"]; summary?: string; detail?: Record<string, unknown> }): AgentActivity {
    const cur = this.#requireActivity(id);
    this.q.run("UPDATE agent_activity SET status = ?, summary = ?, detail_json = ? WHERE id = ?",
      patch.status ?? cur.status, patch.summary ?? cur.summary, JSON.stringify({ ...cur.detail, ...(patch.detail ?? {}) }), id);
    return this.#requireActivity(id);
  }
}
