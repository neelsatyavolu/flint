/** What the host (Electron main, tests) provides to core. Core never imports Electron. */
export interface SecretStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface Platform {
  dataDir: string;
  downloadsDir: string;
  secrets: SecretStore;
  openExternal(url: string): Promise<void>;
  openPath(path: string): Promise<void>;
  notify(n: { title: string; body: string; threadId?: number }): void;
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
