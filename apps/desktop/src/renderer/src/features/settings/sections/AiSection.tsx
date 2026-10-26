import { useState } from "react";
import { ArrowLeft, Bot, Languages, ListChecks, MessageSquareReply, Sparkles, UserRound } from "lucide-react";
import { flint } from "../../../lib/api";
import { useFlintQuery } from "../../../lib/hooks";
import { Button, SettingsRow, useToast } from "../../../ui";
import { AiConnectPanel } from "../ai/AiConnectPanel";
import { AssistantPage, AutomationPage, PersonalizationPage, TranslationPage, WritingPage } from "../ai/AiPages";
import { PROVIDER_LABEL } from "../ai/connectMachine";
import { useAiConnect } from "../ai/useAiConnect";
import { ChoiceSelect, LinkRow, SectionPage, ToggleRow } from "../fields";
import { useSettingsStore } from "../settingsStore";
import { errorText } from "../useAccounts";
import styles from "../settings.module.css";

export const AI_PAGES = ["personalization", "writing", "automation", "translation", "assistant"] as const;
export type AiPage = (typeof AI_PAGES)[number];

const PAGES: Record<AiPage, () => React.JSX.Element> = {
  personalization: PersonalizationPage,
  writing: WritingPage,
  automation: AutomationPage,
  translation: TranslationPage,
  assistant: AssistantPage,
};

export function AiSection({ page: initial }: { page?: string }) {
  const [page, setPage] = useState<AiPage | null>(AI_PAGES.find((p) => p === initial) ?? null);
  if (page) {
    const Page = PAGES[page];
    return (
      <div>
        <Button variant="ghost" size="sm" icon={<ArrowLeft size={14} strokeWidth={1.5} />} className={styles.back} onClick={() => setPage(null)}>+AI</Button>
        <Page />
      </div>
    );
  }
  return <AiHome onOpen={setPage} />;
}

function AiHome({ onOpen }: { onOpen: (p: AiPage) => void }) {
  const toast = useToast();
  const { settings: s, save } = useSettingsStore();
  const status = useFlintQuery((api) => api.aiStatus(), [], { mail: false });
  const connect = useAiConnect(() => status.refetch());
  const st = status.data;
  const connected = st?.connected === true;

  const run = async (fn: () => Promise<unknown>, failure: string) => {
    try {
      await fn();
      status.refetch();
    } catch (err) {
      toast.show({ message: errorText(err, failure), level: "error" });
    }
  };

  return (
    <SectionPage title="+AI" description="Summaries, replies, rewriting and questions about your mail.">
      <ToggleRow
        icon={<Sparkles size={18} strokeWidth={1.5} />}
        title="Enable +AI"
        description="Flint uses your own ChatGPT or Grok subscription. Nothing is billed by Flint. Mail text goes to the provider you choose only when you use an AI feature, and for the automatic catch-up on Home every 3 hours, which you can turn off there."
        checked={s.ai.enabled}
        onChange={(v) => void save({ ai: { enabled: v } })}
      />

      <div className={styles.group}>
        {connected && st ? (
          <SettingsRow icon={<Bot size={18} strokeWidth={1.5} />} title={`Connected to ${st.provider ? PROVIDER_LABEL[st.provider] : "your provider"}`} description="Choose the model Flint asks.">
            <ChoiceSelect
              label="Model"
              value={st.model ?? ""}
              choices={[...(st.model ? [] : [{ value: "", label: "Default" }]), ...st.models.map((m) => ({ value: m.id, label: m.label }))]}
              onChange={(m) => void run(() => flint.aiSetModel(m), "Couldn't change the model. Try again.")}
            />
            <Button variant="ghost" onClick={() => void run(() => flint.aiDisconnect(), "Couldn't disconnect. Try again.")}>Disconnect</Button>
          </SettingsRow>
        ) : (
          <div className="t-body" style={{ paddingTop: "var(--s-2)" }}>
            <div style={{ font: "600 var(--text-setting) / 20px var(--font-ui)" }}>Not connected</div>
            <div className={styles.muted}>Sign in with the subscription you already have. Flint never sees your password.</div>
            <AiConnectPanel connect={connect} />
          </div>
        )}
      </div>

      <div className={styles.group}>
        <LinkRow icon={<UserRound size={18} strokeWidth={1.5} />} title="Personalization" description="How you write" onClick={() => onOpen("personalization")} />
        <LinkRow icon={<MessageSquareReply size={18} strokeWidth={1.5} />} title="Writing and replies" description="Smart replies, reply language" onClick={() => onOpen("writing")} />
        <LinkRow icon={<ListChecks size={18} strokeWidth={1.5} />} title="Inbox automation" description="Categorization and summaries" onClick={() => onOpen("automation")} />
        <LinkRow icon={<Languages size={18} strokeWidth={1.5} />} title="Translation" description="Default language" onClick={() => onOpen("translation")} />
        <LinkRow icon={<Sparkles size={18} strokeWidth={1.5} />} title="Assistant" description="Ask anything about your mail" onClick={() => onOpen("assistant")} />
      </div>
    </SectionPage>
  );
}
