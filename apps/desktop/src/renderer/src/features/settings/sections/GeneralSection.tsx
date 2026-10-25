import { ArrowDownUp, MailOpen, Archive, Undo2, Type, History } from "lucide-react";
import { SectionPage, SelectRow, ToggleRow } from "../fields";
import { useSettingsStore } from "../settingsStore";

export function GeneralSection() {
  const { settings: s, save } = useSettingsStore();
  return (
    <SectionPage title="General">
      <SelectRow
        icon={<MailOpen size={18} strokeWidth={1.5} />}
        title="Mark as read"
        description="When a message is opened in the reader."
        value={s.inbox.markReadOnOpen}
        choices={[{ value: "instant", label: "Right away" }, { value: "delay", label: "After a short delay" }, { value: "never", label: "Never" }]}
        onChange={(v) => void save({ inbox: { markReadOnOpen: v } })}
      />
      <SelectRow
        icon={<Archive size={18} strokeWidth={1.5} />}
        title="After archive"
        description="What opens once a thread is archived or trashed."
        value={s.inbox.afterArchive}
        choices={[{ value: "next", label: "Next thread" }, { value: "previous", label: "Previous thread" }, { value: "list", label: "Back to the list" }]}
        onChange={(v) => void save({ inbox: { afterArchive: v } })}
      />
      <SelectRow
        icon={<Undo2 size={18} strokeWidth={1.5} />}
        title="Undo send"
        description="How long a sent message waits before it leaves."
        value={s.compose.undoSendSeconds}
        choices={[{ value: 0, label: "Off" }, { value: 5, label: "5 seconds" }, { value: 10, label: "10 seconds" }, { value: 20, label: "20 seconds" }, { value: 30, label: "30 seconds" }]}
        onChange={(v) => void save({ compose: { undoSendSeconds: v } })}
      />
      <SelectRow
        icon={<ArrowDownUp size={18} strokeWidth={1.5} />}
        title="Default sort"
        description="Order of threads in every list."
        value={s.inbox.sort}
        choices={[{ value: "newest", label: "Newest first" }, { value: "oldest", label: "Oldest first" }]}
        onChange={(v) => void save({ inbox: { sort: v } })}
      />
      <SelectRow
        icon={<History size={18} strokeWidth={1.5} />}
        title="Mail kept on this computer"
        description="How far back Flint downloads when it first syncs. Older mail loads when you reach the end of a list or search."
        value={s.sync.initialDays}
        choices={[30, 90, 180, 365, 730].map((days) => ({ value: days, label: days === 365 ? "1 year" : days === 730 ? "2 years" : `${days} days` }))}
        onChange={(v) => void save({ sync: { initialDays: v } })}
      />
      <ToggleRow
        icon={<Type size={18} strokeWidth={1.5} />}
        title="Plain text only"
        description="Write new mail without formatting. Received mail is not changed."
        checked={s.compose.plainTextOnly}
        onChange={(v) => void save({ compose: { plainTextOnly: v } })}
      />
    </SectionPage>
  );
}
