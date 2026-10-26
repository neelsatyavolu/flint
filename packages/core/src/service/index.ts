import type { FlintApi } from "../api";
import type { Platform } from "../platform";
import { flushLog, logger } from "../log";
import { accountsApi } from "./accounts";
import { actionsApi } from "./actions";
import { agentsApi } from "./agents";
import { startAgentWiring, stopAgentWiring } from "./agents-wiring";
import { aiApi } from "./ai";
import { codesApi, wireCodes } from "./codes";
import { codesHelperApi } from "./codesHelper";
import { composeApi } from "./compose";
import { createContext } from "./context";
import { avatarsApi } from "./avatars";
import { notifyApi, wireNotifications } from "./notify";
import { recategorizeIfStale, refreshHeadersIfStale } from "./recategorize";
import { historyApi } from "./history";
import { importSparkApi } from "./importSpark";
import { readingApi } from "./reading";
import { receiptsApi } from "./receipts";
import { settingsApi } from "./settings";
import type { SyncTuning } from "./syncManager";
import { syncApi } from "./sync";

const log = logger("service");

export type FlintService = FlintApi & {
  /** Opens the database, starts sync, the scheduler and (when enabled) the agent API server. */
  start(): Promise<void>;
  stop(): Promise<void>;
};

export type ServiceOptions = {
  /** Start the agent API socket server (desktop: true; tests: false). */
  agentServer?: boolean;
  /** Override the database path (tests use ':memory:'). */
  dbPath?: string;
  /** Clock override (tests). */
  now?: () => number;
  /** fetch override for network calls made by the service (one-click unsubscribe, token refresh, receipts). */
  fetch?: typeof fetch;
  /** Resolves a hostname to its addresses for the one-click unsubscribe SSRF check (tests; default is the system resolver). */
  resolveHost?: (host: string) => Promise<string[]>;
  /** Google sign-in flow (tests replace it; default opens the browser). */
  googleAuth?: typeof import("../mail/google-oauth").startGoogleAuth;
  /** Logs in to Gmail IMAP after Google sign-in and throws when the account has no Gmail inbox (tests replace it). */
  googleMailboxCheck?: typeof import("./connectionCheck").checkGoogleMailbox;
  /** MX lookup used to name the provider that hosts an address (tests). */
  resolveMx?: (domain: string) => Promise<{ exchange: string; priority: number }[]>;
  /** Home directory searched for Spark Desktop's settings (tests; default is the real home). */
  sparkHome?: string;
  /** Sync loop timing (tests shorten the poll interval). */
  sync?: SyncTuning;
  /** Google OAuth client this build ships with, used when the user hasn't set their own in settings.google. */
  googleClient?: import("../mail/connect").GoogleClient;
  /** Home directory whose coding-agent skills folders get the flint skill (tests; default is the real home). */
  agentHome?: string;
  /** Absolute path of the bundled CLI script (apps/cli/dist/flint.js). installCli wraps it. */
  cliPath?: string;
  /** Where installCli writes the `flint` wrapper and agentInfo looks for it. Default ~/.local/bin, /usr/local/bin. */
  cliInstallDirs?: string[];
  /** Home directory whose Library/Application Support holds the browsers' NativeMessagingHosts folders (tests; default is the real home). */
  browserHome?: string;
  /** Folder holding the built browser extension (Resources/browser-extension in the app); null/absent when this build does not ship it. */
  extensionDir?: string;
};

/** Builds the real service. The method groups live in their own files; TypeScript checks the composition covers FlintApi. */
/** Header refresh waits for the first sync cycles so it doesn't compete with them. */
const HEADER_REFRESH_DELAY_MS = 20_000;

export async function createFlintService(platform: Platform, opts: ServiceOptions = {}): Promise<FlintService> {
  const ctx = createContext(platform, opts);
  const api: FlintApi = {
    ...accountsApi(ctx),
    ...avatarsApi(ctx),
    ...notifyApi(ctx),
    ...syncApi(ctx),
    ...readingApi(ctx),
    ...historyApi(ctx),
    ...actionsApi(ctx),
    ...composeApi(ctx),
    ...importSparkApi(ctx),
    ...receiptsApi(ctx),
    ...aiApi(ctx),
    ...agentsApi(ctx),
    ...codesApi(ctx),
    ...codesHelperApi(ctx),
    ...settingsApi(ctx),
    subscribe: ctx.bus.subscribe,
  };
  const unwireNotifications = wireNotifications(ctx);
  const unwireCodes = wireCodes(ctx, { startSocket: Boolean(opts.agentServer) });
  const unwire = (): void => { unwireNotifications(); unwireCodes(); };
  let state: "new" | "started" | "stopped" = "new";
  let headerRefresh: ReturnType<typeof setTimeout> | null = null;

  return {
    ...api,

    async start() {
      if (state !== "new") return;
      state = "started";
      await ctx.secretsReady;
      ctx.store.kvPurgeExpired(ctx.now());
      recategorizeIfStale(ctx);
      ctx.syncs.startAll();
      // After the first sync settles, bring older mail's headers up to what the categorizer reads.
      headerRefresh = setTimeout(() => void refreshHeadersIfStale(ctx).catch((error: Error) => log.warn("header refresh failed", { reason: error.message })), HEADER_REFRESH_DELAY_MS);
      headerRefresh.unref?.();
      void ctx.optimistic.replayPending().catch((error: Error) => log.warn("replaying pending operations failed", { reason: error.message }));
      await ctx.scheduler.start();
      if (opts.agentServer) ctx.agent.handle = await startAgentWiring(ctx, api);
      log.info("service started");
    },

    async stop() {
      if (state === "stopped") return;
      state = "stopped";
      if (headerRefresh) clearTimeout(headerRefresh);
      unwire();
      ctx.scheduler.stop();
      await stopAgentWiring(ctx);
      await ctx.syncs.stopAll();
      ctx.ai.dispose();
      await flushLog();
      ctx.store.db.close();
      log.info("service stopped");
    },
  };
}
