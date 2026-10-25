import { logger } from "../log";
import type { FlintEvent } from "../types";

const log = logger("service.events");

export type EventListener = (event: FlintEvent) => void;

/** Synchronous fan-out of FlintEvents. A throwing listener never stops the others. */
export class EventBus {
  #listeners = new Set<EventListener>();

  emit = (event: FlintEvent): void => {
    for (const listener of [...this.#listeners]) {
      try {
        listener(event);
      } catch (error) {
        log.warn("event listener threw", { type: event.type, reason: (error as Error).message });
      }
    }
  };

  subscribe = (listener: EventListener): (() => void) => {
    this.#listeners.add(listener);
    return () => { this.#listeners.delete(listener); };
  };

  get size(): number {
    return this.#listeners.size;
  }
}
