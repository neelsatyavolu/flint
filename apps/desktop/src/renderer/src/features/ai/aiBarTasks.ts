import type { AiTask } from "@flint/core";

export type BarChip = { id: string; label: string; needsText: boolean };

export const REWRITE_CHIPS: BarChip[] = [
  { id: "shorter", label: "Shorter", needsText: true },
  { id: "longer", label: "Longer", needsText: true },
  { id: "formal", label: "More formal", needsText: true },
  { id: "friendly", label: "Friendlier", needsText: true },
  { id: "fix", label: "Fix grammar", needsText: true },
];

export const LANGUAGES = ["Spanish", "French", "German", "Portuguese", "Italian", "Japanese", "Chinese", "Hindi", "Telugu"];

export type BarContext = { threadId: number | null; draftId?: number; text: string };

/** Free text typed in the bar: rewrites the selection or body when there is text, else composes from the prompt. */
export function taskForPrompt(prompt: string, ctx: BarContext): AiTask | null {
  const p = prompt.trim();
  if (!p) return null;
  if (ctx.text.trim()) return { kind: "rewrite", text: ctx.text, style: p };
  return { kind: "compose", prompt: p, draftId: ctx.draftId };
}

export function taskForReply(ctx: BarContext, instructions: string): AiTask | null {
  const i = instructions.trim() || undefined;
  if (ctx.threadId !== null) return { kind: "reply", threadId: ctx.threadId, instructions: i };
  return i ? { kind: "compose", prompt: i, draftId: ctx.draftId } : null;
}

export function taskForStyle(style: string, ctx: BarContext): AiTask | null {
  return ctx.text.trim() ? { kind: "rewrite", text: ctx.text, style } : null;
}

export function taskForTranslate(language: string, ctx: BarContext): AiTask | null {
  return ctx.text.trim() ? { kind: "translate", text: ctx.text, language } : null;
}
