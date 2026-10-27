import { describe, expect, it, vi } from "vitest";
import { createNotifier, type NotificationLike, type NotificationOptions } from "./notify-actions";

function fake() {
  const shown: { options: NotificationOptions; n: NotificationLike & { fire(e: string, ...a: unknown[]): void; closed: boolean } }[] = [];
  const hooks = { onClick: vi.fn(), onAction: vi.fn() };
  const make = (isMac = true, supported = true) => createNotifier({
    isSupported: () => supported, isMac, hooks, warn: vi.fn(),
    create: (options) => {
      const handlers = new Map<string, (...a: unknown[]) => void>();
      const n = {
        closed: false,
        on(e: string, l: (...a: unknown[]) => void) { handlers.set(e, l); return n; },
        show() {},
        close() { n.closed = true; handlers.get("close")?.(); },
        fire(e: string, ...a: unknown[]) { handlers.get(e)?.(...a); },
      } as unknown as NotificationLike & { fire(e: string, ...a: unknown[]): void; closed: boolean };
      shown.push({ options, n });
      return n;
    },
  });
  return { shown, hooks, make };
}

describe("createNotifier", () => {
  it("maps sound: null is silent, a name is passed, omitted leaves the default", () => {
    const { shown, make } = fake();
    const notify = make();
    notify({ title: "a", body: "b", sound: null });
    notify({ title: "a", body: "b", sound: "Glass" });
    notify({ title: "a", body: "b" });
    expect(shown[0]!.options).toMatchObject({ silent: true });
    expect(shown[0]!.options.sound).toBeUndefined();
    expect(shown[1]!.options).toMatchObject({ sound: "Glass" });
    expect(shown[1]!.options.silent).toBeUndefined();
    expect(shown[2]!.options.silent).toBeUndefined();
    expect(shown[2]!.options.sound).toBeUndefined();
  });

  it("adds Archive, Move to Trash and Mark as read on macOS for thread alerts only", () => {
    const { shown, make } = fake();
    make(true)({ title: "a", body: "b", threadId: 3, actions: true });
    make(true)({ title: "a", body: "b", actions: true });
    make(false)({ title: "a", body: "b", threadId: 3, actions: true });
    expect(shown[0]!.options.actions?.map((a) => a.text)).toEqual(["Archive", "Move to Trash", "Mark as read"]);
    expect(shown[1]!.options.actions).toBeUndefined();
    expect(shown[2]!.options.actions).toBeUndefined();
  });

  it("opens the thread on click and runs the pressed action", () => {
    const { shown, hooks, make } = fake();
    const notify = make();
    notify({ title: "a", body: "b", threadId: 7, actions: true });
    notify({ title: "a", body: "b", threadId: 8, actions: true });
    notify({ title: "a", body: "b", threadId: 9 });
    shown[0]!.n.fire("click");
    expect(hooks.onClick).toHaveBeenCalledWith(7);
    shown[1]!.n.fire("action", {}, 0);
    expect(hooks.onAction).toHaveBeenCalledWith("archive", 8);
    shown[1]!.n.fire("action", {}, 1);
    expect(hooks.onAction).toHaveBeenCalledWith("trash", 8);
    shown[1]!.n.fire("action", {}, 2);
    expect(hooks.onAction).toHaveBeenCalledWith("markRead", 8);
    shown[2]!.n.fire("click");
    expect(hooks.onClick).toHaveBeenCalledWith(9);
  });

  it("replaces the earlier alert with the same group", () => {
    const { shown, make } = fake();
    const notify = make();
    notify({ title: "1", body: "", group: "g" });
    notify({ title: "2", body: "", group: "other" });
    notify({ title: "3", body: "", group: "g" });
    expect(shown.map((s) => s.n.closed)).toEqual([true, false, false]);
  });

  it("does nothing when notifications are unsupported", () => {
    const { shown, make } = fake();
    make(true, false)({ title: "a", body: "b" });
    expect(shown).toHaveLength(0);
  });
});

describe("verification code alerts", () => {
  it("shows one Copy code button and copies the code when it is pressed", () => {
    const { shown, hooks, make } = fake();
    const onCopy = vi.fn();
    const notify = createNotifier({ ...{ isSupported: () => true, isMac: true, warn: vi.fn() }, hooks: { ...hooks, onCopy }, create: (o) => {
      const handlers = new Map<string, (...a: unknown[]) => void>();
      const n = { on(e: string, l: (...a: unknown[]) => void) { handlers.set(e, l); return n; }, show() {}, close() {}, fire(e: string, ...a: unknown[]) { handlers.get(e)?.(...a); } };
      shown.push({ options: o, n: n as never });
      return n as never;
    } });
    void make;
    notify({ title: "KAYAK code 530331", body: "", threadId: 4, actions: true, copyText: "530331" });
    expect(shown[0]!.options.actions).toEqual([{ type: "button", text: "Copy code" }]);
    shown[0]!.n.fire("action", {}, 0);
    expect(onCopy).toHaveBeenCalledWith("530331");
    expect(hooks.onAction).not.toHaveBeenCalled();
  });

  it("adds no button off macOS and does not mix in Archive", () => {
    const { shown, make } = fake();
    make(false)({ title: "t", body: "b", copyText: "1" });
    expect(shown[0]!.options.actions).toBeUndefined();
    make(true)({ title: "t", body: "b", threadId: 1, actions: true });
    expect(shown[1]!.options.actions).toHaveLength(3);
  });
});
