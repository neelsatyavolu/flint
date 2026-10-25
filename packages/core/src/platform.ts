/** What the host (Electron main, tests) provides to core. Core never imports Electron. */
export interface SecretStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

/** One OS alert. The host maps it to a native notification; `group` alerts with the same key replace each other. */
export type NotifyRequest = {
  title: string;
  body: string;
  threadId?: number;
  /** macOS system sound name; null = silent; omitted = the system default. */
  sound?: string | null;
  /** Alerts sharing a group key replace one another (used for the "3 new messages" summary). */
  group?: string;
  /** Show Archive / Mark as read buttons that act on `threadId`. */
  actions?: boolean;
};

export interface Platform {
  dataDir: string;
  downloadsDir: string;
  secrets: SecretStore;
  openExternal(url: string): Promise<void>;
  openPath(path: string): Promise<void>;
  notify(n: NotifyRequest): void;
  appVersion: string;
}

/** In-memory secrets for tests and the web preview. */
export function memorySecrets(initial: Record<string, string> = {}): SecretStore {
  const map = new Map(Object.entries(initial));
  return {
    async get(key) { return map.get(key) ?? null; },
    async set(key, value) { map.set(key, value); },
    async delete(key) { map.delete(key); },
  };
}
