/** Shape of window.flintHost (declared by preload). Kept local so renderer code needs no global augmentation. */
export type FlintHost = {
  platform: string;
  openExternal(url: string): Promise<void> | void;
  onOpenThread(cb: (threadId: number) => void): () => void;
  onMenu(cb: (command: string) => void): () => void;
};

export function getHost(): FlintHost | undefined {
  return (window as unknown as { flintHost?: FlintHost }).flintHost;
}

export function openExternal(url: string): void {
  const host = getHost();
  if (host) void host.openExternal(url);
  else window.open(url, "_blank", "noopener,noreferrer");
}

export function isMac(): boolean {
  const p = getHost()?.platform;
  return p ? p === "darwin" : /Mac/.test(navigator.platform);
}
