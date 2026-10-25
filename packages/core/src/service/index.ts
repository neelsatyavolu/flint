import type { FlintApi } from "../api";
import type { Platform } from "../platform";
import { logger } from "../log";
import { accountsApi } from "./accounts";
import { actionsApi } from "./actions";
import { agentsApi } from "./agents";
import { startAgentWiring, stopAgentWiring } from "./agents-wiring";
import { aiApi } from "./ai";
import { composeApi } from "./compose";
import { createContext } from "./context";
import { wireNotifications } from "./notify";
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
  /** Sync loop timing (tests shorten the poll interval). */
  sync?: SyncTuning;
  /** Absolute path of the bundled CLI script (apps/cli/dist/flint.js). installCli wraps it. */
  cliPath?: string;
  /** Where installCli writes the `flint` wrapper and agentInfo looks for it. Default ~/.local/bin, /usr/local/bin. */
  cliInstallDirs?: string[];
};

/** Builds the real service. The method groups live in their own files; TypeScript checks the composition covers FlintApi. */
export async function createFlintService(platform: Platform, opts: ServiceOptions = {}): Promise<FlintService> {
  const ctx = createContext(platform, opts);
  const api: FlintApi = {
    ...accountsApi(ctx),
    ...syncApi(ctx),
    ...readingApi(ctx),
    ...actionsApi(ctx),
    ...composeApi(ctx),
    ...receiptsApi(ctx),
    ...aiApi(ctx),
    ...agentsApi(ctx),
    ...settingsApi(ctx),
    subscribe: ctx.bus.subscribe,
  };
  const unwire = wireNotifications(ctx);
  let state: "new" | "started" | "stopped" = "new";

  return {
    ...api,

    async start() {
      if (state !== "new") return;
      state = "started";
      ctx.store.kvPurgeExpired(ctx.now());
      ctx.syncs.startAll();
      await ctx.scheduler.start();
      if (opts.agentServer) ctx.agent.handle = await startAgentWiring(ctx, api);
      log.info("service started");
    },

    async stop() {
      if (state === "stopped") return;
      state = "stopped";
      unwire();
      ctx.scheduler.stop();
      await stopAgentWiring(ctx);
      await ctx.syncs.stopAll();
      ctx.ai.dispose();
      ctx.store.db.close();
      log.info("service stopped");
    },
  };
}
