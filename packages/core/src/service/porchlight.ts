import { PorchlightService } from "../porchlight/service";
import type { ServiceContext } from "./context";

export function wirePorchlight(ctx: ServiceContext) {
  const service = new PorchlightService({
    store: ctx.store, platform: ctx.platform, fetch: ctx.fetch, now: ctx.now,
    ensureBodies: (ids) => ctx.ensureBodies(ids), poke: () => ctx.scheduler.poke(),
  });
  let running: Promise<void> | null = null;
  const unregister = ctx.scheduler.addJob({
    nextDueAt: () => running ? null : service.nextDueAt(),
    async run() {
      if (running) return;
      // Network and IMAP work must not hold up the scheduler's next send, snooze or reminder.
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
