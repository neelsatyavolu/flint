import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ComposerBar, RECEIPTS_ON } from "./ComposerBar";
import type { Fields } from "./useComposerSession";

const fields = { to: [], cc: [], bcc: [], subject: "", html: "", from: "me@x.io", accountId: "a", signatureId: null, track: true, remindAt: null, attachments: [] } as unknown as Fields;
const noop = () => undefined;
const props = (over: Partial<Parameters<typeof ComposerBar>[0]> = {}) => ({
  fields, saveState: "idle" as const, fromOptions: [], templates: [], signatures: [], receiptsBlockedReason: null, aiOpen: false, sending: false,
  onMinimize: noop, onClose: noop, onToggleAi: noop, onAttach: noop, onTemplate: noop, onRemind: noop, onSendLater: noop,
  onToggleTrack: noop, onFrom: noop, onSignature: noop, onDiscard: noop, onSend: noop, ...over,
});

describe("ComposerBar receipts toggle", () => {
  it("toggles when receipts can work", () => {
    const onToggleTrack = vi.fn();
    render(<ComposerBar {...props({ onToggleTrack })} />);
    fireEvent.click(screen.getByRole("button", { name: RECEIPTS_ON }));
    expect(onToggleTrack).toHaveBeenCalledTimes(1);
  });

  it("shows the reason as its label and ignores clicks when receipts are blocked", () => {
    const onToggleTrack = vi.fn();
    render(<ComposerBar {...props({ receiptsBlockedReason: "Receipts off: plain-text mode", onToggleTrack })} />);
    const btn = screen.getByRole("button", { name: "Receipts off: plain-text mode" });
    expect(btn.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(btn);
    expect(onToggleTrack).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: RECEIPTS_ON })).toBeNull();
  });
});
