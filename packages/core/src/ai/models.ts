import { bundledModels, loadModels, selectModels, type ModelCatalog, type Provider } from "@neelsatyavolu/shared-ai-auth";

export const MODEL_CACHE_MS = 10 * 60_000;
// Add model IDs here only when Flint should hide them. New catalog entries show by default.
const HIDDEN_MODELS: Record<Provider, readonly string[]> = { codex: [], grok: [] };
const LAST_RESORT: Record<Provider, string> = { codex: "gpt-6-astra", grok: "grok-4.7" };

export type ModelInfo = { id: string; label: string };

export function createModelCatalog(opts: { fetch?: typeof fetch; now: () => number }) {
  let cached: ModelCatalog = bundledModels;
  let refreshAt = 0;
  let inflight: Promise<ModelCatalog> | null = null;

  async function catalog(): Promise<ModelCatalog> {
    if (opts.now() < refreshAt) return cached;
    inflight ??= loadModels({ fallback: cached, ...(opts.fetch ? { fetch: opts.fetch } : {}) })
      .then((c) => { cached = c; refreshAt = opts.now() + MODEL_CACHE_MS; return c; })
      .finally(() => { inflight = null; });
    return inflight;
  }

  async function list(provider: Provider): Promise<ModelInfo[]> {
    return selectModels(await catalog(), provider, HIDDEN_MODELS[provider]).map(({ id, label }) => ({ id, label }));
  }

  /** The requested model if it is listed, else the first listed model. */
  async function resolve(provider: Provider, requested: string | null | undefined): Promise<string> {
    const models = await list(provider);
    return models.find((m) => m.id === requested)?.id ?? models[0]?.id ?? LAST_RESORT[provider];
  }

  return { list, resolve };
}
export type ModelCatalogService = ReturnType<typeof createModelCatalog>;
