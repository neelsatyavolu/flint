import type { Template } from "@flint/core";

/** Palette to composer: the composer with this id applies the template or switches its From address. */
export const COMPOSER_COMMAND_EVENT = "flint:composer-command";

export type ComposerCommand = { composerId: string } & ({ template: Template } | { from: string });

export function sendComposerCommand(command: ComposerCommand): void {
  window.dispatchEvent(new CustomEvent<ComposerCommand>(COMPOSER_COMMAND_EVENT, { detail: command }));
}
