import type { NotifyRequest } from "@flint/core/platform";

/** The part of Electron's Notification the notifier uses, so tests can stand in for it. */
export interface NotificationLike {
  on(event: "click" | "close", listener: () => void): unknown;
  on(event: "action", listener: (event: unknown, index: number) => void): unknown;
  show(): void;
  close(): void;
}

export type NotificationOptions = {
  title: string;
  body: string;
  silent?: boolean;
  sound?: string;
  actions?: { type: "button"; text: string }[];
};

export type NotifierHooks = {
  onClick: (threadId: number | undefined) => void;
  onAction: (action: "archive" | "markRead", threadId: number) => void;
  /** The "Copy code" button on a verification code alert. */
  onCopy?: (text: string) => void;
};

export type NotifierDeps = {
  isSupported: () => boolean;
  create: (options: NotificationOptions) => NotificationLike;
  isMac: boolean;
  hooks: NotifierHooks;
  warn?: (message: string) => void;
};

/** Button order on a new-mail alert; the "action" event reports the index. */
export const ALERT_ACTIONS = [
  { text: "Archive", action: "archive" },
  { text: "Mark as read", action: "markRead" },
] as const;

/** The single button on a verification code alert. */
export const COPY_CODE_ACTION = { text: "Copy code" } as const;

/**
 * Shows OS alerts for Platform.notify: honors the sound (null = silent), puts Archive and Mark as read buttons on alerts
 * for a thread on macOS, opens the thread on click, and replaces the earlier alert that has the same group key.
 */
export function createNotifier(deps: NotifierDeps): (req: NotifyRequest) => void {
  // Alerts stay referenced until clicked or closed, or they can be collected.
  const live = new Set<NotificationLike>();
  const byGroup = new Map<string, NotificationLike>();

  return (req) => {
    if (!deps.isSupported()) {
      deps.warn?.("notifications are not supported on this system");
      return;
    }
    const copyText = req.copyText;
    const withCopy = deps.isMac && copyText !== undefined && copyText !== "";
    const withActions = !withCopy && deps.isMac && req.actions === true && req.threadId !== undefined;
    const n = deps.create({
      title: req.title,
      body: req.body,
      ...(req.sound === null ? { silent: true } : req.sound !== undefined ? { sound: req.sound } : {}),
      ...(withCopy ? { actions: [{ type: "button" as const, text: COPY_CODE_ACTION.text }] } : {}),
      ...(withActions ? { actions: ALERT_ACTIONS.map((a) => ({ type: "button" as const, text: a.text })) } : {}),
    });
    const group = req.group;
    if (group) {
      byGroup.get(group)?.close();
      byGroup.set(group, n);
    }
    live.add(n);
    const forget = (): void => {
      live.delete(n);
      if (group && byGroup.get(group) === n) byGroup.delete(group);
    };
    n.on("click", () => { forget(); deps.hooks.onClick(req.threadId); });
    n.on("action", (_event, index) => {
      if (withCopy) {
        if (index === 0 && copyText) deps.hooks.onCopy?.(copyText);
        forget();
        return;
      }
      const picked = ALERT_ACTIONS[index];
      forget();
      if (picked && req.threadId !== undefined) deps.hooks.onAction(picked.action, req.threadId);
    });
    n.on("close", forget);
    n.show();
  };
}
