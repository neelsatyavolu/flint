/** IPC channel names shared by main and preload. */
export const CHANNELS = {
  call: "flint:call",
  event: "flint:event",
  openExternal: "flint:open-external",
  openThread: "flint:open-thread",
  menu: "flint:menu",
  revealExtension: "flint:reveal-extension",
} as const;
