import { afterEach, describe, expect, it } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { ToastProvider } from "../../ui/Toast";
import { Composer, restoreFocus } from "./Composer";
import { openComposer, resetComposerStore, useComposers } from "./composerStore";

function Host() {
  const list = useComposers();
  return <>{list.map((c) => <Composer key={c.id} entry={c} hidden={false} />)}</>;
}

afterEach(() => resetComposerStore());

describe("Composer Escape", () => {
  it("closes from the page, not only from inside the editor", async () => {
    render(<ToastProvider><Host /></ToastProvider>);
    act(() => openComposer({ mode: "new" }));
    await screen.findByLabelText("Subject");
    expect(screen.getByRole("dialog", { name: "New message" })).toBeTruthy();
    fireEvent.keyDown(document.body, { key: "Escape" });
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByRole("dialog", { name: "New message" })).toBeNull();
  });
});

describe("Composer focus", () => {
  it("returns focus to what had it before the composer opened", async () => {
    render(<ToastProvider><button type="button">Compose</button><Host /></ToastProvider>);
    const opener = screen.getByRole("button", { name: "Compose" });
    opener.focus();
    act(() => openComposer({ mode: "new" }));
    await screen.findByLabelText("Subject");
    expect(document.activeElement).toBe(screen.getByRole("combobox", { name: "To" }));
    fireEvent.click(screen.getByRole("button", { name: "Close and save draft" }));
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByRole("dialog", { name: "New message" })).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("falls back to the thread list when the opener is gone", () => {
    render(<div role="listbox" aria-label="Conversations" tabIndex={-1} />);
    const gone = document.createElement("button");
    restoreFocus(gone);
    expect(document.activeElement).toBe(screen.getByRole("listbox", { name: "Conversations" }));
  });
});
