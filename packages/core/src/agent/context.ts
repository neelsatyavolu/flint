import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Caller context for agent API calls.
 *
 * The agent server runs every `api[method](...)` call inside `runAsAgent(name, fn)`
 * (its default `callAs` hook). Anything the service calls underneath, however deep
 * and however many awaits later, can ask `currentAgent()` who the caller is.
 *
 * - `undefined` means the call came from the desktop UI (not an agent).
 * - The service uses this to set `scheduled_sends.requested_by`, `drafts.created_by`,
 *   and to turn `settings.agents.send = 'ask'` into `awaiting_approval` only for agents.
 *
 * Hosts that cannot use AsyncLocalStorage can pass their own `callAs` to
 * `startAgentServer` instead (for example to set a field on the service for the
 * duration of the call).
 */
const store = new AsyncLocalStorage<{ agent: string }>();

export function runAsAgent<T>(agent: string, fn: () => Promise<T>): Promise<T> {
  return store.run({ agent }, fn);
}

/** Name of the agent that made the current call, or undefined for calls from the UI. */
export function currentAgent(): string | undefined {
  return store.getStore()?.agent;
}
