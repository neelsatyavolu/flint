import { useState } from "react";
import type { Template } from "@flint/core";
import { flint } from "../../../lib/api";
import { useFlintQuery } from "../../../lib/hooks";
import { Button, Input, useToast } from "../../../ui";
import { RichEditor } from "../editor/RichEditor";
import { sanitizeHtml } from "../editor/richText";
import { SectionPage } from "../fields";
import { ListEditor } from "../ListEditor";
import { errorText } from "../useAccounts";
import styles from "../settings.module.css";

type Draft = Omit<Template, "id"> & { id?: number };

export function TemplatesSection() {
  const toast = useToast();
  const templates = useFlintQuery((api) => api.listTemplates(), [], { mail: false });
  const [sel, setSel] = useState<number | "new" | null>(null);
  const list = templates.data ?? [];
  const current: Draft | null = sel === "new" ? { name: "", subject: "", html: "" } : (list.find((t) => t.id === sel) ?? null);

  const onSave = async (d: Draft) => {
    try {
      const saved = await flint.saveTemplate({ ...d, html: sanitizeHtml(d.html) });
      templates.refetch();
      setSel(saved.id);
      toast.show({ message: "Template saved" });
    } catch (err) {
      toast.show({ message: errorText(err, "Couldn't save the template. Try again."), level: "error" });
    }
  };
  const onDelete = async (id: number) => {
    try {
      await flint.deleteTemplate(id);
      templates.refetch();
      setSel(null);
    } catch (err) {
      toast.show({ message: errorText(err, "Couldn't delete the template. Try again."), level: "error" });
    }
  };

  return (
    <SectionPage title="Templates" description="Reusable subjects and bodies. Insert one from the composer.">
      <ListEditor items={list} selectedId={sel} onSelect={setSel} onNew={() => setSel("new")} newLabel="New template" empty="No templates yet." render={(t) => ({ title: t.name || "Untitled", sub: t.subject })}>
        {current ? <TemplateEditor key={sel === "new" ? "new" : current.id} initial={current} onSave={onSave} onDelete={onDelete} /> : <p className={styles.muted}>Select a template to edit it, or create a new one.</p>}
      </ListEditor>
    </SectionPage>
  );
}

export function TemplateEditor({ initial, onSave, onDelete }: { initial: Draft; onSave: (d: Draft) => Promise<void>; onDelete: (id: number) => Promise<void> }) {
  const [draft, setDraft] = useState<Draft>(initial);
  const [busy, setBusy] = useState(false);
  const canSave = draft.name.trim() !== "" && draft.html.trim() !== "";
  return (
    <div className={styles.fields}>
      <label className={styles.field}>
        <span className={`t-label ${styles.fieldLabel}`}>Name</span>
        <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Intro call" />
      </label>
      <label className={styles.field}>
        <span className={`t-label ${styles.fieldLabel}`}>Subject</span>
        <Input value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} placeholder="Optional" />
      </label>
      <RichEditor label="Template body" initial={initial.html} images={false} onChange={(html) => setDraft((d) => ({ ...d, html }))} />
      <div className={styles.inline}>
        <Button variant="primary" disabled={!canSave || busy} onClick={() => { setBusy(true); void onSave(draft).finally(() => setBusy(false)); }}>Save</Button>
        {draft.id !== undefined ? <Button variant="danger" onClick={() => void onDelete(draft.id!)}>Delete</Button> : null}
      </div>
    </div>
  );
}
