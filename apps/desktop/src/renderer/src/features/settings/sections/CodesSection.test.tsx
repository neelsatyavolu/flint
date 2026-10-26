import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { flint } from "../../../lib/api";
import { ToastProvider } from "../../../ui";
import { SettingsProvider } from "../settingsStore";
import { autofillState, PERMISSION_POLL_MS } from "./AutofillBlock";
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

describe("Autofill in any app", () => {
  it("comes first, asks for permission on Enable, and unlocks Try it once ready", async () => {
    const request = vi.spyOn(flint, "requestAutofillPermission");
    const demo = vi.spyOn(flint, "tryAutofillDemo");
    mount();
    await screen.findByText("Autofill in any app");
    const headings = screen.getAllByText(/Autofill in any app|Detect codes|Advanced: browser extension/).map((e) => e.textContent);
    expect(headings[0]).toBe("Autofill in any app");
    await screen.findByText("Needs Accessibility permission");
    expect(screen.getByText(/While a code is waiting/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Try it" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Enable" }));
    await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    await screen.findByText("Ready");
    expect(screen.queryByRole("button", { name: "Enable" })).toBeNull();
    const tryIt = screen.getByRole("button", { name: "Try it" }) as HTMLButtonElement;
    await waitFor(() => expect(tryIt.disabled).toBe(false));
    fireEvent.click(tryIt);
    await waitFor(() => expect(demo).toHaveBeenCalledTimes(1));
  });

  it("shows an error when the demo fails", async () => {
    vi.spyOn(flint, "tryAutofillDemo").mockRejectedValue(new Error("Allow Accessibility for Flint first."));
    mount();
    const btn = await screen.findByRole("button", { name: "Try it" });
    await waitFor(() => expect((btn as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(btn);
    await screen.findByText(/Allow Accessibility/);
  });

  it("saves a captured shortcut, and Delete turns it off", async () => {
    const update = vi.spyOn(flint, "updateSettings");
    mount();
    const first = await screen.findByRole("button", { name: "Shortcut" });
    await waitFor(() => expect((first as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(first);
    const capture = await screen.findByText(/Press keys/);
    fireEvent.keyDown(capture, { key: "k", code: "KeyK", ctrlKey: true, shiftKey: true });
    await waitFor(() => expect(update).toHaveBeenCalledWith({ codes: { shortcut: "Control+Shift+K" } }));
    await screen.findByText("⌃⇧K");
    const again = await screen.findByRole("button", { name: "Shortcut" });
    await waitFor(() => expect((again as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(again);
    fireEvent.keyDown(await screen.findByText(/Press keys/), { key: "Delete", code: "Delete" });
    await waitFor(() => expect(update).toHaveBeenCalledWith({ codes: { shortcut: "" } }));
  });

  it("saves the autofill toggle", async () => {
    const update = vi.spyOn(flint, "updateSettings");
    mount();
    fireEvent.click(await enabled("Fill codes in any app"));
    await waitFor(() => expect(update).toHaveBeenCalledWith({ codes: { autofill: false } }));
    fireEvent.click(await enabled("Fill codes in any app"));
    await waitFor(() => expect(update).toHaveBeenCalledWith({ codes: { autofill: true } }));
  });

  it("keeps checking the permission while it is missing, so a grant in System Settings shows up", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const status = vi.spyOn(flint, "autofillStatus").mockResolvedValue({ state: "needs_permission", supported: true, permission: "needed", helperRunning: true, waiting: 0, shortcutActive: null });
      mount();
      await screen.findByText("Needs Accessibility permission");
      const before = status.mock.calls.length;
      await vi.advanceTimersByTimeAsync(PERMISSION_POLL_MS * 3 + 100);
      expect(status.mock.calls.length).toBeGreaterThanOrEqual(before + 3);
      status.mockResolvedValue({ state: "ready", supported: true, permission: "granted", helperRunning: true, waiting: 0, shortcutActive: null });
      await vi.advanceTimersByTimeAsync(PERMISSION_POLL_MS + 100);
      await screen.findByText("Ready");
      const settled = status.mock.calls.length;
      await vi.advanceTimersByTimeAsync(PERMISSION_POLL_MS * 3);
      expect(status.mock.calls.length).toBe(settled); // stops polling once granted
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the browser extension under an optional Advanced disclosure", async () => {
    mount();
    const summary = await screen.findByText(/Advanced: browser extension/);
    expect(summary.closest("details")?.contains(await screen.findByText("Add the extension"))).toBe(true);
  });
});

describe("autofillState", () => {
  const base = { state: "ready", supported: true, permission: "granted", helperRunning: true, waiting: 0, shortcutActive: null } as const;
  it("describes each state", () => {
    expect(autofillState(base)).toEqual({ text: "Ready", tone: "ok" });
    expect(autofillState({ ...base, state: "needs_permission" }).tone).toBe("err");
    expect(autofillState({ ...base, state: "off" }).text).toBe("Off");
    expect(autofillState({ ...base, supported: false, state: "unavailable" }).text).toMatch(/Not available/);
    expect(autofillState(undefined).text).toBe("Checking…");
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
