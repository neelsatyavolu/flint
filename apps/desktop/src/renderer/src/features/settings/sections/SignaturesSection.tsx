import { useState } from "react";
import { Download } from "lucide-react";
import type { Account, Signature } from "@flint/core";
import { flint } from "../../../lib/api";
import { useFlintQuery } from "../../../lib/hooks";
import { Button, Checkbox, Input, MailFrame, SectionLabel, useToast } from "../../../ui";
import { RichEditor } from "../editor/RichEditor";
import { sanitizeHtml } from "../editor/richText";
import { ChoiceSelect, SectionPage } from "../fields";
import { ListEditor } from "../ListEditor";
import { SparkImportSheet } from "../spark/SparkImportSheet";
import { mapAfterDelete, planSignatureSave } from "../signatureDefaults";
import { useSettingsStore } from "../settingsStore";
import { useAccounts, errorText } from "../useAccounts";
import styles from "../settings.module.css";

type Draft = Omit<Signature, "id"> & { id?: number };
const blank = (): Draft => ({ name: "", html: "", accountId: null, defaultNew: false, defaultReply: false });

export function SignaturesSection() {
  const toast = useToast();
  const { settings, save } = useSettingsStore();
  const { accounts } = useAccounts();
  const sigs = useFlintQuery((api) => api.listSignatures(), [], { mail: false });
  const [sel, setSel] = useState<number | "new" | null>(null);
  const [importing, setImporting] = useState(false);
  const list = sigs.data ?? [];
  // The first signature is open by default so the editor pane is never an empty box.
  const active = sel ?? list[0]?.id ?? null;
  const current: Draft | null = active === "new" ? blank() : (list.find((s) => s.id === active) ?? null);
  const accountName = (id: string | null) => (id ? (accounts?.find((a) => a.id === id)?.email ?? "Unknown account") : "All accounts");

  const onSave = async (draft: Draft) => {
    try {
      const saved = await flint.saveSignature({ ...draft, html: sanitizeHtml(draft.html) });
      const plan = planSignatureSave(list, saved, settings.compose.defaultSignatureByAccount);
      await Promise.all(plan.demote.map((d) => flint.saveSignature(d)));
      if (plan.map) await save({ compose: { defaultSignatureByAccount: plan.map } });
      sigs.refetch();
      setSel(saved.id);
      toast.show({ message: "Signature saved" });
    } catch (err) {
      toast.show({ message: errorText(err, "Couldn't save the signature. Try again."), level: "error" });
    }
  };

  const onDelete = async (id: number) => {
    try {
      await flint.deleteSignature(id);
      const map = mapAfterDelete(settings.compose.defaultSignatureByAccount, id);
      if (map) await save({ compose: { defaultSignatureByAccount: map } });
      sigs.refetch();
      setSel(null);
    } catch (err) {
      toast.show({ message: errorText(err, "Couldn't delete the signature. Try again."), level: "error" });
    }
  };

  return (
    <SectionPage title="Signatures" description="Add a signature to new mail and replies, per account.">
      <Button variant="ghost" size="sm" icon={<Download size={14} strokeWidth={1.5} />} onClick={() => setImporting(true)}>Import from Spark</Button>
      <ListEditor
        items={list}
        selectedId={active}
        onSelect={setSel}
        onNew={() => setSel("new")}
        newLabel="New signature"
        empty="No signatures yet."
        render={(s) => ({ title: s.name || "Untitled", sub: `${accountName(s.accountId)}${s.defaultNew ? " · new" : ""}${s.defaultReply ? " · replies" : ""}` })}
      >
        {current ? (
          <SignatureEditor key={active === "new" ? "new" : current.id} initial={current} accounts={accounts ?? []} onSave={onSave} onDelete={onDelete} />
        ) : (
          <p className={styles.muted}>Select a signature to edit it, or create a new one.</p>
        )}
      </ListEditor>
      <SparkImportSheet
        open={importing}
        onClose={() => setImporting(false)}
        onImported={(saved) => {
          sigs.refetch();
          if (saved[0]) setSel(saved[0].id);
        }}
      />
    </SectionPage>
  );
}

export function SignatureEditor({ initial, accounts, onSave, onDelete }: { initial: Draft; accounts: Account[]; onSave: (d: Draft) => Promise<void>; onDelete: (id: number) => Promise<void> }) {
  const [draft, setDraft] = useState<Draft>(initial);
  const [busy, setBusy] = useState(false);
  const patch = (p: Partial<Draft>) => setDraft((d) => ({ ...d, ...p }));
  const canSave = draft.name.trim() !== "" && draft.html.trim() !== "";

  return (
    <div className={styles.fields}>
      <label className={styles.field}>
        <span className={`t-label ${styles.fieldLabel}`}>Name</span>
        <Input value={draft.name} onChange={(e) => patch({ name: e.target.value })} placeholder="Work" />
      </label>
      <div className={styles.field}>
        <span className={`t-label ${styles.fieldLabel}`}>Account</span>
        <ChoiceSelect label="Account" value={draft.accountId ?? ""} choices={[{ value: "", label: "All accounts" }, ...accounts.map((a) => ({ value: a.id, label: a.email }))]} onChange={(v) => patch({ accountId: v === "" ? null : v })} />
      </div>
      <div className={styles.inline}>
        <Checkbox label="Default for new mail" checked={draft.defaultNew} onChange={(v) => patch({ defaultNew: v })} />
        <Checkbox label="Default for replies" checked={draft.defaultReply} onChange={(v) => patch({ defaultReply: v })} />
      </div>
      <RichEditor label="Signature" initial={initial.html} onChange={(html) => patch({ html })} />
      <div>
        <SectionLabel className={styles.groupLabel}>Preview</SectionLabel>
        <div className={styles.preview}><MailFrame html={draft.html || "<p></p>"} allowRemoteImages title="Signature preview" padding={12} /></div>
      </div>
      <div className={styles.inline}>
        <Button variant="primary" disabled={!canSave || busy} onClick={() => { setBusy(true); void onSave(draft).finally(() => setBusy(false)); }}>Save</Button>
        {draft.id !== undefined ? <Button variant="danger" onClick={() => void onDelete(draft.id!)}>Delete</Button> : null}
      </div>
    </div>
  );
}
