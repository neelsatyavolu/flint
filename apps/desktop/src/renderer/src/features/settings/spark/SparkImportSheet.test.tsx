import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { SparkSignatureScan } from "@flint/core";
import { FlintError } from "@flint/core/types";
import { flint } from "../../../lib/api";
import { ToastProvider } from "../../../ui";
import { SparkImportSheet } from "./SparkImportSheet";

afterEach(() => vi.restoreAllMocks());

const scan: SparkSignatureScan = {
  path: "/spark/settings.sqlite",
  signatures: [
    { sparkId: "A", name: "Alex Rivera", html: "<div>Alex Rivera</div>", accounts: ["a@x.co"], modifiedAt: Date.UTC(2026, 9, 3, 12), matches: [{ accountId: "acc1", email: "a@x.co" }, { accountId: "acc2", email: "b@x.co" }] },
    { sparkId: "B", name: "Thanks, Alex", html: "<div>Thanks</div>", accounts: [], modifiedAt: 0, matches: [] },
  ],
};

const mount = (onClose = () => {}, onImported = vi.fn()) =>
  render(<ToastProvider><SparkImportSheet open onClose={onClose} onImported={onImported} /></ToastProvider>);

describe("SparkImportSheet", () => {
  it("lists the signatures selected, with Spark's default accounts pre-selected", async () => {
    vi.spyOn(flint, "findSparkSignatures").mockResolvedValue(scan);
    mount();
    expect(await screen.findByRole("button", { name: "Import 2 signatures" })).toBeTruthy();
    expect(screen.getByText("Edited Oct 3, 2026")).toBeTruthy();
    const chips = within(screen.getByRole("group", { name: "Default for" }));
    expect(chips.getByRole("button", { name: "a@x.co" }).getAttribute("aria-pressed")).toBe("true");
    expect(chips.getByRole("button", { name: "b@x.co" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("imports only the checked rows, with the new name and toggled defaults", async () => {
    vi.spyOn(flint, "findSparkSignatures").mockResolvedValue(scan);
    const imp = vi.spyOn(flint, "importSparkSignatures").mockResolvedValue([{ id: 7, name: "Work", html: "", accountId: null, defaultNew: false, defaultReply: false }]);
    const onImported = vi.fn();
    const onClose = vi.fn();
    mount(onClose, onImported);
    await screen.findByRole("button", { name: "Import 2 signatures" });

    fireEvent.click(screen.getByRole("checkbox", { name: "Import Thanks, Alex" }));
    expect(screen.getByRole("button", { name: "Import 1 signature" })).toBeTruthy();
    fireEvent.change(screen.getAllByLabelText("Signature name")[0]!, { target: { value: "Work" } });
    fireEvent.click(screen.getByRole("button", { name: "b@x.co" }));
    fireEvent.click(screen.getByRole("button", { name: "Import 1 signature" }));

    await waitFor(() => expect(imp).toHaveBeenCalledTimes(1));
    expect(imp).toHaveBeenCalledWith({ path: "/spark/settings.sqlite", items: [{ sparkId: "A", name: "Work", setDefaultFor: ["acc1"] }] });
    expect(await screen.findByText("Imported 1 signature from Spark. Set as the default for new mail and replies on a@x.co.")).toBeTruthy();
    expect(onImported).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("disables import when nothing is checked", async () => {
    vi.spyOn(flint, "findSparkSignatures").mockResolvedValue(scan);
    mount();
    await screen.findByRole("button", { name: "Import 2 signatures" });
    fireEvent.click(screen.getByRole("checkbox", { name: "Import Alex Rivera" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Import Thanks, Alex" }));
    expect((screen.getByRole("button", { name: "Import signatures" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("says quietly that Spark isn't installed", async () => {
    vi.spyOn(flint, "findSparkSignatures").mockResolvedValue(null);
    mount();
    expect(await screen.findByText(/Spark isn't installed on this Mac/)).toBeTruthy();
  });

  it("shows the permission message and lets the user choose a file instead", async () => {
    const find = vi.spyOn(flint, "findSparkSignatures").mockRejectedValueOnce(new FlintError("permission", "macOS blocked Flint from reading Spark's settings."));
    mount();
    expect((await screen.findByRole("alert")).textContent).toContain("macOS blocked Flint");
    find.mockResolvedValue(scan);
    const file = new File(["x"], "settings.sqlite");
    fireEvent.change(screen.getByLabelText("Spark settings file"), { target: { files: [file] } });
    await waitFor(() => expect(find).toHaveBeenLastCalledWith("settings.sqlite"));
    expect(await screen.findByRole("button", { name: "Import 2 signatures" })).toBeTruthy();
  });
});
