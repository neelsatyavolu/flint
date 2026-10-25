import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { flint } from "../../lib/api";
import { createMockApi } from "../../mock";
import { AppContext, type AppData } from "../../state/AppContext";
import { navStore } from "../../state/nav";
import { ToastProvider } from "../../ui";
import { ListHeader } from "./ListHeader";

async function mount() {
  const api = createMockApi({ now: Date.now() });
  const [accounts, sidebar, settings] = await Promise.all([api.listAccounts(), api.getSidebar(), api.getSettings()]);
  const data: AppData = { settings, updateSettings: async () => settings, accounts, refreshAccounts: () => undefined, sidebar, narrow: false, selfAddresses: [] };
  render(
    <ToastProvider>
      <AppContext.Provider value={data}><ListHeader /></AppContext.Provider>
    </ToastProvider>,
  );
  await act(async () => { await Promise.resolve(); });
}

const status = (connected: boolean, enabled = true) => ({ connected, enabled, provider: connected ? "codex" : null, model: null, models: [] }) as never;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  navStore.getState().go({ view: "inbox" });
});

describe("ListHeader bundle summary", () => {
  it("offers a summary inside a Newsletters bundle when AI is on", async () => {
    vi.spyOn(flint, "aiStatus").mockResolvedValue(status(true));
    navStore.getState().go({ view: "inbox" });
    navStore.getState().openCategory("newsletters");
    await mount();
    expect(await screen.findByRole("button", { name: /summarize newsletters/i })).toBeTruthy();
  });

  it("offers nothing in the plain inbox", async () => {
    vi.spyOn(flint, "aiStatus").mockResolvedValue(status(true));
    await mount();
    expect(screen.queryByRole("button", { name: /summarize/i })).toBeNull();
  });

  it("offers nothing when AI is not connected", async () => {
    vi.spyOn(flint, "aiStatus").mockResolvedValue(status(false));
    navStore.getState().openCategory("notifications");
    await mount();
    expect(screen.queryByRole("button", { name: /summarize/i })).toBeNull();
  });
});
