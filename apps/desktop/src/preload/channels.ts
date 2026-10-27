/** IPC channel names shared by main and preload. */
export const CHANNELS = {
  call: "flint:call",
  event: "flint:event",
  openExternal: "flint:open-external",
  openThread: "flint:open-thread",
  menu: "flint:menu",
  revealExtension: "flint:reveal-extension",
  /** Set up iPhone (Settings > Devices). The window invokes these; main answers events on pairingEvent. */
  pairingStart: "flint:pairing-start",
  pairingApprove: "flint:pairing-approve",
  pairingCancel: "flint:pairing-cancel",
  pairingDevices: "flint:pairing-devices",
  pairingForget: "flint:pairing-forget",
  pairingEvent: "flint:pairing-event",
  /** Main asks the window to save unsaved drafts before quitting; the window answers on draftsFlushed. */
  flushDrafts: "flint:flush-drafts",
  draftsFlushed: "flint:drafts-flushed",
} as const;
