import type { FlintApi } from "../api";
import { agentPaths } from "../agent/paths";
import { startAgentServer, type AgentServerHandle } from "../agent/server";
import { logger } from "../log";
import type { ServiceContext } from "./context";

const log = logger("service.agents");

const watchers = new WeakMap<ServiceContext, { unsubscribe: () => void; settled: () => Promise<void> }>();

async function launch(ctx: ServiceContext, api: FlintApi): Promise<AgentServerHandle | null> {
  try {
    return await startAgentServer({
      api,
      ...agentPaths(ctx.platform.dataDir),
      getSettings: () => ctx.getSettings(),
      logActivity: (entry) => {
        const activity = ctx.store.insertActivity({ ...entry, at: ctx.now() });
        ctx.emit({ type: "agent_activity", activity });
      },
      onEventSubscribe: ({ agent, open }) => log.info(open ? "agent watching events" : "agent stopped watching events", { agent }),
    });
  } catch (error) {
    log.error("could not start the agent API", { reason: (error as Error).message });
    return null;
  }
}

async function closeHandle(ctx: ServiceContext): Promise<void> {
  const handle = ctx.agent.handle;
  ctx.agent.handle = null;
  await handle?.close().catch((error: Error) => log.warn("agent server did not close cleanly", { reason: error.message }));
}

/**
 * Brings the agent API server in line with settings.agents.enabled now and whenever settings
 * change. Returns the running handle (or null when agents are off). ctx.agent.handle is kept current.
 */
export async function startAgentWiring(ctx: ServiceContext, api: FlintApi): Promise<AgentServerHandle | null> {
  let chain: Promise<void> = Promise.resolve();
  const reconcile = (): Promise<void> => {
    chain = chain.then(async () => {
      const want = ctx.getSettings().agents.enabled;
      if (want && !ctx.agent.handle) ctx.agent.handle = await launch(ctx, api);
      else if (!want && ctx.agent.handle) await closeHandle(ctx);
    }).catch((error: Error) => log.error("agent server update failed", { reason: error.message }));
    return chain;
  };
  const unsubscribe = ctx.bus.subscribe((event) => { if (event.type === "settings") void reconcile(); });
  watchers.set(ctx, { unsubscribe, settled: () => chain });
  await reconcile();
  return ctx.agent.handle;
}

export async function stopAgentWiring(ctx: ServiceContext): Promise<void> {
  const watcher = watchers.get(ctx);
  watchers.delete(ctx);
  watcher?.unsubscribe();
  await watcher?.settled();
  await closeHandle(ctx);
}
