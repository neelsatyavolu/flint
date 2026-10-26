import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { shortcuts } from "../../lib/shortcuts";
import { navStore, useNav } from "../../state/nav";
import { ToastProvider } from "../../ui";
import { SettingsView } from "./SettingsView";
import { SECTIONS, filterSections, parseSection } from "./sections";
import { accountPage } from "./sections/AccountsSection";
import { stepTextSize } from "./sections/AppearanceSection";

const mount = (props: { section?: string; onClose?: () => void }) =>
  render(<ToastProvider><SettingsView section={props.section} onClose={props.onClose ?? (() => {})} /></ToastProvider>);

describe("parseSection", () => {
  it("handles deep links and unknown ids", () => {
    expect(parseSection("rules")).toEqual({ id: "rules" });
    expect(parseSection("ai/writing")).toEqual({ id: "ai", page: "writing" });
    expect(parseSection("+AI")).toEqual({ id: "ai" });
    expect(parseSection("nope")).toEqual({ id: "general" });
    expect(parseSection(undefined)).toEqual({ id: "general" });
  });

  it("keeps the account id's case in account deep links", () => {
    expect(parseSection("accounts/AbC_x-12/reauth")).toEqual({ id: "accounts", page: "AbC_x-12/reauth" });
    expect(parseSection("Accounts/AbC_x-12/REAUTH")).toEqual({ id: "accounts", page: "AbC_x-12/reauth" });
    expect(parseSection("accounts/AbC_x-12")).toEqual({ id: "accounts", page: "AbC_x-12" });
    expect(parseSection("accounts")).toEqual({ id: "accounts" });
  });
});

describe("accountPage", () => {
  it("reads the account and whether to sign in again", () => {
    expect(accountPage("AbC/reauth")).toEqual({ accountId: "AbC", reauth: true });
    expect(accountPage("AbC")).toEqual({ accountId: "AbC", reauth: false });
    expect(accountPage(undefined)).toBeNull();
  });
});

describe("filterSections", () => {
  it("matches labels and keywords, every word, ignoring case", () => {
    const ids = (q: string) => filterSections(SECTIONS, q).map((s) => s.id);
    expect(ids("")).toHaveLength(SECTIONS.length);
    expect(ids("RUL")).toEqual(["rules"]);
    expect(ids("theme")).toEqual(["appearance"]);
    expect(ids("dark theme")).toEqual(["appearance"]);
    expect(ids("chatgpt")).toEqual(["ai"]);
    expect(ids("zzz")).toEqual([]);
  });
});

describe("SettingsView", () => {
  it("opens the requested section and switches from the nav", async () => {
    mount({ section: "shortcuts" });
    expect(await screen.findByRole("region", { name: "Shortcuts" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "About" }));
    expect(await screen.findByText("Flint is free. No account, no tracking of you.")).toBeTruthy();
  });

  it("Appearance's Text size follows View > Zoom", async () => {
    mount({ section: "appearance" });
    const group = await screen.findByRole("radiogroup", { name: "Text size" });
    const checked = () => group.querySelector('[aria-checked="true"]')?.textContent;
    expect(checked()).toBe("Default");
    act(() => stepTextSize(1));
    expect(checked()).toBe("Large");
    act(() => stepTextSize(0));
    expect(checked()).toBe("Default");
    window.localStorage.clear();
  });

  it("General lets the user pick how much mail is kept locally", async () => {
    mount({ section: "general" });
    expect(await screen.findByText("Mail kept on this computer")).toBeTruthy();
    expect(screen.getByText(/Older mail loads when you reach the end/)).toBeTruthy();
  });

  it("opens a +AI sub-page", async () => {
    mount({ section: "ai/writing" });
    expect(await screen.findByText("Smart replies")).toBeTruthy();
  });

  it("closes from the button and from Escape", () => {
    const onClose = vi.fn();
    mount({ onClose });
    fireEvent.click(screen.getByRole("button", { name: "Close settings" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    shortcuts.dispatch(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("filters the nav; Enter opens the first match and Esc clears, then closes", async () => {
    const onClose = vi.fn();
    mount({ onClose });
    const filter = screen.getByRole("searchbox", { name: "Filter settings" });
    fireEvent.change(filter, { target: { value: "theme" } });
    expect(screen.getByRole("button", { name: "Appearance" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Rules" })).toBeNull();
    fireEvent.keyDown(filter, { key: "Enter" });
    expect(await screen.findByRole("region", { name: "Appearance" })).toBeTruthy();
    fireEvent.keyDown(filter, { key: "Escape" });
    expect((filter as HTMLInputElement).value).toBe("");
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(filter, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("opens Sign in again for an account from accounts/<id>/reauth", async () => {
    mount({ section: "accounts/acc_orbit/reauth" });
    expect(await screen.findByRole("dialog", { name: "Sign in again" })).toBeTruthy();
    // The modal hides the page behind it from the accessibility tree, hence hidden: true. Only that account is expanded.
    expect(screen.getAllByRole("button", { name: /hide details$/, hidden: true })).toHaveLength(1);
  });

  it("opens Sign in again a second time when the banner sends the same link again", async () => {
    // Wired like AppShell: the section comes from the nav store, which is cleared once Settings reads it.
    function Shell() {
      const section = useNav((s) => s.settingsSection);
      return <ToastProvider><SettingsView section={section} onClose={() => {}} onSectionRead={() => navStore.setState({ settingsSection: undefined })} /></ToastProvider>;
    }
    const link = "accounts/acc_orbit/reauth";
    navStore.getState().openSettings(link);
    render(<Shell />);
    const cancel = async () => {
      fireEvent.click(within(await screen.findByRole("dialog", { name: "Sign in again" })).getByRole("button", { name: "Cancel" }));
      await waitFor(() => expect(screen.queryByRole("dialog", { name: "Sign in again" })).toBeNull());
    };
    await cancel();
    act(() => navStore.getState().openSettings(link));
    await cancel();
    // Moved away with the left nav, the same link brings the page and the dialog back.
    fireEvent.click(screen.getByRole("button", { name: "About" }));
    act(() => navStore.getState().openSettings(link));
    expect(await screen.findByRole("dialog", { name: "Sign in again" })).toBeTruthy();
    act(() => navStore.getState().closeSettings());
  });

  it("renders every section without errors", async () => {
    mount({});
    for (const name of ["General", "Accounts", "Appearance", "Inbox", "Signatures", "Templates", "Rules", "Read Receipts", "Notifications", "+AI", "Agents", "Shortcuts", "Blocked", "About"]) {
      fireEvent.click(screen.getByRole("button", { name }));
      expect(await screen.findByRole("region", { name })).toBeTruthy();
    }
  });
});

describe("Agents: skill for AI agents", () => {
  it("adds the flint skill to every agent found and lists where it went", async () => {
    mount({ section: "agents" });
    // The button exists before the skill status loads but stays disabled until then; clicking early does nothing.
    const add = await screen.findByRole("button", { name: "Add to all agents" });
    await waitFor(() => expect((add as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(add);
    expect(await screen.findByText(/Added for Claude Code; Codex, Gemini CLI, Copilot CLI and OpenCode; Grok\./)).toBeTruthy();
    expect(screen.getAllByText("Added")).toHaveLength(3);
    expect(screen.getAllByText("Not on this Mac")).toHaveLength(3);
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(await screen.findByRole("button", { name: "Add to all agents" })).toBeTruthy();
  });
});
