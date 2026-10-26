import type { RankedCode } from "./protocol";

const CSS = `
:host { all: initial; }
.card {
  --bg: #232321; --fg: #EDEBE5; --fg2: rgba(237,235,229,.70); --fg3: rgba(237,235,229,.46);
  --line: rgba(237,235,229,.18); --accent: #4C8DFF; --soft: rgba(76,141,255,.14);
  box-sizing: border-box; min-width: 200px; max-width: 340px; padding: 3px;
  background: var(--bg); color: var(--fg); border: 1px solid var(--line); border-radius: 4px;
  font: 13px/18px "Geist", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
}
@media (prefers-color-scheme: light) {
  .card { --bg: #FFFFFF; --fg: #1A1A17; --fg2: rgba(26,26,23,.68); --fg3: rgba(26,26,23,.48); --line: rgba(26,26,23,.20); --accent: #2F6FE0; --soft: rgba(47,111,224,.10); }
}
.row {
  display: flex; align-items: baseline; gap: 8px; padding: 7px 10px; border-radius: 3px; cursor: pointer;
  border-left: 2px solid transparent; white-space: nowrap; overflow: hidden;
}
.row[aria-selected="true"] { background: var(--soft); border-left-color: var(--accent); }
.lab { color: var(--fg3); }
.code { font: 600 14px/18px "Geist Mono", ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: .04em; color: var(--fg); }
.svc { color: var(--fg2); overflow: hidden; text-overflow: ellipsis; }
.sep, .src { color: var(--fg3); }
.foot { padding: 3px 8px 2px; color: var(--fg3); font-size: 11px; line-height: 16px; }
`;

export type SuggestionUi = {
  host: HTMLElement;
  show(items: readonly RankedCode[], selected: number, anchor: DOMRect): void;
  select(index: number): void;
  reposition(anchor: DOMRect): void;
  hide(): void;
  isVisible(): boolean;
};

export function createSuggestionUi(
  doc: Document,
  onPick: (index: number, event: Event) => void,
  mode: "open" | "closed" = "closed",
): SuggestionUi {
  const host = doc.createElement("div");
  host.setAttribute("data-flint-codes", "");
  host.style.cssText = "all:initial;position:fixed;z-index:2147483647;top:0;left:0;display:none;";
  const root = host.attachShadow({ mode });
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(CSS);
    root.adoptedStyleSheets = [sheet];
  } catch {
    const style = doc.createElement("style");
    style.textContent = CSS;
    root.append(style);
  }
  const card = doc.createElement("div");
  card.className = "card";
  card.setAttribute("role", "listbox");
  card.setAttribute("aria-label", "Verification codes from Flint");
  root.append(card);
  // Keep focus in the page's field: a mousedown here must not blur it.
  host.addEventListener("mousedown", (e) => e.preventDefault());

  let rows: HTMLElement[] = [];
  let visible = false;

  const place = (anchor: DOMRect): void => {
    const view = doc.defaultView;
    const vw = view?.innerWidth || 1024;
    const vh = view?.innerHeight || 768;
    const { width, height } = host.getBoundingClientRect();
    let top = anchor.bottom + 4;
    if (top + height > vh && anchor.top - height - 4 >= 0) top = anchor.top - height - 4;
    const left = Math.max(8, Math.min(anchor.left, vw - width - 8));
    host.style.top = `${Math.round(top)}px`;
    host.style.left = `${Math.round(left)}px`;
  };

  const span = (cls: string, text: string): HTMLElement => {
    const s = doc.createElement("span");
    s.className = cls;
    s.textContent = text;
    return s;
  };

  return {
    host,
    show(items, selected, anchor) {
      card.replaceChildren();
      const multi = items.length > 1;
      rows = items.map((item, i) => {
        const row = doc.createElement("div");
        row.className = "row";
        row.setAttribute("role", "option");
        row.append(span("lab", "Fill"), span("code", item.code), span("sep", "·"), span("svc", item.service));
        if (!multi) row.append(span("sep", "·"), span("src", "from Flint"));
        row.addEventListener("click", (e) => onPick(i, e));
        card.append(row);
        return row;
      });
      if (multi) card.append(span("foot", "from Flint · arrows to choose, Enter to fill"));
      if (!doc.documentElement.contains(host)) doc.documentElement.append(host);
      host.style.display = "block";
      visible = true;
      this.select(selected);
      place(anchor);
    },
    select(index) {
      rows.forEach((r, i) => r.setAttribute("aria-selected", String(i === index)));
    },
    reposition(anchor) {
      if (visible) place(anchor);
    },
    hide() {
      visible = false;
      host.style.display = "none";
    },
    isVisible: () => visible,
  };
}
