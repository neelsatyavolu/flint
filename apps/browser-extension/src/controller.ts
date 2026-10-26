import { findCodeTarget, type CodeTarget } from "./fields";
import { fillTarget, fitCode } from "./fill";
import type { BackgroundReply, RankedCode } from "./protocol";
import { rankCodes } from "./rank";
import { createSuggestionUi } from "./ui";

export type ControllerDeps = {
  doc: Document;
  /** Asks the background worker for the current codes. */
  fetchCodes(): Promise<BackgroundReply>;
  markUsed(id: string): void;
  /** Hosts to rank against: this frame, plus the top page when framed. */
  hosts(): string[];
  uiMode?: "open" | "closed";
  /** True for events that come from a real person. Defaults to `event.isTrusted`; tests inject their own. */
  trusted?(event: Event): boolean;
};

/** Codes are re-fetched at most this often; a page that focuses and blurs a field in a loop reuses the last reply. */
const FETCH_REUSE_MS = 1000;

type Shown = { target: CodeTarget; items: RankedCode[]; selected: number };

function deepActive(doc: Document): Element | null {
  let el = doc.activeElement;
  while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
  return el;
}

function anchorRect(target: CodeTarget): DOMRect {
  const rects = target.inputs.map((i) => i.getBoundingClientRect());
  const left = Math.min(...rects.map((r) => r.left));
  const top = Math.min(...rects.map((r) => r.top));
  const right = Math.max(...rects.map((r) => r.right));
  const bottom = Math.max(...rects.map((r) => r.bottom));
  return new DOMRect(left, top, right - left, bottom - top);
}

export function startController(deps: ControllerDeps): { stop(): void } {
  const { doc } = deps;
  const win = doc.defaultView;
  let shown: Shown | null = null;
  let current: CodeTarget | null = null;
  let dismissed: Element | null = null;
  let ticket = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastFetch: { at: number; reply: BackgroundReply } | null = null;
  const trusted = deps.trusted ?? ((e: Event) => e.isTrusted);

  const ui = createSuggestionUi(doc, (i, e) => pick(i, e), deps.uiMode);

  async function codes(): Promise<BackgroundReply> {
    if (lastFetch && Date.now() - lastFetch.at < FETCH_REUSE_MS) return lastFetch.reply;
    const reply = await deps.fetchCodes();
    lastFetch = { at: Date.now(), reply };
    return reply;
  }

  function hide(): void {
    ticket++;
    shown = null;
    current = null;
    ui.hide();
  }

  /** A code is only typed into the page for a real key press or click, never for events the page dispatched itself. */
  function pick(index: number, e: Event): void {
    if (!trusted(e)) return;
    const item = shown?.items[index];
    if (!shown || !item) return;
    const { target } = shown;
    if (fillTarget(target, item.code)) deps.markUsed(item.id);
    hide();
  }

  async function evaluate(el: Element | null): Promise<void> {
    const target = findCodeTarget(el);
    if (!target) return hide();
    if (current && current.inputs[0] === target.inputs[0] && current.kind === target.kind) return;
    if (dismissed && target.inputs.includes(dismissed as HTMLInputElement)) return;
    if (target.inputs.some((i) => i.value !== "")) return hide();
    hide();
    current = target;
    const mine = ++ticket;
    let reply: BackgroundReply;
    try {
      reply = await codes();
    } catch {
      return;
    }
    if (mine !== ticket || !reply.ok) return;
    const active = deepActive(doc);
    if (!active || !target.inputs.includes(active as HTMLInputElement)) return;
    const fitting = (reply.codes ?? []).filter((c) => fitCode(target, c.code) !== null);
    const items = rankCodes(fitting, deps.hosts());
    if (items.length === 0) return;
    shown = { target, items, selected: 0 };
    ui.show(items, 0, anchorRect(target));
  }

  const onFocusIn = (e: Event): void => {
    const el = (e.composedPath()[0] as Element | undefined) ?? (e.target as Element | null);
    void evaluate(el ?? null);
  };

  const onFocusOut = (e: Event): void => {
    const el = (e.composedPath()[0] as Element | undefined) ?? null;
    if (el && el === dismissed) dismissed = null;
    hide();
  };

  const onInput = (e: Event): void => {
    if (!shown) return;
    const el = e.composedPath()[0] as HTMLInputElement | undefined;
    if (el && shown.target.inputs.includes(el) && el.value !== "") hide();
  };

  const onKeyDown = (e: KeyboardEvent): void => {
    if (!trusted(e) || !shown || !ui.isVisible() || e.isComposing) return;
    const count = shown.items.length;
    const swallow = (): void => {
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    if (e.key === "Escape") {
      dismissed = shown.target.inputs.find((i) => i === deepActive(doc)) ?? shown.target.inputs[0] ?? null;
      hide();
      swallow();
    } else if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
      swallow();
      pick(shown.selected, e);
    } else if ((e.key === "ArrowDown" || e.key === "ArrowUp") && count > 1) {
      shown.selected = (shown.selected + (e.key === "ArrowDown" ? 1 : count - 1)) % count;
      ui.select(shown.selected);
      swallow();
    }
  };

  const onMove = (): void => {
    if (shown) ui.reposition(anchorRect(shown.target));
  };

  const observer = new MutationObserver(() => {
    if (shown && !shown.target.inputs.every((i) => i.isConnected)) return hide();
    if (timer || shown || current) return;
    timer = setTimeout(() => {
      timer = null;
      void evaluate(deepActive(doc));
    }, 100);
  });

  doc.addEventListener("focusin", onFocusIn, true);
  doc.addEventListener("focusout", onFocusOut, true);
  doc.addEventListener("input", onInput, true);
  doc.addEventListener("keydown", onKeyDown, true);
  win?.addEventListener("scroll", onMove, true);
  win?.addEventListener("resize", onMove);
  observer.observe(doc.documentElement, { childList: true, subtree: true });
  void evaluate(deepActive(doc));

  return {
    stop() {
      doc.removeEventListener("focusin", onFocusIn, true);
      doc.removeEventListener("focusout", onFocusOut, true);
      doc.removeEventListener("input", onInput, true);
      doc.removeEventListener("keydown", onKeyDown, true);
      win?.removeEventListener("scroll", onMove, true);
      win?.removeEventListener("resize", onMove);
      observer.disconnect();
      if (timer) clearTimeout(timer);
      hide();
      ui.host.remove();
    },
  };
}
