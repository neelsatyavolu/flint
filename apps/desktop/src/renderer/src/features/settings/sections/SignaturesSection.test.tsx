import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { Account, Settings, Signature } from "@flint/core";
import { flint } from "../../../lib/api";
import { ToastProvider } from "../../../ui";
import { defaultSettings, makeAccounts } from "../../../mock/fixtures";
import { mergeSettings, SettingsProvider } from "../settingsStore";
import { SignaturesSection } from "./SignaturesSection";

afterEach(() => vi.restoreAllMocks());

const sig = (id: number, html: string): Signature => ({ id, name: `Sig ${id}`, html, accountIds: [], defaultNew: false, defaultReply: false });
const SPARK = '<p style="font-family: Calibri; font-size: 11pt; color: #333">Alex Rivera</p>';

function mount(list: Signature[]) {
  vi.spyOn(flint, "listSignatures").mockResolvedValue(list);
  const save = vi.spyOn(flint, "saveSignature").mockImplementation(async (s) => ({ ...s, id: s.id ?? 99 }) as Signature);
  render(<ToastProvider><SettingsProvider><SignaturesSection /></SettingsProvider></ToastProvider>);
  return save;
}

describe("Signatures page", () => {
  it("offers one button that removes Spark's fonts from every signature that has them", async () => {
    const save = mount([sig(1, SPARK), sig(2, "<p>Clean</p>"), sig(3, '<p style="font-size:9pt">Other</p>')]);
    const button = await screen.findByRole("button", { name: "Use Flint's font on 2 signatures" });
    fireEvent.click(button);
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    const saved = save.mock.calls.map(([s]) => s);
    expect(saved.map((s) => s.id).sort()).toEqual([1, 3]);
    for (const s of saved) expect(s.html).not.toMatch(/font-family|font-size/);
    expect(saved.find((s) => s.id === 1)!.html).toContain("color:#333");
  });

  it("hides the button once nothing carries a font", async () => {
    mount([sig(1, "<p>Clean</p>")]);
    await screen.findAllByText("Sig 1");
    expect(screen.queryByRole("button", { name: /Use Flint's font on/ })).toBeNull();
  });
});

const accountsOf = (): Account[] => makeAccounts(0);

function mountWith(list: Signature[], settings: Settings = defaultSettings()) {
  const accounts = accountsOf();
  vi.spyOn(flint, "listAccounts").mockResolvedValue(accounts);
  vi.spyOn(flint, "getSettings").mockResolvedValue(settings);
  let current = settings;
  const update = vi.spyOn(flint, "updateSettings").mockImplementation(async (patch) => (current = mergeSettings(current, patch)));
  const save = mount(list);
  return { accounts, save, update };
}

const scoped = (id: number, accountIds: string[], name = `Sig ${id}`): Signature => ({ ...sig(id, "<p>Hi</p>"), name, accountIds });

describe("Signatures page, shared accounts", () => {
  it("shows All accounts, one address, or a count under each signature", async () => {
    const { accounts } = mountWith([scoped(1, []), scoped(2, [accountsOf()[0]!.id]), scoped(3, [accountsOf()[0]!.id, accountsOf()[1]!.id])]);
    await screen.findAllByText("Sig 3");
    const rowOf = (title: string) => screen.getAllByText(title).find((el) => el.tagName !== "OPTION")!.parentElement!;
    expect(rowOf("Sig 1").textContent).toContain("All accounts");
    expect(rowOf("Sig 2").textContent).toContain(accounts[0]!.email);
    expect(rowOf("Sig 3").textContent).toContain("2 accounts");
  });

  it("edits Use with: pick specific accounts, and unticking them all goes back to All accounts", async () => {
    const { accounts, save } = mountWith([scoped(1, [])]);
    const group = await screen.findByRole("group", { name: "Use with" });
    const all = within(group).getByRole("checkbox", { name: "All accounts" }) as HTMLInputElement;
    expect(all.checked).toBe(true);
    fireEvent.click(within(group).getByRole("checkbox", { name: accounts[0]!.email }));
    fireEvent.click(within(group).getByRole("checkbox", { name: accounts[1]!.email }));
    expect(all.checked).toBe(false);
    const saveButton = screen.getByRole("button", { name: "Save" }) as HTMLButtonElement;
    await waitFor(() => expect(saveButton.disabled).toBe(false));
    fireEvent.click(saveButton);
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0]![0].accountIds).toEqual([accounts[0]!.id, accounts[1]!.id]);
    fireEvent.click(within(group).getByRole("checkbox", { name: accounts[0]!.email }));
    fireEvent.click(within(group).getByRole("checkbox", { name: accounts[1]!.email }));
    expect(all.checked).toBe(true);
  });

  it("lists every signature in the default pickers and adds the account to one it isn't available for", async () => {
    const { accounts, save, update } = mountWith([scoped(1, [accountsOf()[1]!.id], "Only second"), scoped(2, [], "Everyone")]);
    const picker = await screen.findByRole("combobox", { name: `New mail signature for ${accounts[0]!.email}` });
    const options = within(picker).getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual(expect.arrayContaining(["None", "Only second", "Everyone"]));
    fireEvent.change(picker, { target: { value: "1" } });
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0]![0]).toMatchObject({ id: 1, accountIds: [accounts[1]!.id, accounts[0]!.id] });
    await waitFor(() => expect(update).toHaveBeenCalledWith({ compose: { defaultSignatureByAccount: { [accounts[0]!.id]: 1 } } }));
  });

  it("does not rewrite a signature that already applies, keeps None as a choice, and titles the picker with the full name", async () => {
    const long = "A very long signature name that will not fit in the picker";
    const { accounts, save, update } = mountWith([scoped(1, [], long)]);
    const picker = (await screen.findByRole("combobox", { name: `Replies signature for ${accounts[0]!.email}` })) as HTMLSelectElement;
    fireEvent.change(picker, { target: { value: "1" } });
    await waitFor(() => expect(update).toHaveBeenCalledWith({ compose: { defaultReplySignatureByAccount: { [accounts[0]!.id]: 1 } } }));
    expect(save).not.toHaveBeenCalled();
    await waitFor(() => expect(picker.title).toBe(long));
    fireEvent.change(picker, { target: { value: "none" } });
    await waitFor(() => expect(update).toHaveBeenCalledWith({ compose: { defaultReplySignatureByAccount: { [accounts[0]!.id]: null } } }));
  });
});
