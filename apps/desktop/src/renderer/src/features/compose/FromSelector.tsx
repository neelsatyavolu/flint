import type { JSX } from "react";
import { ChevronDown } from "lucide-react";
import { Avatar } from "../../ui/Avatar";
import { Menu, type MenuItem } from "../../ui/Menu";
import type { FromOption } from "./useComposerSession";
import styles from "./FromSelector.module.css";

type Props = { value: string; options: FromOption[]; onChange: (option: FromOption) => void; /** Shows that account's picture next to the address. */ accountId?: string };

/** Address over name, in small caps. Opens a menu of accounts and aliases. */
export function FromSelector({ value, options, onChange, accountId }: Props): JSX.Element {
  const current = options.find((o) => o.address === value);
  const items: MenuItem[] = [
    { type: "label", label: "Send from" },
    ...options.map((o) => ({
      id: o.address,
      label: o.alias ? `${o.address} (alias)` : o.address,
      checked: o.address === value,
      onSelect: () => onChange(o),
    })),
  ];
  return (
    <Menu
      items={items}
      placement="bottom-end"
      trigger={
        <button type="button" className={styles.from} aria-label={`Send from ${value}`} disabled={options.length === 0}>
          {accountId ? <Avatar address={value} name={current?.name} accountId={accountId} size={24} /> : null}
          <span className={styles.text}>
            <span className={`t-data ${styles.address}`}>{value}</span>
            <span className={`t-label ${styles.name}`}>{current?.name ?? ""}</span>
          </span>
          {options.length > 1 ? <ChevronDown size={14} strokeWidth={1.5} /> : null}
        </button>
      }
    />
  );
}
