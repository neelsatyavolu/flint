import { useState } from "react";
import { ArrowDown, ArrowUp, Plus } from "lucide-react";
import type { Rule } from "@flint/core";
import { flint } from "../../../lib/api";
import { useFlintQuery } from "../../../lib/hooks";
import { pluralize } from "../../../lib/format";
import { Button, IconButton, Toggle, useToast } from "../../../ui";
import { SectionPage } from "../fields";
import { RuleEditor } from "../rules/RuleEditor";
import { newRule, reorder, summarizeRule, type RuleDraft } from "../rules/ruleValidation";
import { errorText, useAccounts } from "../useAccounts";
import styles from "../settings.module.css";

export function RulesSection() {
  const toast = useToast();
  const { accounts } = useAccounts();
  const rules = useFlintQuery((api) => api.listRules(), [], { mail: false });
  const [editing, setEditing] = useState<RuleDraft | null>(null);
  const [applying, setApplying] = useState(false);
  const list = [...(rules.data ?? [])].sort((a, b) => a.sortOrder - b.sortOrder);

  const fail = (err: unknown, fallback: string) => toast.show({ message: errorText(err, fallback), level: "error" });

  const save = async (rule: RuleDraft) => {
    try {
      await flint.saveRule(rule);
      rules.refetch();
      setEditing(null);
    } catch (err) {
      fail(err, "Couldn't save the rule. Try again.");
    }
  };
  const toggle = async (r: Rule, enabled: boolean) => {
    try {
      await flint.saveRule({ ...r, enabled });
      rules.refetch();
    } catch (err) {
      fail(err, "Couldn't update the rule. Try again.");
    }
  };
  const move = async (r: Rule, dir: -1 | 1) => {
    const swap = reorder(list, r.id, dir);
    if (!swap) return;
    try {
      await Promise.all(swap.map((x) => flint.saveRule(x)));
      rules.refetch();
    } catch (err) {
      fail(err, "Couldn't reorder the rules. Try again.");
    }
  };
  const remove = async (id: number) => {
    try {
      await flint.deleteRule(id);
      rules.refetch();
      setEditing(null);
    } catch (err) {
      fail(err, "Couldn't delete the rule. Try again.");
    }
  };
  const applyAll = async () => {
    setApplying(true);
    try {
      const { changed } = await flint.applyRules();
      toast.show({ message: changed === 0 ? "No existing mail matched" : `Updated ${pluralize(changed, "thread")}` });
    } catch (err) {
      fail(err, "Couldn't apply the rules. Try again.");
    } finally {
      setApplying(false);
    }
  };

  if (editing) {
    return (
      <SectionPage title={editing.id === undefined ? "New rule" : "Edit rule"}>
        <div className={styles.padTop}>
          <RuleEditor initial={editing} accounts={accounts ?? []} onSave={save} onCancel={() => setEditing(null)} onDelete={editing.id === undefined ? undefined : () => remove(editing.id!)} />
        </div>
      </SectionPage>
    );
  }

  return (
    <SectionPage title="Rules" description="Sort incoming mail. Rules run top to bottom as mail arrives.">
      <div className={styles.listActions}>
        <Button variant="ghost" disabled={applying || list.length === 0} onClick={() => void applyAll()}>{applying ? "Applying…" : "Apply to existing mail"}</Button>
        <Button variant="primary" icon={<Plus size={14} strokeWidth={1.5} />} onClick={() => setEditing(newRule(list.length === 0 ? 0 : Math.max(...list.map((r) => r.sortOrder)) + 1))}>New rule</Button>
      </div>
      <div className={styles.listTop}>
        {list.map((r, i) => (
          <div key={r.id} className={styles.row}>
            <Toggle checked={r.enabled} label={`Enable ${r.name}`} onChange={(v) => void toggle(r, v)} />
            <button type="button" className={`${styles.rowGrow} ${styles.bareBtn}`} onClick={() => setEditing(r)}>
              <span className={`${styles.rowTitle} ${styles.block}`}>{r.name}</span>
              <span className={`${styles.rowSub} ${styles.mono} ${styles.block}`}>{summarizeRule(r)}</span>
            </button>
            <IconButton label="Move up" size={28} disabled={i === 0} onClick={() => void move(r, -1)}><ArrowUp size={14} strokeWidth={1.5} /></IconButton>
            <IconButton label="Move down" size={28} disabled={i === list.length - 1} onClick={() => void move(r, 1)}><ArrowDown size={14} strokeWidth={1.5} /></IconButton>
          </div>
        ))}
        {!rules.loading && list.length === 0 ? <p className={styles.empty}>No rules yet. A rule can archive, pin, mute or file mail from senders you pick.</p> : null}
      </div>
    </SectionPage>
  );
}
