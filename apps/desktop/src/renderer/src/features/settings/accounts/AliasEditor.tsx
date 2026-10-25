import { useState } from "react";
import { X } from "lucide-react";
import { Button, IconButton, Input } from "../../../ui";
import styles from "../settings.module.css";
import { checkAlias } from "./accountStatus";

/** Chips for the addresses an account can send from, plus a field to add one. */
export function AliasEditor({ own, aliases, onChange }: { own: string; aliases: string[]; onChange: (next: string[]) => void }) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);

  const add = () => {
    if (text.trim() === "") return;
    const c = checkAlias(text, own, aliases);
    if (!c.ok) return setError(c.message);
    setError(null);
    setText("");
    onChange([...aliases, c.value]);
  };

  return (
    <div className={styles.stack}>
      {aliases.length > 0 ? (
        <div className={styles.chips}>
          {aliases.map((a) => (
            <span key={a} className={styles.chip}>
              {a}
              <IconButton label={`Remove ${a}`} size={24} onClick={() => onChange(aliases.filter((x) => x !== a))}><X size={12} strokeWidth={1.5} /></IconButton>
            </span>
          ))}
        </div>
      ) : null}
      <div className={styles.inline}>
        <Input
          aria-label="Add an alias"
          className={styles.wide}
          value={text}
          invalid={error !== null}
          placeholder="alias@example.com"
          onChange={(e) => { setText(e.target.value); setError(null); }}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
        />
        <Button variant="ghost" onClick={add}>Add alias</Button>
      </div>
      {error ? <p role="alert" className={styles.err}>{error}</p> : null}
    </div>
  );
}
