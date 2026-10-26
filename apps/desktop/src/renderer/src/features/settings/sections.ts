import type { ComponentType } from "react";
import { AboutSection } from "./sections/AboutSection";
import { AccountsSection } from "./sections/AccountsSection";
import { AgentsSection } from "./sections/AgentsSection";
import { AiSection } from "./sections/AiSection";
import { AppearanceSection } from "./sections/AppearanceSection";
import { CodesSection } from "./sections/CodesSection";
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
  | "receipts" | "notifications" | "codes" | "ai" | "agents" | "shortcuts" | "blocked" | "about";

export const SECTIONS: { id: SectionId; label: string }[] = [
  { id: "general", label: "General" },
  { id: "accounts", label: "Accounts" },
  { id: "appearance", label: "Appearance" },
  { id: "inbox", label: "Inbox" },
  { id: "signatures", label: "Signatures" },
  { id: "templates", label: "Templates" },
  { id: "rules", label: "Rules" },
  { id: "receipts", label: "Read Receipts" },
  { id: "notifications", label: "Notifications" },
  { id: "codes", label: "Verification codes" },
  { id: "ai", label: "+AI" },
  { id: "agents", label: "Agents" },
  { id: "shortcuts", label: "Shortcuts" },
  { id: "blocked", label: "Blocked" },
  { id: "about", label: "About" },
];

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
  codes: CodesSection,
  ai: AiSection,
  agents: AgentsSection,
  shortcuts: ShortcutsSection,
  blocked: BlockedSection,
  about: AboutSection,
};

/** Accepts "rules", "ai" or "ai/writing" (a +AI sub-page). Unknown ids fall back to General. */
export function parseSection(raw: string | undefined): { id: SectionId; page?: string } {
  const [head, page] = (raw ?? "").toLowerCase().replace(/^\+/, "").split(/[/:]/);
  const id = SECTIONS.find((s) => s.id === head)?.id ?? "general";
  return page ? { id, page } : { id };
}
