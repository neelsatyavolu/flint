import { useState } from "react";
import { Archive, Bell, Clock, Folder, MoreHorizontal, Pin, Plus, Send, Sparkles, Trash2 } from "lucide-react";
import {
  Avatar, Badge, Button, Checkbox, CountChip, DateTimePicker, Dialog, Divider, EmptyState, FlintMark, IconButton, Input, Kbd, MailFrame, Menu,
  Popover, ResizeHandle, SectionLabel, SegmentedControl, Select, SettingsRow, Sheet, SkeletonRows, Tabs, TextArea, Toggle, Tooltip, useToast,
  usePersistedSize, type MenuItem,
} from "..";
import { formatFileSize, formatListTime } from "../../lib/format";
import { formatPresetTime } from "../../lib/time";
import styles from "./Gallery.module.css";

const PEOPLE = [
  ["Carla Mendes", "carla@brightfield.studio"], ["Rodney Okafor", "rodney@brightfield.studio"], ["Priya Raman", "priya.raman@northwind.dev"],
  ["Tomas Lindqvist", "tomas@northwind.dev"], ["Mei-Ling Zhou", "meiling@halcyon-type.co"], ["Daniel Achterberg", "daniel@lumen-labs.io"],
  ["Sofia Bianchi", "sofia@northwind.dev"], ["Hiro Tanabe", "hiro@studio-orbit.com"],
] as const;

const TOKENS = ["--plane-0", "--plane-1", "--plane-2", "--plane-3", "--fg", "--accent", "--accent-soft", "--danger", "--ok", "--warn"];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className={styles.section}>
      <SectionLabel className={styles.head}>{title}</SectionLabel>
      {children}
    </section>
  );
}

const MAIL_HTML = `<p>Hi Alex,</p><p>Countersigned copy is attached. Please file it and send the kickoff invite for Monday.</p><p><a href="https://example.com">Open the shared folder</a></p>`;

export function GalleryPanel({ theme, title }: { theme: "dark" | "light"; title: string }) {
  const toast = useToast();
  const [on, setOn] = useState(true);
  const [checked, setChecked] = useState(true);
  const [tab, setTab] = useState<"all" | "unread">("all");
  const [seg, setSeg] = useState<"focused" | "all">("focused");
  const [dialog, setDialog] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [width, setWidth] = usePersistedSize(`gallery-${theme}`, 160, 80, 320);
  const [picked, setPicked] = useState<number | null>(null);

  const items: MenuItem[] = [
    { id: "archive", label: "Archive", icon: <Archive size={16} strokeWidth={1.5} />, shortcut: "e", onSelect: () => toast.show({ message: "Archived", action: { label: "Undo", onClick: () => undefined } }) },
    { id: "pin", label: "Pin", icon: <Pin size={16} strokeWidth={1.5} />, shortcut: "s", onSelect: () => undefined },
    { id: "snooze", label: "Snooze", icon: <Clock size={16} strokeWidth={1.5} />, shortcut: "h", onSelect: () => undefined },
    { type: "separator" },
    { id: "disabled", label: "Move to Archive", disabled: true, onSelect: () => undefined },
    { id: "trash", label: "Move to Trash", icon: <Trash2 size={16} strokeWidth={1.5} />, shortcut: "#", danger: true, onSelect: () => undefined },
  ];
  const now = Date.now();

  return (
    <div data-theme={theme} className={styles.panel}>
      <h1 className="t-subject">{title}</h1>
      <p style={{ color: "var(--fg-3)", marginTop: 4 }}>Primitives for the Flint renderer. Geist for UI, Geist Mono for data, Newsreader for prose.</p>

      <Section title="Planes and tokens">
        <div className={styles.planes}>
          {["plane-0", "plane-1", "plane-2", "plane-3"].map((p) => (
            <div key={p} className={styles.plane} style={{ background: `var(--${p})`, color: "var(--fg-3)" }}><span className="t-data">{p}</span></div>
          ))}
        </div>
        <div className={styles.swatches} style={{ marginTop: 8 }}>
          {TOKENS.map((t) => <div key={t} className={styles.swatch} style={{ background: `var(${t})`, color: t === "--fg" ? "var(--plane-0)" : "var(--fg-2)" }}>{t.slice(2)}</div>)}
        </div>
      </Section>

      <Section title="Type">
        <div className={styles.col} style={{ maxWidth: "none", gap: 6 }}>
          <div className="t-subject">Freelancing Cycle 3</div>
          <div className="t-title">Inbox</div>
          <div className="t-strong">Carla Mendes, Rodney Okafor</div>
          <div className="t-body">Countersigned copy is attached. Please file it and send the kickoff invite.</div>
          <div className="t-data">3:49 PM · 12 unread · {formatFileSize(2_410_552)}</div>
          <div className="t-label">Today</div>
          <p className="t-prose">Rodney sent the countersigned agreement yesterday, and the kickoff is set for Monday.</p>
        </div>
      </Section>

      <Section title="Buttons">
        <div className={styles.row}>
          <Button variant="primary" icon={<Send size={14} strokeWidth={1.5} />}>Send</Button>
          <Button variant="secondary">Archive</Button>
          <Button variant="ghost">Cancel</Button>
          <Button variant="danger">Delete</Button>
          <Button variant="primary" size="sm">Small</Button>
          <Button disabled>Disabled</Button>
        </div>
        <div className={styles.row} style={{ marginTop: 12 }}>
          <IconButton label="Archive" shortcut="e"><Archive size={18} strokeWidth={1.5} /></IconButton>
          <IconButton label="Pin" shortcut="s" pressed><Pin size={18} strokeWidth={1.5} /></IconButton>
          <IconButton label="Ask AI" tone="accent"><Sparkles size={18} strokeWidth={1.5} /></IconButton>
          <IconButton label="Send" shortcut="mod+Enter" filled size={32}><Send size={16} strokeWidth={1.5} /></IconButton>
          <IconButton label="Quick archive" size={24}><Archive size={14} strokeWidth={1.5} /></IconButton>
          <Menu items={items} trigger={<IconButton label="More"><MoreHorizontal size={18} strokeWidth={1.5} /></IconButton>} />
          <Tooltip label="Undo" shortcut="mod+shift+z"><Button variant="ghost" size="sm">Hover me</Button></Tooltip>
        </div>
      </Section>

      <Section title="Inputs">
        <div className={styles.col}>
          <Input placeholder="Search mail" aria-label="Search" />
          <Input defaultValue="alex@northwind.dev" aria-label="Email" />
          <Input defaultValue="not-an-email" invalid aria-label="Invalid" />
          <TextArea placeholder="Writing style" aria-label="Writing style" defaultValue="Short, warm, direct." />
          <Select aria-label="Density" defaultValue="comfortable"><option value="comfortable">Comfortable</option><option value="compact">Compact</option></Select>
          <div className={styles.row}>
            <Toggle checked={on} onChange={setOn} label="Focused inbox" />
            <Toggle checked={false} onChange={() => undefined} label="Off" />
            <Checkbox checked={checked} onChange={setChecked} label="Block trackers" />
            <Checkbox checked={false} onChange={() => undefined} ariaLabel="Unchecked" />
            <Checkbox checked={false} indeterminate onChange={() => undefined} ariaLabel="Mixed" />
          </div>
        </div>
      </Section>

      <Section title="Avatars and data">
        <div className={styles.row}>
          {PEOPLE.map(([n, a]) => <Avatar key={a} name={n} address={a} size={32} />)}
        </div>
        <div className={styles.row} style={{ marginTop: 8 }}>
          <Avatar name="Carla Mendes" address="carla@brightfield.studio" size={24} />
          <Avatar name="Carla Mendes" address="carla@brightfield.studio" size={16} />
          <Avatar name="Broken image" address="logo@example.com" src="https://invalid.invalid/x.png" />
          <Badge>Draft</Badge><Badge tone="accent">New</Badge><Badge tone="ok">Opened</Badge><Badge tone="warn">Can't confirm</Badge><Badge tone="danger">Failed</Badge>
          <CountChip count={9} /><CountChip count={1204} />
          <Kbd combo="mod+k" /><Kbd combo="g i" /><Kbd>Esc</Kbd>
          <span className="t-data" style={{ color: "var(--fg-3)" }}>{formatListTime(now)} · {formatListTime(now - 2 * 86400_000)}</span>
        </div>
      </Section>

      <Section title="Navigation">
        <div className={styles.col} style={{ maxWidth: 420 }}>
          <Tabs label="Receipts" tabs={[{ id: "all", label: "All", count: 14 }, { id: "unread", label: "Unopened", count: 3 }]} value={tab} onChange={setTab} />
          <SegmentedControl label="Inbox mode" options={[{ value: "focused", label: "Focused" }, { value: "all", label: "All mail" }]} value={seg} onChange={setSeg} />
          <Divider />
        </div>
      </Section>

      <Section title="Settings rows">
        <div style={{ maxWidth: 560 }}>
          <SettingsRow icon={<Bell size={20} strokeWidth={1.5} />} title="Notifications" description="Only people. Newsletters and notifications stay quiet."><Toggle checked={on} onChange={setOn} label="Notifications" /></SettingsRow>
          <SettingsRow icon={<Folder size={20} strokeWidth={1.5} />} title="Density" description="Comfortable shows a preview line."><Select aria-label="Density row" defaultValue="comfortable"><option value="comfortable">Comfortable</option><option value="compact">Compact</option></Select></SettingsRow>
        </div>
      </Section>

      <Section title="Overlays">
        <div className={styles.row}>
          <DateTimePicker title="Snooze until" onPick={(at) => { setPicked(at); toast.show({ message: `Snoozed until ${formatPresetTime(at, now)}` }); }} trigger={<Button variant="ghost" icon={<Clock size={14} strokeWidth={1.5} />}>Snooze</Button>} />
          <Popover trigger={<Button variant="ghost">Popover</Button>}>
            <div style={{ padding: 12, width: 220 }}><div className="t-strong">Plane-3, hairline border</div><div style={{ color: "var(--fg-3)" }}>No shadow.</div></div>
          </Popover>
          <Button variant="ghost" onClick={() => setDialog(true)}>Dialog</Button>
          <Button variant="ghost" onClick={() => setSheet(true)}>Sheet</Button>
          <Button variant="ghost" icon={<Plus size={14} strokeWidth={1.5} />} onClick={() => toast.show({ message: "Archived", action: { label: "Undo", onClick: () => toast.show({ message: "Restored" }) } })}>Toast</Button>
          {picked ? <span className="t-data" style={{ color: "var(--fg-3)" }}>{formatPresetTime(picked, now)}</span> : null}
        </div>
        <Dialog open={dialog} onClose={() => setDialog(false)} title="Delete rule" footer={<><Button variant="ghost" onClick={() => setDialog(false)}>Cancel</Button><Button variant="danger" onClick={() => setDialog(false)}>Delete</Button></>}>
          <p>This rule stops sorting new mail. Mail already sorted stays where it is.</p>
        </Dialog>
        <Sheet open={sheet} onClose={() => setSheet(false)} title="Ask anything"><p>Side panel over the reader.</p></Sheet>
      </Section>

      <Section title="Skeleton, empty state, mark">
        <div className={styles.row} style={{ alignItems: "flex-start", gap: 24 }}>
          <div style={{ width: 320, border: "1px solid var(--line)", background: "var(--plane-1)" }}><SkeletonRows count={3} /></div>
          <div style={{ width: 220, border: "1px solid var(--line)" }}><EmptyState /></div>
          <FlintMark size={48} spark />
          <FlintMark size={32} />
        </div>
      </Section>

      <Section title="Resize handle">
        <div className={styles.resize}>
          <div className={styles.resizePane} style={{ width }}><span className="t-data">{width}px</span></div>
          <ResizeHandle value={width} min={80} max={320} onResize={setWidth} onReset={() => setWidth(160)} />
          <div className={styles.resizeRest}><span className="t-data" style={{ color: "var(--fg-3)" }}>drag the hairline</span></div>
        </div>
      </Section>

      <Section title="Mail frame">
        <div className={styles.mail}>
          <MailFrame html={MAIL_HTML} allowRemoteImages={false} title="Sample message" />
        </div>
      </Section>
    </div>
  );
}
