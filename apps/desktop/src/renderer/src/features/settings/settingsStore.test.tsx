import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { flint } from "../../lib/api";
import { ToastProvider } from "../../ui";
import { SettingsProvider, mergeSettings, useSettingsStore } from "./settingsStore";

afterEach(() => vi.restoreAllMocks());

function Probe({ expose }: { expose: (s: ReturnType<typeof useSettingsStore>) => void }) {
  const store = useSettingsStore();
  expose(store);
  return <span data-testid="theme">{store.settings.appearance.theme}</span>;
}

async function mount() {
  let store!: ReturnType<typeof useSettingsStore>;
  render(<ToastProvider><SettingsProvider><Probe expose={(s) => { store = s; }} /></SettingsProvider></ToastProvider>);
  await screen.findByTestId("theme");
  return () => store;
}

describe("settings store", () => {
  it("merges nested patches without mutating the base", async () => {
    const base = await flint.getSettings();
    const next = mergeSettings(base, { appearance: { theme: "light" } });
    expect(next.appearance.theme).toBe("light");
    expect(next.appearance.layout).toBe(base.appearance.layout);
    expect(base.appearance.theme).not.toBe("light-x");
    expect(next).not.toBe(base);
  });

  it("applies a change before the service answers", async () => {
    const real = await flint.getSettings();
    let release!: () => void;
    vi.spyOn(flint, "updateSettings").mockImplementation((patch) => new Promise((res) => { release = () => res(mergeSettings(real, patch)); }));
    const get = await mount();
    const other = real.appearance.theme === "light" ? "dark" : "light";
    let pending!: Promise<boolean>;
    act(() => { pending = get().save({ appearance: { theme: other } }); });
    expect(screen.getByTestId("theme").textContent).toBe(other);
    await act(async () => { release(); await pending; });
    expect(screen.getByTestId("theme").textContent).toBe(other);
  });

  it("reverts and shows a message when the service refuses", async () => {
    const real = await flint.getSettings();
    vi.spyOn(flint, "updateSettings").mockRejectedValue(new Error("Disk is full."));
    const get = await mount();
    const other = real.appearance.theme === "light" ? "dark" : "light";
    let ok = true;
    await act(async () => { ok = await get().save({ appearance: { theme: other } }); });
    expect(ok).toBe(false);
    await waitFor(() => expect(screen.getByTestId("theme").textContent).toBe(real.appearance.theme));
    expect(await screen.findByText("Disk is full.")).toBeTruthy();
  });
});
