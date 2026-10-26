import type { FlintApi } from "../api";
import { logger } from "../log";
import { alertFor, soundFor, wantsAlert, type NewMailEvent } from "./notifyPolicy";
import { codeAlertCovers } from "./codes";
import type { ServiceContext } from "./context";

const log = logger("service.notify");

/** How long new mail waits for company before alerting, so a burst becomes one summary. */
export const NOTIFY_WINDOW_MS = 1_500;

export type NotifyApi = Pick<FlintApi, "sendTestNotification">;

export function notifyApi(ctx: ServiceContext): NotifyApi {
  return {
    async sendTestNotification() {
      ctx.platform.notify({
        title: "Flint test notification",
        body: "If you can read this, new mail alerts are working.",
        sound: soundFor(ctx.getSettings().notifications),
      });
    },
  };
}

/**
 * Shows an OS notification for new mail according to settings.notifications. Mail arriving within `windowMs` of the first
 * alert-worthy message is shown as one alert. Returns the unsubscribe function.
 */
export function wireNotifications(ctx: ServiceContext, opts: { windowMs?: number } = {}): () => void {
  const windowMs = opts.windowMs ?? NOTIFY_WINDOW_MS;
  let pending: NewMailEvent[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = (): void => {
    timer = null;
    const batch = pending.filter((e) => !codeAlertCovers(ctx, e.threadId));
    pending = [];
    try {
      const alert = alertFor(ctx.getSettings().notifications, batch);
      if (alert) ctx.platform.notify(alert);
    } catch (error) {
      log.warn("could not show a notification", { reason: (error as Error).message });
    }
  };

  const unsubscribe = ctx.bus.subscribe((event) => {
    if (event.type !== "new_mail" || !wantsAlert(ctx.getSettings().notifications, event)) return;
    pending.push(event);
    if (!timer) {
      timer = setTimeout(flush, windowMs);
      timer.unref?.();
    }
  });

  return () => {
    unsubscribe();
    if (timer) clearTimeout(timer);
    timer = null;
    pending = [];
  };
}
