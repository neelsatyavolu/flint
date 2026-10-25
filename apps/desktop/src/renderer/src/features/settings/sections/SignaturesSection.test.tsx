import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Signature } from "@flint/core";
import { flint } from "../../../lib/api";
import { ToastProvider } from "../../../ui";
import { SettingsProvider } from "../settingsStore";
import { SignaturesSection } from "./SignaturesSection";

afterEach(() => vi.restoreAllMocks());

const sig = (id: number, html: string): Signature => ({ id, name: `Sig ${id}`, html, accountId: null, defaultNew: false, defaultReply: false });
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
