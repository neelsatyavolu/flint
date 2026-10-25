/** Window events the AI surfaces emit. The shell listens for them. */

export const OPEN_SETTINGS_EVENT = "flint:open-settings";
export const OPEN_THREAD_EVENT = "flint:open-thread";
export const OPEN_ASK_EVENT = "flint:open-ask";

export function openSettings(section: string): void {
  window.dispatchEvent(new CustomEvent(OPEN_SETTINGS_EVENT, { detail: { section } }));
}

export function openThread(threadId: number): void {
  window.dispatchEvent(new CustomEvent(OPEN_THREAD_EVENT, { detail: { threadId } }));
}

/** Asks the launcher to open its panel, optionally with a first question. */
export function openAsk(question?: string): void {
  window.dispatchEvent(new CustomEvent(OPEN_ASK_EVENT, { detail: { question } }));
}
