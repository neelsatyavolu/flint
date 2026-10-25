import { createStoreCategorizer, type AiEngine } from "../ai";
import type { CategorizerOptions } from "../ai/autoCategorize";
import type { Store } from "../store";
import type { Settings } from "../types";
import type { EventBus } from "./events";

/**
 * Starts the AI categorizer and pokes it whenever mail arrives or changes. The categorizer itself
 * stays idle unless settings.ai.autoCategorize is on, and pauses while no AI provider is connected.
 * Returns a function that unsubscribes and disposes it.
 */
export function startCategorizer(w: {
  store: Store;
  bus: EventBus;
  engine: Pick<AiEngine, "complete">;
  getSettings: () => Settings;
  now: () => number;
  options?: CategorizerOptions;
}): () => void {
  const categorizer = createStoreCategorizer({
    store: w.store, engine: w.engine, getSettings: w.getSettings, now: w.now, emit: w.bus.emit,
    ...(w.options ? { options: w.options } : {}),
  });
  const unsubscribe = w.bus.subscribe((e) => {
    if (e.type === "new_mail" || e.type === "mail_changed") categorizer.poke();
  });
  return () => {
    unsubscribe();
    categorizer.dispose();
  };
}
