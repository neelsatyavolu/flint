import { Languages, Sparkles, Wand2, ListChecks, MessageSquareReply } from "lucide-react";
import { readStored, writeStored } from "../../../lib/storage";
import { useState } from "react";
import { SettingsRow } from "../../../ui";
import { ChoiceSelect, DebouncedText, SectionPage, ToggleRow } from "../fields";
import { useSettingsStore } from "../settingsStore";
import styles from "../settings.module.css";

const LANGUAGES = ["English", "Spanish", "French", "German", "Portuguese", "Italian", "Dutch", "Japanese", "Chinese", "Korean", "Hindi", "Telugu"];

export const TRANSLATE_LANGUAGE_KEY = "flint.ai.translateLanguage";

function languageChoices(current: string, blank: string) {
  const list = LANGUAGES.includes(current) || current === "" ? LANGUAGES : [...LANGUAGES, current];
  return [{ value: "", label: blank }, ...list.map((l) => ({ value: l, label: l }))];
}

export function PersonalizationPage() {
  const { settings: s, save } = useSettingsStore();
  return (
    <SectionPage title="Personalization" description="Describe how you write. Drafts and replies use this to sound like you.">
      <div className={styles.fields} style={{ paddingTop: "var(--s-4)" }}>
        <DebouncedText
          multiline
          rows={6}
          label="Writing style"
          value={s.ai.writingStyle}
          placeholder="Short and warm. First names. No exclamation marks. Sign off with Thanks."
          onCommit={(v) => void save({ ai: { writingStyle: v } })}
        />
        <p className={styles.muted}>Saved as you type. It is sent to your AI provider along with the mail you ask about.</p>
      </div>
    </SectionPage>
  );
}

export function WritingPage() {
  const { settings: s, save } = useSettingsStore();
  return (
    <SectionPage title="Writing and replies">
      <ToggleRow icon={<MessageSquareReply size={18} strokeWidth={1.5} />} title="Smart replies" description="Suggest three short replies under a thread." checked={s.ai.smartReplies} onChange={(v) => void save({ ai: { smartReplies: v } })} />
      <SettingsRow icon={<Languages size={18} strokeWidth={1.5} />} title="Reply language" description="By default replies match the language of the thread.">
        <ChoiceSelect label="Reply language" value={s.ai.replyLanguage} choices={languageChoices(s.ai.replyLanguage, "Match the thread")} onChange={(v) => void save({ ai: { replyLanguage: v } })} />
      </SettingsRow>
    </SectionPage>
  );
}

export function AutomationPage() {
  const { settings: s, save } = useSettingsStore();
  return (
    <SectionPage title="Inbox automation">
      <ToggleRow icon={<ListChecks size={18} strokeWidth={1.5} />} title="AI categorization" description="When Flint can't tell if mail is from a person, a second opinion from AI decides." checked={s.ai.autoCategorize} onChange={(v) => void save({ ai: { autoCategorize: v } })} />
      <ToggleRow icon={<Wand2 size={18} strokeWidth={1.5} />} title="Summarize long threads" description="Show a summary card above threads with three or more messages." checked={s.ai.autoSummarize} onChange={(v) => void save({ ai: { autoSummarize: v } })} />
    </SectionPage>
  );
}

export function TranslationPage() {
  const [lang, setLang] = useState(() => readStored(TRANSLATE_LANGUAGE_KEY) ?? "");
  const choose = (v: string) => {
    setLang(v);
    writeStored(TRANSLATE_LANGUAGE_KEY, v);
  };
  return (
    <SectionPage title="Translation">
      <SettingsRow icon={<Languages size={18} strokeWidth={1.5} />} title="Translate to" description="The language the Translate action uses by default. Remembered on this computer.">
        <ChoiceSelect label="Translate to" value={lang} choices={languageChoices(lang, "Ask each time")} onChange={choose} />
      </SettingsRow>
    </SectionPage>
  );
}

export function AssistantPage() {
  return (
    <SectionPage title="Assistant">
      <SettingsRow icon={<Sparkles size={18} strokeWidth={1.5} />} title="Ask anything" description="The field at the bottom right of the reader answers questions about your mail, such as what a project owes you this week. Answers cite the threads they came from." />
      <p className={styles.muted} style={{ paddingTop: "var(--s-3)" }}>Flint searches your local mail first and sends only the relevant excerpts to your AI provider.</p>
    </SectionPage>
  );
}
