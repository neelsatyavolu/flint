import { afterEach, describe, expect, it } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { ToastProvider } from "../../ui/Toast";
import { Composer } from "./Composer";
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
