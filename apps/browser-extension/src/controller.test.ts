import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startController } from "./controller";
import type { BackgroundReply, WireCode } from "./protocol";

const KAYAK: WireCode = { id: "k", code: "530331", service: "KAYAK", senderDomain: "kayak.com", receivedAt: 2000 };
const SLACK: WireCode = { id: "s", code: "123456", service: "Slack", senderDomain: "slack.com", receivedAt: 3000 };
const flush = () => new Promise((r) => setTimeout(r, 0));

let stop: (() => void) | undefined;
afterEach(() => {
  stop?.();
  stop = undefined;
  document.body.innerHTML = "";
});

function setup(reply: BackgroundReply, hosts = ["www.kayak.com"]) {
  document.body.innerHTML = '<input id="a" name="otp"><input id="b" name="email">';
  const markUsed = vi.fn();
  const fetchCodes = vi.fn(async () => reply);
  stop = startController({ doc: document, fetchCodes, markUsed, hosts: () => hosts, uiMode: "open", trusted: () => true }).stop;
  const input = document.querySelector<HTMLInputElement>("#a")!;
  const ui = () => document.querySelector("[data-flint-codes]") as HTMLElement | null;
  const rows = () => Array.from(ui()?.shadowRoot?.querySelectorAll(".row") ?? []);
  const key = (k: string) => input.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));
  return { input, ui, rows, key, markUsed, fetchCodes };
}

describe("suggestion", () => {
  beforeEach(() => void 0);

  it("shows the matching code on focus and fills on click", async () => {
    const s = setup({ ok: true, codes: [SLACK, KAYAK] });
    s.input.focus();
    await flush();
    expect(s.rows()).toHaveLength(2);
    expect(s.rows()[0]!.textContent).toContain("530331");
    (s.rows()[0] as HTMLElement).click();
    expect(s.input.value).toBe("530331");
    expect(s.markUsed).toHaveBeenCalledWith("k");
    expect(s.ui()!.style.display).toBe("none");
  });

  it("single code reads 'Fill 530331 · KAYAK · from Flint'", async () => {
    const s = setup({ ok: true, codes: [KAYAK] });
    s.input.focus();
    await flush();
    expect(s.rows()[0]!.textContent).toBe("Fill530331·KAYAK·from Flint");
  });

  it("Enter fills the selected code, arrows move, Esc dismisses until refocus", async () => {
    const s = setup({ ok: true, codes: [KAYAK, SLACK] });
    s.input.focus();
    await flush();
    s.key("ArrowDown");
    expect(s.rows()[1]!.getAttribute("aria-selected")).toBe("true");
    s.key("ArrowUp");
    expect(s.rows()[0]!.getAttribute("aria-selected")).toBe("true");
    s.key("Escape");
    expect(s.ui()!.style.display).toBe("none");
    expect(s.input.value).toBe("");
    s.key("Enter");
    expect(s.input.value).toBe("");
    s.input.blur();
    s.input.focus();
    await flush();
    expect(s.ui()!.style.display).toBe("block");
    s.key("ArrowDown");
    s.key("Enter");
    expect(s.input.value).toBe("123456");
    expect(s.markUsed).toHaveBeenCalledWith("s");
  });

  it("shows nothing for non-code fields, errors, or no codes", async () => {
    const s = setup({ ok: false, error: "not_running" });
    s.input.focus();
    await flush();
    expect(s.ui()?.style.display ?? "none").toBe("none");
    stop?.();
    const t = setup({ ok: true, codes: [KAYAK] });
    document.querySelector<HTMLInputElement>("#b")!.focus();
    await flush();
    expect(t.fetchCodes).not.toHaveBeenCalled();
  });

  it("hides when the person types, and when the field blurs", async () => {
    const s = setup({ ok: true, codes: [KAYAK] });
    s.input.focus();
    await flush();
    s.input.value = "5";
    s.input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(s.ui()!.style.display).toBe("none");
    s.input.value = "";
    s.input.blur();
    s.input.focus();
    await flush();
    expect(s.ui()!.style.display).toBe("block");
    s.input.blur();
    expect(s.ui()!.style.display).toBe("none");
  });

  it("drops codes that do not fit the field", async () => {
    document.body.innerHTML = '<input id="a" name="otp" maxlength="4">';
    stop = startController({ doc: document, fetchCodes: async () => ({ ok: true, codes: [KAYAK] }), markUsed: vi.fn(), hosts: () => [], uiMode: "open", trusted: () => true }).stop;
    document.querySelector<HTMLInputElement>("#a")!.focus();
    await flush();
    expect(document.querySelector("[data-flint-codes]")?.shadowRoot?.querySelectorAll(".row").length ?? 0).toBe(0);
  });

  it("suggests for a field added later and focused", async () => {
    const s = setup({ ok: true, codes: [KAYAK] });
    const late = document.createElement("input");
    late.autocomplete = "one-time-code";
    document.body.append(late);
    late.focus();
    await flush();
    expect(s.rows()).toHaveLength(1);
  });

  it("fills split boxes", async () => {
    document.body.innerHTML = Array.from({ length: 6 }, (_, i) => `<input id="b${i}" maxlength="1" autocomplete="one-time-code">`).join("");
    const markUsed = vi.fn();
    stop = startController({ doc: document, fetchCodes: async () => ({ ok: true, codes: [KAYAK] }), markUsed, hosts: () => [], uiMode: "open", trusted: () => true }).stop;
    document.querySelector<HTMLInputElement>("#b2")!.focus();
    await flush();
    document.querySelector("[data-flint-codes]")!.shadowRoot!.querySelector<HTMLElement>(".row")!.click();
    expect(Array.from(document.querySelectorAll<HTMLInputElement>("input")).map((i) => i.value).join("")).toBe("530331");
    expect(markUsed).toHaveBeenCalledWith("k");
  });

  it("ignores keys and clicks the page dispatched itself", async () => {
    document.body.innerHTML = '<input id="a" autocomplete="one-time-code">';
    const markUsed = vi.fn();
    stop = startController({ doc: document, fetchCodes: async () => ({ ok: true, codes: [KAYAK] }), markUsed, hosts: () => [], uiMode: "open" }).stop;
    const input = document.querySelector<HTMLInputElement>("#a")!;
    input.focus();
    await flush();
    const rows = () => document.querySelector("[data-flint-codes]")!.shadowRoot!.querySelectorAll<HTMLElement>(".row");
    expect(rows()).toHaveLength(1);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    rows()[0]!.click();
    expect(input.value).toBe("");
    expect(markUsed).not.toHaveBeenCalled();
  });

  it("reuses the last reply for rapid refocus instead of asking the host again", async () => {
    const s = setup({ ok: true, codes: [KAYAK] });
    for (let i = 0; i < 5; i++) {
      s.input.blur();
      s.input.focus();
      await flush();
    }
    expect(s.fetchCodes).toHaveBeenCalledTimes(1);
  });
});
