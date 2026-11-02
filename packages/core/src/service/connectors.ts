import { ConnectorService } from "../connectors/service";
import type { ServiceContext } from "./context";

export function wireConnectors(ctx: ServiceContext) {
  const service = new ConnectorService({
    store: ctx.store, platform: ctx.platform, fetch: ctx.fetch, now: ctx.now,
    ensureBodies: (ids) => ctx.ensureBodies(ids), poke: () => ctx.scheduler.poke(),
  });
  let running: Promise<void> | null = null;
  const unregister = ctx.scheduler.addJob({
    nextDueAt: () => running ? null : service.nextDueAt(),
    async run() {
      if (running) return;
      // HTTP/IMAP work must not hold up the scheduler's next send, snooze or reminder.
      running = service.run().catch(() => undefined).finally(() => {
        running = null;
        ctx.scheduler.poke();
      });
    },
  });
  return {
    api: service.api,
    async stop() { unregister(); await service.stop(); await running; },
  };
}
