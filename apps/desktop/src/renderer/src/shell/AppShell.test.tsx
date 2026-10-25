import { describe, expect, it } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { App } from "../App";
import { ToastProvider } from "../ui";
import { navStore } from "../state/nav";
import { listStore } from "../state/listStore";
import { shortcuts } from "../lib/shortcuts";

describe("App shell with the mock API", () => {
  it("loads the sidebar and list, opens a thread and handles shortcuts", async () => {
    render(<ToastProvider><App /></ToastProvider>);
    await screen.findByRole("navigation", { name: "Mailboxes" });
    // jsdom has no layout, so the virtual list paints no rows; the store still holds them.
    await waitFor(() => expect(listStore.getState().entries.length).toBeGreaterThan(0), { timeout: 5000 });

    const detach = shortcuts.attach(document);
    await act(async () => { fireEvent.keyDown(document.body, { key: "j" }); });
    await waitFor(() => expect(navStore.getState().openId).not.toBeNull());
    await waitFor(() => expect(document.querySelector("[data-reader-scroll] h1")).not.toBeNull(), { timeout: 5000 });

    await act(async () => { fireEvent.keyDown(document.body, { key: "k", ctrlKey: true }); });
    await screen.findByRole("combobox", { name: "Command palette" });
    await act(async () => { fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" }); });

    await act(async () => { fireEvent.keyDown(document.body, { key: "?" }); });
    await screen.findByText("Keyboard shortcuts");
    navStore.getState().closeOverlay();

    await act(async () => { fireEvent.keyDown(document.body, { key: "g" }); });
    await act(async () => { fireEvent.keyDown(document.body, { key: "h" }); });
    expect(navStore.getState().view).toBe("home");
    await screen.findByText(/Good (morning|afternoon|evening)/);
    detach();
  }, 20000);
});
