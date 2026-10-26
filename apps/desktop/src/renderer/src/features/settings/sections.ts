import type { ComponentType } from "react";
import { AboutSection } from "./sections/AboutSection";
import { AccountsSection } from "./sections/AccountsSection";
import { AgentsSection } from "./sections/AgentsSection";
import { AiSection } from "./sections/AiSection";
import { AppearanceSection } from "./sections/AppearanceSection";
import { BlockedSection } from "./sections/BlockedSection";
import { GeneralSection } from "./sections/GeneralSection";
import { InboxSection } from "./sections/InboxSection";
import { NotificationsSection } from "./sections/NotificationsSection";
import { ReceiptsSection } from "./sections/ReceiptsSection";
import { RulesSection } from "./sections/RulesSection";
import { ShortcutsSection } from "./sections/ShortcutsSection";
import { SignaturesSection } from "./sections/SignaturesSection";
import { TemplatesSection } from "./sections/TemplatesSection";

export type SectionId =
  | "general" | "accounts" | "appearance" | "inbox" | "signatures" | "templates" | "rules"
  | "receipts" | "notifications" | "ai" | "agents" | "shortcuts" | "blocked" | "about";

/** `keywords` are the settings inside a section, so the nav filter finds "theme" under Appearance. */
export const SECTIONS: { id: SectionId; label: string; keywords: string }[] = [
  { id: "general", label: "General", keywords: "mark as read after archive undo send sort storage mail kept plain text" },
  { id: "accounts", label: "Accounts", keywords: "email add remove sign in again password aliases color photo unified sync" },
  { id: "appearance", label: "Appearance", keywords: "theme dark light layout full screen density avatars sender logos photos preview lines text size" },
  { id: "inbox", label: "Inbox", keywords: "focused remote images trackers privacy" },
  { id: "signatures", label: "Signatures", keywords: "signature default" },
  { id: "templates", label: "Templates", keywords: "snippets canned replies" },
  { id: "rules", label: "Rules", keywords: "filters sort automation" },
  { id: "receipts", label: "Read Receipts", keywords: "tracking opened notify" },
  { id: "notifications", label: "Notifications", keywords: "alerts sound dock badge" },
  { id: "ai", label: "+AI", keywords: "ai assistant model chatgpt grok catch up smart replies summaries translation personalization categorization" },
  { id: "agents", label: "Agents", keywords: "cli command skill claude codex" },
  { id: "shortcuts", label: "Shortcuts", keywords: "keyboard keys" },
  { id: "blocked", label: "Blocked", keywords: "senders block" },
  { id: "about", label: "About", keywords: "version updates license privacy" },
];

/** Sections whose label or keywords contain every word of `query`. An empty query keeps them all. */
export function filterSections<T extends { label: string; keywords: string }>(sections: readonly T[], query: string): T[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...sections];
  return sections.filter((s) => {
    const hay = `${s.label} ${s.keywords}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

export const SECTION_VIEWS: Record<SectionId, ComponentType<{ page?: string }>> = {
  general: GeneralSection,
  accounts: AccountsSection,
  appearance: AppearanceSection,
  inbox: InboxSection,
  signatures: SignaturesSection,
  templates: TemplatesSection,
  rules: RulesSection,
  receipts: ReceiptsSection,
  notifications: NotificationsSection,
  ai: AiSection,
  agents: AgentsSection,
  shortcuts: ShortcutsSection,
  blocked: BlockedSection,
  about: AboutSection,
};

/**
 * Accepts "rules", "ai" or "ai/writing" (a +AI sub-page), plus "accounts/<id>" and "accounts/<id>/reauth",
 * which keep the account id's case. Unknown ids fall back to General.
 */
export function parseSection(raw: string | undefined): { id: SectionId; page?: string } {
  const [head = "", ...rest] = (raw ?? "").replace(/^\+/, "").split(/[/:]/);
  const id = SECTIONS.find((s) => s.id === head.toLowerCase())?.id ?? "general";
  if (id === "accounts") {
    const [account, action] = rest;
    if (!account) return { id };
    return { id, page: action?.toLowerCase() === "reauth" ? `${account}/reauth` : account };
  }
  const page = rest[0]?.toLowerCase();
  return page ? { id, page } : { id };
}
