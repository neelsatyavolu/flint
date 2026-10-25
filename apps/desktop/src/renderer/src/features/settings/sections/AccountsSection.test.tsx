import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { flint } from "../../../lib/api";
import { ToastProvider } from "../../../ui";
import { AliasEditor } from "../accounts/AliasEditor";
import { AccountsSection } from "./AccountsSection";
import { RulesSection } from "./RulesSection";
import { SettingsProvider } from "../settingsStore";

afterEach(() => vi.restoreAllMocks());
const wrap = (ui: React.ReactNode) => render(<ToastProvider><SettingsProvider>{ui}</SettingsProvider></ToastProvider>);

describe("AccountsSection", () => {
  it("lists accounts, toggles sync and removes after confirmation", async () => {
    const update = vi.spyOn(flint, "updateAccount");
    const remove = vi.spyOn(flint, "removeAccount");
    wrap(<AccountsSection />);
    const toggle = (await screen.findAllByRole("switch"))[0]!;
    fireEvent.click(toggle);
    await waitFor(() => expect(update).toHaveBeenCalledWith(expect.any(String), { enabled: false }));
    fireEvent.click(screen.getAllByRole("button", { expanded: false })[0]!);
    fireEvent.click(await screen.findByRole("button", { name: "Remove account" }));
    expect(remove).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: "Remove" }));
    await waitFor(() => expect(remove).toHaveBeenCalledTimes(1));
  });

  it("turns an account's unified inbox switch off and on", async () => {
    const update = vi.spyOn(flint, "updateAccount");
    wrap(<AccountsSection />);
    fireEvent.click((await screen.findAllByRole("button", { expanded: false }))[0]!);
    const toggle = await screen.findByRole("switch", { name: /in the unified inbox/ });
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(toggle);
    await waitFor(() => expect(update).toHaveBeenCalledWith(expect.any(String), { showInUnified: false }));
  });

  it("offers Sign in again for an expired account and Google accounts use addGoogleAccount", async () => {
    const accounts = await flint.listAccounts();
    const g = { ...accounts[0]!, authKind: "oauth_google" as const };
    vi.spyOn(flint, "listAccounts").mockResolvedValue([g]);
    vi.spyOn(flint, "getSyncStatus").mockResolvedValue([{ accountId: g.id, state: "auth_error" }]);
    const google = vi.spyOn(flint, "addGoogleAccount").mockResolvedValue(g);
    wrap(<AccountsSection />);
    expect(await screen.findByText(/Sign-in expired/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    fireEvent.click(await screen.findByRole("button", { name: "Sign in again" }));
    await waitFor(() => expect(google).toHaveBeenCalled());
  });

  it("asks for the password again on a password account", async () => {
    const accounts = await flint.listAccounts();
    const p = { ...accounts[0]!, authKind: "password" as const, provider: "imap" as const };
    vi.spyOn(flint, "listAccounts").mockResolvedValue([p]);
    vi.spyOn(flint, "getSyncStatus").mockResolvedValue([{ accountId: p.id, state: "auth_error" }]);
    wrap(<AccountsSection />);
    fireEvent.click(await screen.findByRole("button", { expanded: false }));
    fireEvent.click(await screen.findByRole("button", { name: "Sign in again" }));
    expect(await screen.findByText("Using the saved servers")).toBeTruthy();
    expect((screen.getByLabelText("Email") as HTMLInputElement).value).toBe(p.email);
  });
});

describe("AliasEditor", () => {
  it("adds, rejects and removes aliases", () => {
    const onChange = vi.fn();
    render(<AliasEditor own="me@x.com" aliases={["a@x.com"]} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Add an alias"), { target: { value: "bad" } });
    fireEvent.click(screen.getByRole("button", { name: "Add alias" }));
    expect(screen.getByRole("alert").textContent).toMatch(/full email/);
    fireEvent.change(screen.getByLabelText("Add an alias"), { target: { value: "b@x.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Add alias" }));
    expect(onChange).toHaveBeenCalledWith(["a@x.com", "b@x.com"]);
    fireEvent.click(screen.getByRole("button", { name: "Remove a@x.com" }));
    expect(onChange).toHaveBeenCalledWith([]);
  });
});

describe("RulesSection", () => {
  it("toggles a rule, applies to existing mail and opens the editor", async () => {
    const save = vi.spyOn(flint, "saveRule");
    const apply = vi.spyOn(flint, "applyRules");
    wrap(<RulesSection />);
    const toggles = await screen.findAllByRole("switch");
    fireEvent.click(toggles[0]!);
    await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ enabled: false })));
    fireEvent.click(screen.getByRole("button", { name: "Apply to existing mail" }));
    await waitFor(() => expect(apply).toHaveBeenCalled());
    expect(await screen.findByText(/Updated 3 threads/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "New rule" }));
    expect(screen.getByRole("button", { name: "Save rule" })).toBeTruthy();
  });

  it("swaps order with the neighbour", async () => {
    const save = vi.spyOn(flint, "saveRule");
    wrap(<RulesSection />);
    await screen.findAllByRole("switch");
    fireEvent.click(screen.getAllByRole("button", { name: "Move down" })[0]!);
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
  });
});
