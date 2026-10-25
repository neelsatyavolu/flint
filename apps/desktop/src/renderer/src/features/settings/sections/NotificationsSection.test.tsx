import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { flint } from "../../../lib/api";
import { ToastProvider } from "../../../ui";
import { SettingsProvider } from "../settingsStore";
import { NotificationsSection } from "./NotificationsSection";

afterEach(() => vi.restoreAllMocks());
const mount = () => render(<ToastProvider><SettingsProvider><NotificationsSection /></SettingsProvider></ToastProvider>);

describe("NotificationsSection", () => {
  it("saves scope, sound, preview and badge choices", async () => {
    const update = vi.spyOn(flint, "updateSettings");
    mount();
    fireEvent.change(await screen.findByLabelText("Notify for"), { target: { value: "all" } });
    await waitFor(() => expect(update).toHaveBeenCalledWith({ notifications: { scope: "all" } }));
    fireEvent.change(screen.getByLabelText("Sound to play"), { target: { value: "Glass" } });
    await waitFor(() => expect(update).toHaveBeenCalledWith({ notifications: { soundName: "Glass" } }));
    fireEvent.change(screen.getByLabelText("Preview"), { target: { value: "none" } });
    await waitFor(() => expect(update).toHaveBeenCalledWith({ notifications: { preview: "none" } }));
    fireEvent.change(screen.getByLabelText("Dock badge"), { target: { value: "people_unread" } });
    await waitFor(() => expect(update).toHaveBeenCalledWith({ notifications: { badge: "people_unread" } }));
  });

  it("turns an account off and back on", async () => {
    const update = vi.spyOn(flint, "updateSettings");
    const accounts = await flint.listAccounts();
    expect(accounts.length).toBeGreaterThan(1);
    mount();
    const toggle = await screen.findByRole("switch", { name: `Notify for ${accounts[0]!.email}` });
    fireEvent.click(toggle);
    await waitFor(() => expect(update).toHaveBeenCalledWith({ notifications: { disabledAccounts: [accounts[0]!.id] } }));
  });

  it("sends a test notification", async () => {
    const test = vi.spyOn(flint, "sendTestNotification");
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Send a test notification" }));
    await waitFor(() => expect(test).toHaveBeenCalledTimes(1));
  });
});
