import { useMemo } from "react";
import { create } from "zustand";
import type { MessageView } from "@flint/core";
import { adaptMailForDarkCached } from "../../lib/mailDark";
import { useResolvedTheme } from "../../lib/theme";
import { useApp } from "../../state/AppContext";

/** How a message's HTML is presented. FROZEN: MessageBody and the message ... menu read this. */
export type MailAppearance = {
  /** HTML to put in the sandboxed iframe: adapted to the theme, or the original. Null for plain-text mail. */
  html: string | null;
  /** "light-sheet": show on a light sheet with a small rounded inset because the mail cannot be adapted safely or the user chose the original. */
  sheet: "theme" | "light-sheet";
  /** True when the message HTML was adapted or could be (the ... menu then offers the toggle). False for plain text and "light" mode. */
  canToggle: boolean;
  /** True while the original colors are shown. */
  showingOriginal: boolean;
  toggleOriginal: () => void;
};

/**
 * Per-message flip of the default presentation, shared by the card menu and the body. Session only.
 * Default for adaptable mail is dark, so a flip shows the original; for mail we would not adapt the
 * default is the original, so a flip shows the dark version.
 */
export const useOriginalChoice = create<{ original: Record<number, boolean>; toggle: (id: number) => void }>((set) => ({
  original: {},
  toggle: (id) => set((s) => ({ original: { ...s.original, [id]: !s.original[id] } })),
}));

/**
 * Decides how a message's HTML is shown. Plain text returns html null (it follows the theme on its own).
 * Light theme or emailAppearance "light" shows the original on the light sheet. Dark theme with "match"
 * adapts the colors, or falls back to the light sheet when adapting would break the design.
 * With `enabled` false nothing is adapted (canToggle stays false), for callers that only need it later, like a menu.
 */
export function useMailAppearance(message: MessageView, enabled = true): MailAppearance {
  const { settings } = useApp();
  const theme = useResolvedTheme();
  const flipped = useOriginalChoice((s) => s.original[message.id] === true);
  const toggle = useOriginalChoice((s) => s.toggle);
  const toggleOriginal = () => toggle(message.id);

  const wantsDark = enabled && theme === "dark" && settings.appearance.emailAppearance === "match";
  const original = message.html;
  const adapted = useMemo(() => (wantsDark && original ? adaptMailForDarkCached(message.id, original) : null), [wantsDark, original, message.id]);

  if (original === null) return { html: null, sheet: "theme", canToggle: false, showingOriginal: false, toggleOriginal };
  if (!adapted) return { html: original, sheet: "light-sheet", canToggle: false, showingOriginal: true, toggleOriginal };
  const showingOriginal = adapted.adaptable ? flipped : !flipped;
  return {
    html: showingOriginal ? original : adapted.html,
    sheet: showingOriginal ? "light-sheet" : "theme",
    canToggle: true,
    showingOriginal,
    toggleOriginal,
  };
}
