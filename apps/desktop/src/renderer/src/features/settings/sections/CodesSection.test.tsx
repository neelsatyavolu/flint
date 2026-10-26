import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { flint } from "../../../lib/api";
import { ToastProvider } from "../../../ui";
import { SettingsProvider } from "../settingsStore";
import { browserState, CodesSection } from "./CodesSection";

afterEach(() => vi.restoreAllMocks());
const mount = () => render(<ToastProvider><SettingsProvider><CodesSection /></SettingsProvider></ToastProvider>);
const enabled = async (name: string) => {
  const el = await screen.findByRole(name.startsWith("Install") || name.startsWith("Remove") || name.startsWith("Reinstall") ? "button" : "switch", { name });
  await waitFor(() => expect((el as HTMLButtonElement).disabled).toBe(false));
  return el;
};

describe("CodesSection", () => {
  it("saves the three toggles", async () => {
    const update = vi.spyOn(flint, "updateSettings");
    mount();
    fireEvent.click(await enabled("Copy automatically"));
    await waitFor(() => expect(update).toHaveBeenCalledWith({ codes: { autoCopy: true } }));
    fireEvent.click(await enabled("Notify"));
    await waitFor(() => expect(update).toHaveBeenCalledWith({ codes: { notify: false } }));
    fireEvent.click(await enabled("Detect codes"));
    await waitFor(() => expect(update).toHaveBeenCalledWith({ codes: { enabled: false } }));
    // The mock API is shared between tests: turn detection back on.
    fireEvent.click(await enabled("Detect codes"));
    await waitFor(() => expect(update).toHaveBeenCalledWith({ codes: { enabled: true } }));
  });

  it("lists the browsers and installs then removes the helper", async () => {
    const install = vi.spyOn(flint, "installBrowserHelper");
    const remove = vi.spyOn(flint, "removeBrowserHelper");
    mount();
    await screen.findByText("Google Chrome");
    expect(screen.getByText("Brave")).toBeTruthy();
    fireEvent.click(await enabled("Install helper"));
    await waitFor(() => expect(install).toHaveBeenCalledTimes(1));
    await screen.findByText(/Installed for 3 browsers/);
    fireEvent.click(await enabled("Remove helper"));
    await waitFor(() => expect(remove).toHaveBeenCalledTimes(1));
    await screen.findByText("Removed the browser helper.");
  });

  it("explains how to add the extension to Chromium browsers and Firefox", async () => {
    mount();
    await screen.findByText("Add the extension");
    expect(screen.getByText("chrome://extensions")).toBeTruthy();
    expect(screen.getByText("about:debugging")).toBeTruthy();
    expect(screen.getByText(/Developer mode/)).toBeTruthy();
  });

  it("shows an install error", async () => {
    vi.spyOn(flint, "installBrowserHelper").mockRejectedValue(new Error("Disk is full"));
    mount();
    fireEvent.click(await enabled("Install helper"));
    await screen.findByText(/Disk is full|Couldn't install/);
  });
});

describe("browserState", () => {
  const b = { id: "chrome", name: "Google Chrome", family: "chromium", detected: true, installed: false, foreign: false, manifestPath: "" } as const;
  it("describes each state in plain words", () => {
    expect(browserState({ ...b, installed: true }).text).toBe("Helper installed");
    expect(browserState(b).text).toBe("Helper not installed");
    expect(browserState({ ...b, detected: false }).text).toBe("Not on this Mac");
    expect(browserState({ ...b, foreign: true }).tone).toBe("err");
  });
});
