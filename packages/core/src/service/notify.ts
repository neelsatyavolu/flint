import type { ServiceContext } from "./context";

/** Shows an OS notification for new mail according to settings.notifications. Returns the unsubscribe function. */
export function wireNotifications(ctx: ServiceContext): () => void {
  return ctx.bus.subscribe((event) => {
    if (event.type !== "new_mail") return;
    const n = ctx.getSettings().notifications;
    if (!n.enabled || n.scope === "none" || (n.scope === "people" && event.category !== "people")) return;
    ctx.platform.notify({ title: event.from.name || event.from.address, body: event.subject, threadId: event.threadId });
  });
}
