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

export type BarContext = {
  threadId: number | null;
  draftId?: number;
  text: string;
  /** "selection" when the user highlighted part of the body. */
  scope?: "selection" | "body";
  to?: string;
  subject?: string;
};

/** Core caps reply instructions at 4000 characters; leave room for the framing and the user's prompt. */
const MAX_DRAFT_IN_INSTRUCTIONS = 2800;

function composeContext(prompt: string, ctx: BarContext): string {
  const lines = [ctx.to?.trim() ? `To: ${ctx.to.trim()}` : "", ctx.subject?.trim() ? `Subject: ${ctx.subject.trim()}` : ""].filter(Boolean);
  return lines.length ? `${lines.join("\n")}\n\n${prompt}` : prompt;
}

/**
 * Free text typed in the bar. In a thread it stays a reply so the model sees the conversation:
 * the text is the user's instructions, or, over an existing draft, a revision request carrying that draft.
 * Outside a thread it rewrites the selection or body, or composes from the prompt.
 */
export function taskForPrompt(prompt: string, ctx: BarContext): AiTask | null {
  const p = prompt.trim();
  if (!p) return null;
  const hasText = ctx.text.trim() !== "";
  if (hasText && ctx.scope === "selection") return { kind: "rewrite", text: ctx.text, style: p };
  if (ctx.threadId !== null) {
    if (!hasText) return { kind: "reply", threadId: ctx.threadId, instructions: p };
    const draft = ctx.text.trim();
    if (draft.length > MAX_DRAFT_IN_INSTRUCTIONS) return { kind: "rewrite", text: ctx.text, style: p };
    return {
      kind: "reply",
      threadId: ctx.threadId,
      instructions: `Revise my current draft reply as instructed, keeping what the thread requires. Output only the full revised reply.\n\nChange requested: ${p}\n\nCurrent draft:\n${draft}`,
    };
  }
  if (hasText) return { kind: "rewrite", text: ctx.text, style: p };
  return { kind: "compose", prompt: composeContext(p, ctx), draftId: ctx.draftId };
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
