import { useState } from "react";
import { Plus, X } from "lucide-react";
import type { Account, Category, RuleAction, RuleCondition } from "@flint/core";
import { Button, IconButton, Input } from "../../../ui";
import { ChoiceSelect } from "../fields";
import styles from "../settings.module.css";
import {
  ACTION_LABELS, ACTION_TYPES, CATEGORY_LABELS, FIELD_LABELS, FIELDS, OP_LABELS, hasIssues, newAction, newCondition,
  opsFor, validateRule, withField, type RuleDraft,
} from "./ruleValidation";

const choose = <T extends string>(labels: Record<T, string>, keys: T[]) => keys.map((k) => ({ value: k, label: labels[k] }));

type Props = {
  initial: RuleDraft;
  accounts: Account[];
  onSave: (rule: RuleDraft) => Promise<void>;
  onDelete?: () => Promise<void>;
  onCancel: () => void;
};

export function RuleEditor({ initial, accounts, onSave, onDelete, onCancel }: Props) {
  const [rule, setRule] = useState<RuleDraft>(initial);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const issues = validateRule(rule);
  const show = tried;

  const setCond = (i: number, c: RuleCondition) => setRule((r) => ({ ...r, conditions: r.conditions.map((x, j) => (j === i ? c : x)) }));
  const setAct = (i: number, a: RuleAction) => setRule((r) => ({ ...r, actions: r.actions.map((x, j) => (j === i ? a : x)) }));

  const save = () => {
    setTried(true);
    if (hasIssues(issues)) return;
    setBusy(true);
    void onSave({ ...rule, name: rule.name.trim() }).finally(() => setBusy(false));
  };

  return (
    <div className={styles.fields}>
      <label className={styles.field}>
        <span className={`t-label ${styles.fieldLabel}`}>Name</span>
        <Input aria-label="Rule name" value={rule.name} invalid={show && issues.name !== null} placeholder="Receipts" onChange={(e) => setRule({ ...rule, name: e.target.value })} />
        {show && issues.name ? <span role="alert" className={styles.err}>{issues.name}</span> : null}
      </label>
      <div className={styles.inline}>
        <div className={styles.field}>
          <span className={`t-label ${styles.fieldLabel}`}>Account</span>
          <ChoiceSelect label="Account" value={rule.accountId ?? ""} choices={[{ value: "", label: "All accounts" }, ...accounts.map((a) => ({ value: a.id, label: a.email }))]} onChange={(v) => setRule({ ...rule, accountId: v === "" ? null : v })} />
        </div>
        <div className={styles.field}>
          <span className={`t-label ${styles.fieldLabel}`}>Match</span>
          <ChoiceSelect label="Match" value={rule.match} choices={[{ value: "all", label: "All conditions" }, { value: "any", label: "Any condition" }]} onChange={(match) => setRule({ ...rule, match })} />
        </div>
      </div>

      <div className={styles.field}>
        <span className={`t-label ${styles.fieldLabel}`}>If</span>
        {rule.conditions.map((c, i) => (
          <div key={i}>
            <div className={styles.condRow}>
              <ChoiceSelect label={`Condition ${i + 1} field`} value={c.field} choices={choose(FIELD_LABELS, FIELDS)} onChange={(f) => setCond(i, withField(c, f))} />
              <ChoiceSelect label={`Condition ${i + 1} test`} value={c.op} choices={choose(OP_LABELS, opsFor(c.field))} onChange={(op) => setCond(i, { ...c, op })} />
              {c.op === "is_true" ? <span /> : <Input aria-label={`Condition ${i + 1} value`} value={c.value} invalid={show && issues.conditions[i] !== null} onChange={(e) => setCond(i, { ...c, value: e.target.value })} />}
              <IconButton label="Remove condition" size={28} onClick={() => setRule((r) => ({ ...r, conditions: r.conditions.filter((_, j) => j !== i) }))}><X size={14} strokeWidth={1.5} /></IconButton>
            </div>
            {show && issues.conditions[i] ? <span role="alert" className={styles.err}>{issues.conditions[i]}</span> : null}
          </div>
        ))}
        <div><Button variant="ghost" size="sm" icon={<Plus size={14} strokeWidth={1.5} />} onClick={() => setRule((r) => ({ ...r, conditions: [...r.conditions, newCondition()] }))}>Add condition</Button></div>
      </div>

      <div className={styles.field}>
        <span className={`t-label ${styles.fieldLabel}`}>Then</span>
        {rule.actions.map((a, i) => (
          <div key={i}>
            <div className={styles.actRow}>
              <ChoiceSelect label={`Action ${i + 1}`} value={a.type} choices={choose(ACTION_LABELS, ACTION_TYPES)} onChange={(t) => setAct(i, newAction(t))} />
              <ActionParam action={a} index={i} invalid={show && issues.actions[i] !== null} onChange={(next) => setAct(i, next)} />
              <IconButton label="Remove action" size={28} onClick={() => setRule((r) => ({ ...r, actions: r.actions.filter((_, j) => j !== i) }))}><X size={14} strokeWidth={1.5} /></IconButton>
            </div>
            {show && issues.actions[i] ? <span role="alert" className={styles.err}>{issues.actions[i]}</span> : null}
          </div>
        ))}
        <div><Button variant="ghost" size="sm" icon={<Plus size={14} strokeWidth={1.5} />} onClick={() => setRule((r) => ({ ...r, actions: [...r.actions, newAction("archive")] }))}>Add action</Button></div>
      </div>

      {show && issues.general.map((g) => <p key={g} role="alert" className={styles.err}>{g}</p>)}
      <div className={styles.inline}>
        <Button variant="primary" disabled={busy} onClick={save}>Save rule</Button>
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        {onDelete ? <Button variant="danger" onClick={() => void onDelete()}>Delete</Button> : null}
      </div>
    </div>
  );
}

function ActionParam({ action, index, invalid, onChange }: { action: RuleAction; index: number; invalid: boolean; onChange: (a: RuleAction) => void }) {
  if (action.type === "move") {
    return <Input aria-label={`Action ${index + 1} folder`} placeholder="Folder name" value={action.folderPath} invalid={invalid} onChange={(e) => onChange({ type: "move", folderPath: e.target.value })} />;
  }
  if (action.type === "category") {
    return <ChoiceSelect<Category> label={`Action ${index + 1} category`} value={action.category} choices={choose(CATEGORY_LABELS, ["people", "notifications", "newsletters"])} onChange={(category) => onChange({ type: "category", category })} />;
  }
  if (action.type === "notify") {
    return <ChoiceSelect label={`Action ${index + 1} notification`} value={action.enabled ? "on" : "off"} choices={[{ value: "on", label: "Notify me" }, { value: "off", label: "Stay quiet" }]} onChange={(v) => onChange({ type: "notify", enabled: v === "on" })} />;
  }
  return <span />;
}
