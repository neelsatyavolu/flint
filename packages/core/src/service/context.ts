import { join } from "node:path";
import type { InviteHooks } from "../calendar/contracts";
import { createCodeRegistry, type CodeRegistry } from "../codes/registry";
import { createAiEngine, type AiEngine } from "../ai";
import { startCategorizer } from "./categorizerWiring";
import { currentAgent } from "../agent/context";
import type { AgentServerHandle } from "../agent/server";
import { openDb } from "../db/open";
import { initLog, logger } from "../log";
import type { Platform } from "../platform";
import { ReceiptsClient } from "../receipts";
import { Scheduler } from "../scheduler";
import { Store } from "../store";
import type { GoogleClient } from "../mail/connect";
import type { Address, AccountId, DeepPartial, FlintEvent, MessageRowId, Settings } from "../types";
import { buildAiContext } from "./aiContext";
import { ensureBodies } from "./bodies";
import { EventBus } from "./events";
import { createOptimistic, type Optimistic } from "./optimistic";
import { notifyUser } from "./scheduler-wiring";
import type { ServiceOptions } from "./index";
import { GoogleSecret } from "./googleSecret";
import { googleClientFrom, SyncManager } from "./syncManager";
import { UndoRegistry } from "./undo";

const log = logger("service");
/** A slow receipts service must not hold up a send (install + register run before SMTP) or the first poll. */
const RECEIPTS_TIMEOUT_MS = 3_000;

/**
 * Hooks the compose engineer fills in (in service/compose.ts, when the method group is built).
 * The backbone reads them lazily, so they can be assigned after the context exists.
 */
export type ComposeHooks = {
  /** Sends a plain text message from an account without a draft (unsubscribe by mailto). */
  sendRaw?: (input: { accountId: AccountId; to: Address[]; subject: string; text: string }) => Promise<void>;
  /** Scheduler job: performs the SMTP send of a queued draft. Throw to trigger the retry backoff. */
  sendJob?: (draftId: number, scheduledId: number) => Promise<{ messageId?: string } | void>;
};

export type ServiceContext = {
  readonly platform: Platform;
  readonly options: ServiceOptions;
  readonly store: Store;
  readonly bus: EventBus;
  readonly emit: (event: FlintEvent) => void;
  readonly now: () => number;
  readonly fetch: typeof fetch;
  /** Name of the agent behind the current call, or undefined when the UI called. */
  readonly caller: () => string | undefined;
  getSettings(): Settings;
  /** Validates and stores a patch, then emits {type:'settings'}. */
  updateSettings(patch: DeepPartial<Settings>): Settings;
  googleClient(): GoogleClient | null;
  /** Downloads missing bodies for these messages (best effort). */
  ensureBodies(messageIds: MessageRowId[]): Promise<void>;
  /** Resolves once the Google client secret is loaded from the secret store (and migrated out of settings). */
  readonly secretsReady: Promise<void>;
  readonly syncs: SyncManager;
  readonly undo: UndoRegistry;
  readonly optimistic: Optimistic;
  // Slots. Constructed here; their FlintApi methods live in the files of the engineers who own them.
  readonly scheduler: Scheduler;
  readonly receipts: ReceiptsClient;
  readonly ai: AiEngine;
  readonly compose: ComposeHooks;
  readonly agent: { handle: AgentServerHandle | null };
  /** Recent verification codes, in memory only. */
  readonly codes: CodeRegistry;
  /** Calendar invitation collaborators (Google Calendar client, iMIP sender); from ServiceOptions.calendar, defaults filled by service/invites. */
  readonly invites: InviteHooks;
};

export function createContext(platform: Platform, options: ServiceOptions = {}): ServiceContext {
  initLog(platform.dataDir);
  const store = new Store(openDb(options.dbPath ?? join(platform.dataDir, "flint.db")));
  const bus = new EventBus();
  const now = options.now ?? Date.now;
  const fetchImpl: typeof fetch = options.fetch ?? ((input, init) => fetch(input, init));
  const googleSecret = new GoogleSecret(platform.secrets, store);
  /** Settings as the rest of the app sees them: the Google client secret is masked. */
  const builtInGoogle = options.googleClient?.clientId && options.googleClient.clientSecret ? options.googleClient : null;
  const getSettings = (): Settings => {
    const settings = googleSecret.redact(store.getSettings());
    return builtInGoogle ? { ...settings, google: { ...settings.google, builtIn: true } } : settings;
  };
  /** The user's own client when they set one, else the one this build ships with. */
  const googleClient = () =>
    googleClientFrom({ ...store.getSettings(), google: { ...store.getSettings().google, clientSecret: googleSecret.value } }) ?? builtInGoogle;
  const secretsReady = googleSecret.load();

  const syncs = new SyncManager({
    store, platform, getSettings, googleClient, emit: bus.emit, fetch: fetchImpl, ...(options.sync ? { tuning: options.sync } : {}),
  });
  const undo = new UndoRegistry({ now });
  const optimistic = createOptimistic({ store, emit: bus.emit, undo, actionsFor: (id) => syncs.get(id).actions, caller: currentAgent, now });

  const compose: ComposeHooks = {};
  const receipts = new ReceiptsClient({ store, secrets: platform.secrets, getSettings, fetch: (input, init) => fetchImpl(input, init as RequestInit), now, emit: bus.emit, timeoutMs: RECEIPTS_TIMEOUT_MS });

  const scheduler = new Scheduler({
    store,
    now,
    setTimer: (fn, ms) => { const h = setTimeout(fn, ms); h.unref(); return h; },
    clearTimer: (h) => clearTimeout(h as NodeJS.Timeout),
    emit: bus.emit,
    jobs: {
      sendDraft: (draftId, scheduledId) => {
        if (!compose.sendJob) throw new Error("Sending is not wired yet.");
        return compose.sendJob(draftId, scheduledId);
      },
      onSnoozeWake: async ({ threadId, subject, locations }) => {
        notifyUser(platform, getSettings(), { title: "Back in your inbox", body: subject || "(no subject)", threadId });
        // The woken thread's latest message is unread locally; make the server agree.
        const byAccount = new Map<AccountId, typeof locations>();
        for (const l of locations) byAccount.set(l.accountId, [...(byAccount.get(l.accountId) ?? []), l]);
        for (const [accountId, locs] of byAccount) {
          const report = await syncs.get(accountId).actions.setSeen(locs, false).catch((e: Error) => ({ ok: false, errors: [{ message: e.message }] }));
          if (!report.ok) log.warn("could not mark a woken thread unread on the server", { accountId });
        }
      },
      onReminder: ({ threadId, outcome, message }) => {
        if (outcome === "fired") notifyUser(platform, getSettings(), { title: "Follow up", body: message, threadId });
      },
      receipts,
    },
  });

  const engine = createAiEngine(buildAiContext({ store, syncs, platform, getSettings, now, fetch: fetchImpl }), {
    onChange: () => bus.emit({ type: "settings", settings: getSettings() }),
  });
  // Background AI categorization: runs only with settings.ai.autoCategorize on and a connected provider.
  const stopCategorizer = startCategorizer({ store, bus, engine, getSettings, now });
  // service.stop() disposes the engine, so the categorizer goes down with it.
  const ai: AiEngine = { ...engine, dispose: () => { stopCategorizer(); engine.dispose(); } };

  return {
    platform, options, store, bus, emit: bus.emit, now, fetch: fetchImpl, caller: currentAgent,
    getSettings,
    updateSettings(patch) {
      store.updateSettings(googleSecret.intercept(patch));
      const settings = getSettings();
      bus.emit({ type: "settings", settings });
      return settings;
    },
    googleClient, secretsReady,
    ensureBodies: (ids) => ensureBodies(store, syncs, ids),
    syncs, undo, optimistic, scheduler, receipts, ai, compose, agent: { handle: null }, codes: createCodeRegistry(now),
    invites: { ...options.calendar },
  };
}
