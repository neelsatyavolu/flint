import { useEffect, useId, useRef, useState, type ClipboardEvent, type JSX, type KeyboardEvent, type ReactNode } from "react";
import { X } from "lucide-react";
import clsx from "clsx";
import type { Address, Contact } from "@flint/core";
import { flint } from "../../lib/api";
import { Avatar } from "../../ui/Avatar";
import { mergeAddresses, parseAddressList, removeAddress } from "./recipients";
import styles from "./RecipientField.module.css";

type Props = {
  label: string;
  value: Address[];
  onChange: (next: Address[]) => void;
  placeholder?: string;
  autoFocus?: boolean;
  /** Controls at the right edge, such as the Cc and Bcc reveal buttons. */
  trailing?: ReactNode;
  invalid?: boolean;
  compact?: boolean;
};

const SUGGEST_DELAY_MS = 120;

export function RecipientField({ label, value, onChange, placeholder, autoFocus, trailing, invalid, compact }: Props): JSX.Element {
  const [text, setText] = useState("");
  const [suggestions, setSuggestions] = useState<Contact[]>([]);
  const [active, setActive] = useState(0);
  const [bad, setBad] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const valueRef = useRef(value);
  valueRef.current = value;

  useEffect(() => {
    const prefix = text.trim();
    if (prefix.length < 1 || /[<>]/.test(prefix)) {
      setSuggestions([]);
      return;
    }
    let alive = true;
    const t = setTimeout(() => {
      flint.suggestContacts(prefix, 6).then(
        (list) => {
          if (!alive) return;
          const have = new Set(valueRef.current.map((a) => a.address.toLowerCase()));
          setSuggestions(list.filter((c) => !have.has(c.email.toLowerCase())));
          setActive(0);
        },
        () => alive && setSuggestions([]),
      );
    }, SUGGEST_DELAY_MS);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [text]);

  const add = (addresses: Address[]) => {
    if (addresses.length) onChange(mergeAddresses(valueRef.current, addresses));
  };

  /** Turns whatever is typed into chips. Returns true when the text was fully consumed. */
  const commit = (raw = text): boolean => {
    if (raw.trim() === "") return true;
    const { addresses, invalid: rest } = parseAddressList(raw);
    add(addresses);
    setText(rest.join(", "));
    setBad(rest.length > 0);
    setSuggestions([]);
    return rest.length === 0;
  };

  const pickSuggestion = (c: Contact) => {
    add([{ name: c.name, address: c.email }]);
    setText("");
    setSuggestions([]);
    setBad(false);
    inputRef.current?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    const open = suggestions.length > 0;
    if (e.key === "ArrowDown" && open) {
      e.preventDefault();
      setActive((i) => (i + 1) % suggestions.length);
    } else if (e.key === "ArrowUp" && open) {
      e.preventDefault();
      setActive((i) => (i - 1 + suggestions.length) % suggestions.length);
    } else if ((e.key === "Enter" || e.key === "Tab") && open && text.trim() !== "" && !/@.+\./.test(text)) {
      e.preventDefault();
      pickSuggestion(suggestions[active]!);
    } else if (e.key === "Enter" || e.key === "," || e.key === ";" || (e.key === "Tab" && text.trim() !== "")) {
      if (text.trim() === "" && e.key !== "," && e.key !== ";") return;
      e.preventDefault();
      commit();
    } else if (e.key === "Backspace" && text === "" && value.length > 0) {
      e.preventDefault();
      onChange(value.slice(0, -1));
    } else if (e.key === "Escape" && open) {
      e.stopPropagation();
      setSuggestions([]);
    }
  };

  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const pasted = e.clipboardData.getData("text");
    if (!/[,;\n<]/.test(pasted)) return;
    const { addresses, invalid: rest } = parseAddressList(pasted);
    if (addresses.length === 0) return;
    e.preventDefault();
    add(addresses);
    setText(rest.join(", "));
    setBad(rest.length > 0);
  };

  const listOpen = suggestions.length > 0;
  return (
    <div className={clsx(styles.row, compact && styles.compact, (invalid || bad) && styles.invalid)} onClick={() => inputRef.current?.focus()}>
      <span className={clsx(styles.label, "t-data")}>{label}</span>
      <div className={styles.chips}>
        {value.map((a) => (
          <span key={a.address} className={styles.chip} title={a.address}>
            <Avatar address={a.address} name={a.name} size={16} />
            <span className={styles.chipText}>{a.name || a.address}</span>
            <button type="button" className={styles.remove} aria-label={`Remove ${a.name || a.address}`} onClick={(e) => { e.stopPropagation(); onChange(removeAddress(value, a.address)); }}>
              <X size={12} strokeWidth={1.5} />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          className={styles.input}
          value={text}
          autoFocus={autoFocus}
          placeholder={value.length === 0 ? placeholder : undefined}
          aria-label={label}
          aria-invalid={bad || invalid || undefined}
          role="combobox"
          aria-expanded={listOpen}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={listOpen ? `${listId}-${active}` : undefined}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => { setText(e.target.value); setBad(false); }}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          onBlur={() => { if (text.trim() !== "") commit(); setSuggestions([]); }}
        />
        {listOpen ? (
          <ul id={listId} role="listbox" className={styles.list}>
            {suggestions.map((c, i) => (
              <li
                key={c.email}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                className={clsx(styles.option, i === active && styles.optionActive)}
                onMouseDown={(e) => { e.preventDefault(); pickSuggestion(c); }}
                onMouseMove={() => setActive(i)}
              >
                <Avatar address={c.email} name={c.name} size={24} />
                <span className={styles.optionName}>{c.name || c.email}</span>
                {c.name ? <span className={clsx(styles.optionEmail, "t-data")}>{c.email}</span> : null}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      {trailing ? <div className={styles.trailing} onClick={(e) => e.stopPropagation()}>{trailing}</div> : null}
    </div>
  );
}
