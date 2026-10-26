import { useState } from "react";
import { Download, Type } from "lucide-react";
import type { Account, Signature } from "@flint/core";
import { flint } from "../../../lib/api";
import { useFlintQuery } from "../../../lib/hooks";
import { Button, Checkbox, Input, MailFrame, SectionLabel, useToast } from "../../../ui";
import { RichEditor } from "../editor/RichEditor";
import { applyFlintFont, hasCustomFont, sanitizeHtml } from "../editor/richText";
import { ChoiceSelect, SectionPage } from "../fields";
import { ListEditor } from "../ListEditor";
import { SparkImportSheet } from "../spark/SparkImportSheet";
import { defaultPatch, needsDefaultHint, pickerValue, withAccount, type DefaultKind, type PickerValue } from "../signatureDefaults";
import { useSettingsStore } from "../settingsStore";
import { useAccounts, errorText } from "../useAccounts";
import styles from "../settings.module.css";

type Draft = Omit<Signature, "id"> & { id?: number };
const blank = (): Draft => ({ name: "", html: "", accountIds: [], defaultNew: false, defaultReply: false });

export function SignaturesSection() {
  const toast = useToast();
  const { accounts } = useAccounts();
  const sigs = useFlintQuery((api) => api.listSignatures(), [], { mail: false });
  const [sel, setSel] = useState<number | "new" | null>(null);
  const [importing, setImporting] = useState(false);
  const list = sigs.data ?? [];
  // The first signature is open by default so the editor pane is never an empty box.
  const active = sel ?? list[0]?.id ?? null;
  const current: Draft | null = active === "new" ? blank() : (list.find((s) => s.id === active) ?? null);
  const scopeLabel = (ids: string[]) => (ids.length === 0 ? "All accounts" : ids.length === 1 ? (accounts?.find((a) => a.id === ids[0])?.email ?? "Unknown account") : `${ids.length} accounts`);

  const onSave = async (draft: Draft) => {
    try {
      const saved = await flint.saveSignature({ ...draft, html: sanitizeHtml(draft.html) });
      sigs.refetch();
      setSel(saved.id);
      toast.show({ message: "Signature saved" });
    } catch (err) {
      toast.show({ message: errorText(err, "Couldn't save the signature. Try again."), level: "error" });
    }
  };

  const withFonts = list.filter((x) => hasCustomFont(x.html));
  const onFixAllFonts = async () => {
    try {
      await Promise.all(withFonts.map((x) => flint.saveSignature({ ...x, html: applyFlintFont(x.html) })));
      sigs.refetch();
      toast.show({ message: withFonts.length === 1 ? "Signature now uses Flint's font" : `${withFonts.length} signatures now use Flint's font` });
    } catch (err) {
      toast.show({ message: errorText(err, "Couldn't update the signatures. Try again."), level: "error" });
    }
  };

  const onDelete = async (id: number) => {
    try {
      // A default that pointed at this signature stops applying by itself; nothing is written as "None" on the user's behalf.
      await flint.deleteSignature(id);
      sigs.refetch();
      setSel(null);
    } catch (err) {
      toast.show({ message: errorText(err, "Couldn't delete the signature. Try again."), level: "error" });
    }
  };

  return (
    <SectionPage title="Signatures" description="Add a signature to new mail and replies, per account.">
      <div className={styles.inline}>
        <Button variant="ghost" size="sm" icon={<Download size={14} strokeWidth={1.5} />} onClick={() => setImporting(true)}>Import from Spark</Button>
        {withFonts.length > 0 ? (
          <Button variant="ghost" size="sm" icon={<Type size={14} strokeWidth={1.5} />} onClick={() => void onFixAllFonts()}>
            {withFonts.length === 1 ? "Use Flint's font" : `Use Flint's font on ${withFonts.length} signatures`}
          </Button>
        ) : null}
      </div>
      <SignatureDefaults accounts={accounts ?? []} signatures={list} onImport={() => setImporting(true)} onSignatureChanged={() => sigs.refetch()} />
      <ListEditor
        items={list}
        selectedId={active}
        onSelect={setSel}
        onNew={() => setSel("new")}
        newLabel="New signature"
        empty="No signatures yet."
        render={(s) => ({ title: s.name || "Untitled", sub: scopeLabel(s.accountIds) })}
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

const NONE = "none";
const UNSET = "unset";

function toChoice(v: PickerValue): string {
  return v === null ? NONE : v === "unset" ? UNSET : String(v);
}

/** Per account: which signature new mail and replies start with. None is a choice of its own. */
function SignatureDefaults({ accounts, signatures, onImport, onSignatureChanged }: { accounts: Account[]; signatures: Signature[]; onImport: () => void; onSignatureChanged: () => void }) {
  const { settings, save } = useSettingsStore();
  const toast = useToast();

  /** Picking a signature the account can't use yet adds the account to it first, so the composer offers it too. */
  const choose = async (kind: DefaultKind, accountId: string, id: number | null) => {
    const sig = id === null ? undefined : signatures.find((s) => s.id === id);
    const widened = sig ? withAccount(sig, accountId) : null;
    if (widened) {
      try {
        await flint.saveSignature(widened);
        onSignatureChanged();
      } catch (err) {
        toast.show({ message: errorText(err, "Couldn't add the account to that signature. Try again."), level: "error" });
        return;
      }
    }
    await save(defaultPatch(kind, accountId, id));
  };
  const enabled = accounts.filter((a) => a.enabled);
  if (enabled.length === 0 || signatures.length === 0) return null;

  const picker = (account: Account, kind: DefaultKind, label: string) => {
    const value = pickerValue(signatures, settings.compose, account.id, kind);
    const choices = [
      ...(value === "unset" ? [{ value: UNSET, label: "Not chosen" }] : []),
      { value: NONE, label: "None" },
      ...signatures.map((s) => ({ value: String(s.id), label: s.name || "Untitled" })),
    ];
    return (
      <label className={styles.defaultPick}>
        <span className={`t-label ${styles.fieldLabel}`}>{label}</span>
        <ChoiceSelect
          label={`${label} signature for ${account.email}`}
          value={toChoice(value)}
          choices={choices}
          onChange={(v) => {
            if (v !== UNSET) void choose(kind, account.id, v === NONE ? null : Number(v));
          }}
        />
      </label>
    );
  };

  return (
    <div className={styles.defaults}>
      <SectionLabel className={styles.groupLabel}>Default signature</SectionLabel>
      {enabled.map((account) => (
        <div key={account.id} className={styles.defaultRow}>
          <div className={styles.rowGrow}>
            <div className={styles.rowTitle}>{account.email}</div>
            {needsDefaultHint(signatures, settings.compose, account.id) ? (
              <div className={styles.muted}>
                No default yet. Messages from this account go out without a signature until you choose one.{" "}
                <button type="button" className={styles.linkButton} onClick={onImport}>Use Spark's defaults</button>
              </div>
            ) : null}
          </div>
          {picker(account, "new", "New mail")}
          {picker(account, "reply", "Replies")}
        </div>
      ))}
    </div>
  );
}

export function SignatureEditor({ initial, accounts, onSave, onDelete }: { initial: Draft; accounts: Account[]; onSave: (d: Draft) => Promise<void>; onDelete: (id: number) => Promise<void> }) {
  const [draft, setDraft] = useState<Draft>(initial);
  const [busy, setBusy] = useState(false);
  // Bumped when the font fix rewrites the HTML, so the editor reloads it.
  const [editorKey, setEditorKey] = useState(0);
  const patch = (p: Partial<Draft>) => setDraft((d) => ({ ...d, ...p }));
  const canSave = draft.name.trim() !== "" && draft.html.trim() !== "";

  return (
    <div className={styles.fields}>
      <label className={styles.field}>
        <span className={`t-label ${styles.fieldLabel}`}>Name</span>
        <Input value={draft.name} onChange={(e) => patch({ name: e.target.value })} placeholder="Work" />
      </label>
      <div className={styles.field} role="group" aria-label="Use with">
        <span className={`t-label ${styles.fieldLabel}`}>Use with</span>
        <div className={styles.useWith}>
          <Checkbox label="All accounts" checked={draft.accountIds.length === 0} onChange={() => patch({ accountIds: [] })} />
          {accounts.map((a) => (
            <Checkbox
              key={a.id}
              label={a.email}
              checked={draft.accountIds.includes(a.id)}
              onChange={(on) => patch({ accountIds: on ? [...draft.accountIds, a.id] : draft.accountIds.filter((id) => id !== a.id) })}
            />
          ))}
        </div>
      </div>
      <RichEditor key={editorKey} label="Signature" initial={editorKey === 0 ? initial.html : draft.html} onChange={(html) => patch({ html })} />
      <div className={styles.inline}>
        <Button variant="ghost" size="sm" icon={<Type size={14} strokeWidth={1.5} />} disabled={!hasCustomFont(draft.html)} onClick={() => { patch({ html: applyFlintFont(draft.html) }); setEditorKey((k) => k + 1); }}>Use Flint's font</Button>
        <span className={styles.muted}>{hasCustomFont(draft.html) ? "Removes the font and size this signature brings, so it matches the rest of your message." : "This signature already uses the font of your message."}</span>
      </div>
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
