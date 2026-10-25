import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { shortcuts } from "../../lib/shortcuts";
import { ToastProvider } from "../../ui";
import { SettingsView } from "./SettingsView";
import { parseSection } from "./sections";

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
});

describe("SettingsView", () => {
  it("opens the requested section and switches from the nav", async () => {
    mount({ section: "shortcuts" });
    expect(await screen.findByRole("region", { name: "Shortcuts" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "About" }));
    expect(await screen.findByText("Flint is free. No account, no tracking of you.")).toBeTruthy();
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
    fireEvent.click(await screen.findByRole("button", { name: "Add to all agents" }));
    expect(await screen.findByText(/Added for Claude Code; Codex, Gemini CLI, Copilot CLI and OpenCode; Grok\./)).toBeTruthy();
    expect(screen.getAllByText("Added")).toHaveLength(3);
    expect(screen.getAllByText("Not on this Mac")).toHaveLength(3);
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(await screen.findByRole("button", { name: "Add to all agents" })).toBeTruthy();
  });
});
