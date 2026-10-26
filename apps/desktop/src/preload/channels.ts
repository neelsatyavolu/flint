/** IPC channel names shared by main and preload. */
export const CHANNELS = {
  call: "flint:call",
  event: "flint:event",
  openExternal: "flint:open-external",
  openThread: "flint:open-thread",
  menu: "flint:menu",
  /** Main asks the window to save unsaved drafts before quitting; the window answers on draftsFlushed. */
  flushDrafts: "flint:flush-drafts",
  draftsFlushed: "flint:drafts-flushed",
} as const;
