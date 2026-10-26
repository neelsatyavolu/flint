import { useCallback, useEffect, useId, useMemo, useRef, useState, type JSX, type KeyboardEvent } from "react";
import { Search } from "lucide-react";
import clsx from "clsx";
import type { Account } from "@flint/core";
import { useFlintQuery } from "../../lib/hooks";
import type { AppCommands } from "../../shell/useAppCommands";
import { useApp } from "../../state/AppContext";
import { listStore } from "../../state/listStore";
import { navStore, targetIds } from "../../state/nav";
import { useThreadActions } from "../../state/useActions";
import { useToast } from "../../ui/Toast";
import { pluralize } from "../../lib/format";
import { useComposers } from "../compose/composerStore";
import styles from "./CommandPalette.module.css";
import { MODE_PREFIX, parseQuery, type Mode } from "./modes";
import { moveTargets } from "./moveTargets";
import { pageEntries, PAGE_TITLES, rootEntries, type PageId, type PaletteEnv, type Row } from "./model";
import { PaletteFrame } from "./PaletteFrame";
import { optionId, PaletteList } from "./PaletteList";
import { buildPageSections, buildSections } from "./sections";
import { loadUsage, recordUse } from "./usage";
import { useRemote } from "./useRemote";

type Frame = { page: PageId; parentRaw: string; parentActive: string | undefined };

const EXIT_MS = 100;
const PLACEHOLDER = "Search, or type > commands, / mail, @ people, # folders";
const MODE_PLACEHOLDER: Record<Exclude<Mode, "all">, string> = {
  commands: "Run a command", mail: "Search all mail", contacts: "Write to a name or address", folders: "Go to a folder or category",
};

const reducedMotion = () => typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function fromOptionsOf(accounts: Account[]) {
  return accounts.filter((a) => a.enabled).flatMap((a) => [{ address: a.email, alias: false }, ...a.aliases.map((alias) => ({ address: alias, alias: true }))]);
}

function emptyCopy(mode: Mode, text: string, page: PageId | undefined): { title: string; body: string } {
  if (page) return { title: text ? `Nothing matches “${text}”` : "Nothing here yet", body: page === "template" ? "Add templates in Settings, Templates." : "Clear the filter to see every option." };
  if (mode === "mail") return { title: "Search all mail", body: "Type words from a subject, sender or message. Narrow with from:, to:, has:attachment or is:unread." };
  if (mode === "contacts") return { title: "Write to someone", body: text ? `No contact matches “${text}”. Type a full address to write to it.` : "Type a name or an address." };
  if (mode === "folders") return { title: text ? `No folder matches “${text}”` : "No folders", body: "Folders and categories of every account live here." };
  return { title: text ? `No command matches “${text}”` : "No commands", body: "Clear the > to search everything." };
}

/** Cmd+K: commands, navigation, nested pages, live mail and contact search, all from one input. */
export function CommandPalette({ cmds }: { cmds: AppCommands }): JSX.Element {
  const { accounts, sidebar, settings, updateSettings } = useApp();
  const toast = useToast();
  const { run } = useThreadActions();
  const composers = useComposers();
  const composer = composers.find((c) => !c.minimized) ?? null;
  const uid = useId().replace(/:/g, "");
  const input = useRef<HTMLInputElement>(null);
  const results = useRef<HTMLDivElement>(null);

  const [raw, setRaw] = useState("");
  const [stack, setStack] = useState<Frame[]>([]);
  const [activeId, setActiveId] = useState<string | undefined>();
  const [closing, setClosing] = useState(false);
  const [usage, setUsage] = useState(loadUsage);
  const [now] = useState(() => Date.now());
  const ids = useMemo(() => targetIds(navStore.getState()), []);

  const page = stack.at(-1)?.page;
  const parsed = page ? { mode: "all" as Mode, text: raw.trim() } : parseQuery(raw);
  const { mode, text } = parsed;

  const templates = useFlintQuery((api) => api.listTemplates(), [], { enabled: composer !== null && page === "template", mail: false });
  const remote = useRemote(mode, text, !page);

  const env = useMemo<PaletteEnv>(() => {
    const first = listStore.getState().raw.find((i) => i.id === ids[0]);
    return {
      cmds, accounts, sidebar, settings, now, composer, category: ids.length ? cmds.targetCategory() : null,
      count: cmds.inMailView() && ids.length ? ids.length : 0,
      moveFolders: moveTargets(sidebar, first?.accountId ?? accounts[0]?.id),
      run: (action) => void run(action, ids),
      update: (patch, message) => { void updateSettings(patch); toast.show({ message }); },
      templates: templates.data ?? [],
      fromOptions: fromOptionsOf(accounts),
    };
  }, [cmds, accounts, sidebar, settings, now, composer, ids, run, updateSettings, toast, templates.data]);

  const entries = useMemo(() => rootEntries(env), [env]);
  const sections = useMemo(() => {
    if (page) return buildPageSections(pageEntries(page, env), raw);
    return buildSections({
      mode, text, entries, usage, now, remote, aiEnabled: settings.ai.enabled,
      actionMeta: env.count > 1 ? `${env.count} threads` : undefined,
    });
  }, [page, env, raw, mode, text, entries, usage, now, remote, settings.ai.enabled]);
  const rows = useMemo(() => sections.flatMap((s) => s.rows), [sections]);
  const active = rows.find((r) => r.id === activeId) ?? rows[0];

  useEffect(() => {
    if (!active) return;
    const el = document.getElementById(optionId(uid, active.id));
    if (rows[0] === active) results.current?.scrollTo?.({ top: 0 });
    else el?.scrollIntoView?.({ block: "nearest" });
  }, [active, rows, uid]);

  const requestClose = useCallback(() => {
    if (reducedMotion()) { navStore.getState().closeOverlay(); return; }
    setClosing(true);
    setTimeout(() => navStore.getState().closeOverlay(), EXIT_MS);
  }, []);

  const type = (value: string) => { setRaw(value); setActiveId(undefined); };
  const open = (row: Row) => {
    if (!row.page) return;
    setUsage((u) => recordUse(u, row.id.replace(/^recent:/, "")));
    setStack((s) => [...s, { page: row.page!, parentRaw: raw, parentActive: row.id }]);
    setRaw("");
    setActiveId(undefined);
  };
  const back = () => {
    const frame = stack.at(-1);
    if (!frame) return;
    setStack((s) => s.slice(0, -1));
    setRaw(frame.parentRaw);
    setActiveId(frame.parentActive);
    input.current?.focus();
  };
  const pick = (row: Row | undefined) => {
    if (!row) return;
    if (row.page) { open(row); return; }
    if (!row.run) return;
    if (row.kind !== "option" && row.kind !== "mail" && row.kind !== "contact" && row.kind !== "ask" && row.kind !== "search") setUsage((u) => recordUse(u, row.id.replace(/^recent:/, "")));
    navStore.getState().closeOverlay();
    row.run();
  };

  const move = (delta: number) => {
    if (rows.length === 0) return;
    const at = Math.max(0, rows.findIndex((r) => r === active));
    setActiveId(rows[(at + delta + rows.length) % rows.length]!.id);
  };

  const onPanelKey = (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    e.stopPropagation();
    if (stack.length) back();
    else requestClose();
  };

  const onInputKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    const el = e.currentTarget;
    const atEnd = el.selectionStart === el.value.length && el.selectionEnd === el.value.length;
    if (e.key === "ArrowDown" || (e.ctrlKey && e.key === "n")) move(1);
    else if (e.key === "ArrowUp" || (e.ctrlKey && e.key === "p")) move(-1);
    else if (e.key === "Enter") pick(active);
    else if (e.key === "Tab") { if (active?.page) open(active); }
    else if (e.key === "ArrowRight" && atEnd && active?.page) open(active);
    else if ((e.key === "Backspace" && raw === "" && stack.length) || (e.key === "ArrowLeft" && el.selectionStart === 0 && el.selectionEnd === 0 && stack.length)) back();
    else return;
    e.preventDefault();
  };

  const crumb = page ? PAGE_TITLES[page] : null;
  const placeholder = page ? `Filter ${PAGE_TITLES[page].toLowerCase()}` : mode === "all" ? PLACEHOLDER : MODE_PLACEHOLDER[mode];
  const empty = emptyCopy(mode, text, page);
  const listId = `${uid}-list`;

  return (
    <PaletteFrame label="Command palette" closing={closing} initialFocus={input} onDismiss={requestClose} onKeyDown={onPanelKey}>
      <div className={styles.inputRow}>
        <Search size={18} strokeWidth={1.5} aria-hidden />
        {crumb ? <span className={clsx("t-body", styles.crumb)}>{crumb}</span> : null}
        <input
          ref={input}
          className={styles.input}
          value={raw}
          placeholder={placeholder}
          role="combobox"
          aria-label="Command palette"
          aria-expanded
          aria-haspopup="listbox"
          aria-autocomplete="list"
          aria-controls={listId}
          aria-activedescendant={active ? optionId(uid, active.id) : undefined}
          onChange={(e) => type(e.target.value)}
          onKeyDown={onInputKey}
          spellCheck={false}
          autoComplete="off"
          autoFocus
        />
        {remote.mailLoading ? <div className={styles.progress} aria-hidden /> : null}
      </div>
      <div ref={results} id={listId} role="listbox" aria-label="Results" className={styles.results} onMouseDown={(e) => e.preventDefault()}>
        {rows.length === 0 && sections.length === 0 ? (
          <div className={styles.empty}>
            <div className={clsx("t-body", styles.emptyTitle)}>{empty.title}</div>
            <div className={clsx("t-body", styles.emptyBody)}>{empty.body}</div>
          </div>
        ) : (
          <PaletteList sections={sections} activeId={active?.id} idPrefix={uid} onHover={setActiveId} onPick={pick} />
        )}
      </div>
      <div className={styles.sr} role="status" aria-live="polite">{rows.length === 0 ? empty.title : remote.mailLoading ? "Searching mail" : pluralize(rows.length, "result")}</div>
      <div className={clsx("t-data", styles.footer)}>
        <div className={styles.legend} aria-hidden>
          <span><b>{"↑↓"}</b> move</span>
          <span><b>{"↵"}</b> run</span>
          <span className={clsx(!active?.page && styles.off)}><b>{"→"}</b> open</span>
          <span><b>esc</b> {stack.length ? "back" : "close"}</span>
        </div>
        {page ? null : (
          <div className={styles.modes}>
            {(Object.keys(MODE_PREFIX) as (keyof typeof MODE_PREFIX)[]).map((m) => (
              <button key={m} type="button" tabIndex={-1} className={clsx(styles.modeBtn, mode === m && styles.modeOn)} onClick={() => { type(MODE_PREFIX[m]); input.current?.focus(); }}>
                <b>{MODE_PREFIX[m]}</b> {m === "contacts" ? "people" : m}
              </button>
            ))}
          </div>
        )}
      </div>
    </PaletteFrame>
  );
}
