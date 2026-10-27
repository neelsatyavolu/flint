import type { ImapFlow } from "imapflow";
import { describe, expect, it } from "vitest";
import { makeStore, seedImap } from "../../store/testkit";
import type { SyncStatus } from "../../types";
import { AccountSync } from "./accountSync";

/** A client whose login Gmail refuses the way it does under a burst of logins. */
const refusingClient = (): ImapFlow =>
  ({
    on: () => undefined,
    connect: async () => {
      throw Object.assign(new Error("Command failed"), { authenticationFailed: true, responseText: "Invalid credentials (Failure)" });
    },
    close: () => undefined,
    logout: async () => undefined,
    usable: false,
    capabilities: new Set<string>(),
  }) as unknown as ImapFlow;

const until = async (check: () => boolean, ms = 2000): Promise<void> => {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 2));
  }
};

function refusing() {
  const store = makeStore();
  const s = seedImap(store);
  const states: SyncStatus["state"][] = [];
  let logins = 0;
  const sync = new AccountSync({
    store,
    accountId: s.account.id,
    getAuth: async () => ({ user: "u", pass: "p" }),
    emit: (e) => { if (e.type === "sync") states.push(e.status.state); },
    dataDir: "/tmp",
    createClient: () => { logins += 1; return refusingClient(); },
    backoff: { minMs: 1, maxMs: 4 },
  });
  return { sync, states, logins: () => logins };
}

describe("rejected logins", () => {
  it("treats the first few as temporary before asking to sign in again", async () => {
    const { sync, states, logins } = refusing();
    sync.start();
    await until(() => states.includes("auth_error"));
    await sync.stop();
    const firstAuthError = states.indexOf("auth_error");
    expect(states.slice(0, firstAuthError).filter((s) => s === "error").length).toBe(4);
    expect(logins()).toBeGreaterThanOrEqual(5);
  });

  it("keeps retrying after showing Sign in again, so a refusal that clears needs nothing from the user", async () => {
    const { sync, states, logins } = refusing();
    sync.start();
    await until(() => states.includes("auth_error"));
    const at = logins();
    await until(() => logins() >= at + 2);
    await sync.stop();
    expect(sync.status().state).toBe("auth_error");
  });

  it("stops promptly while waiting out a rejected login", async () => {
    const store = makeStore();
    const s = seedImap(store);
    const sync = new AccountSync({
      store, accountId: s.account.id, getAuth: async () => ({ user: "u", pass: "p" }), emit: () => undefined, dataDir: "/tmp",
      createClient: refusingClient, backoff: { minMs: 60_000, maxMs: 60_000 },
    });
    sync.start();
    await until(() => sync.status().state === "error");
    const started = Date.now();
    await sync.stop();
    expect(Date.now() - started).toBeLessThan(1000);
  });
});
