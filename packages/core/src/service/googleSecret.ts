import { logger } from "../log";
import type { SecretStore } from "../platform";
import type { Store } from "../store";
import type { DeepPartial, Settings } from "../types";

const log = logger("service.googleSecret");

/** Where the Google OAuth client secret lives. It never goes into the settings table or settings events. */
export const GOOGLE_SECRET_KEY = "google:clientSecret";
/** What getSettings() reports for google.clientSecret when one is saved. A patch carrying it leaves the secret alone. */
export const SECRET_MASK = "••••••••";

/** Holds the secret in memory (settings reads are synchronous) and mirrors it to the platform secret store. */
export class GoogleSecret {
  #value = "";
  #pending: Promise<void> = Promise.resolve();

  constructor(private secrets: SecretStore, private store: Store) {}

  get value(): string {
    return this.#value;
  }

  /** Loads the secret, moving a value an older version kept in settings into the secret store. Resolves when done. */
  load(): Promise<void> {
    this.#pending = this.#pending.then(async () => {
      try {
        const saved = await this.secrets.get(GOOGLE_SECRET_KEY);
        const legacy = this.store.getSettings().google.clientSecret;
        if (saved && !this.#value) this.#value = saved;
        if (legacy) {
          if (!this.#value) this.#value = legacy;
          await this.secrets.set(GOOGLE_SECRET_KEY, this.#value);
          this.store.updateSettings({ google: { clientSecret: "" } });
          log.info("moved the Google client secret into the secret store");
        }
      } catch (error) {
        log.warn("could not load the Google client secret", { reason: (error as Error).message });
      }
    });
    return this.#pending;
  }

  /** Takes the secret out of a settings patch, saves it, and returns the patch without it. */
  intercept(patch: DeepPartial<Settings>): DeepPartial<Settings> {
    const incoming = patch.google?.clientSecret;
    if (incoming === undefined) return patch;
    const { clientSecret: _drop, ...google } = patch.google!;
    if (incoming !== SECRET_MASK) {
      this.#value = incoming;
      this.#pending = this.#pending.then(() => (incoming ? this.secrets.set(GOOGLE_SECRET_KEY, incoming) : this.secrets.delete(GOOGLE_SECRET_KEY)))
        .catch((error: Error) => log.warn("could not save the Google client secret", { reason: error.message }));
    }
    return { ...patch, google };
  }

  /** Settings as every consumer outside the service sees them: the secret is replaced by a mask or empty. */
  redact(settings: Settings): Settings {
    return { ...settings, google: { ...settings.google, clientSecret: this.#value ? SECRET_MASK : "" } };
  }

  flush(): Promise<void> {
    return this.#pending;
  }
}
