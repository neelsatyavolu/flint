import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { FlintError, type PorchlightStatus } from "@flint/core/types";
import { flint } from "../../../lib/api";
import { PorchlightBlock } from "./PorchlightBlock";

const off: PorchlightStatus = { connection: null, imported: 0, pending: 0, lastImportAt: null };
const on: PorchlightStatus = { connection: { label: "Flint on Studio", pairedAt: 1, signedOut: false }, imported: 3, pending: 1, lastImportAt: null };

beforeEach(() => {
  vi.spyOn(flint, "porchlightStatus").mockResolvedValue(off);
  vi.spyOn(flint, "pairPorchlight").mockResolvedValue(on);
  vi.spyOn(flint, "disconnectPorchlight").mockResolvedValue({ revoked: false });
});
afterEach(() => vi.restoreAllMocks());

describe("Porchlight in Settings", () => {
  it("pairs with the code from Porchlight and shows what was sent", async () => {
    render(<PorchlightBlock />);
    const connect = await screen.findByRole("button", { name: "Connect Porchlight" });
    expect((connect as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Porchlight code"), { target: { value: "abcd-efgh" } });
    fireEvent.click(connect);
    expect(flint.pairPorchlight).toHaveBeenCalledWith("abcd-efgh");
    expect(await screen.findByText("Flint on Studio")).toBeTruthy();
    expect(screen.getByText(/3 packages sent · 1 waiting/)).toBeTruthy();
    expect(screen.queryByLabelText("Porchlight code")).toBeNull();
  });

  it("shows why pairing failed", async () => {
    vi.mocked(flint.pairPorchlight).mockRejectedValue(new FlintError("invalid", "That code didn't work."));
    render(<PorchlightBlock />);
    fireEvent.change(await screen.findByLabelText("Porchlight code"), { target: { value: "ABCDEFGH" } });
    fireEvent.click(screen.getByRole("button", { name: "Connect Porchlight" }));
    expect((await screen.findByRole("alert")).textContent).toBe("That code didn't work.");
  });

  it("disconnects and says where to remove the token when Porchlight couldn't be told", async () => {
    vi.mocked(flint.porchlightStatus).mockResolvedValueOnce(on).mockResolvedValue(off);
    render(<PorchlightBlock />);
    fireEvent.click(await screen.findByRole("button", { name: "Disconnect" }));
    expect((await screen.findByRole("status")).textContent).toContain("delete “Flint on Studio” in Porchlight Settings");
    expect(flint.disconnectPorchlight).toHaveBeenCalled();
  });

  it("asks for a new code after Porchlight signs this Mac out", async () => {
    vi.mocked(flint.porchlightStatus).mockResolvedValue({ ...on, connection: { ...on.connection!, signedOut: true } });
    render(<PorchlightBlock />);
    expect(await screen.findByText("Porchlight signed this Mac out. Enter a new code to resume.")).toBeTruthy();
    expect(screen.getByLabelText("Porchlight code")).toBeTruthy();
  });
});
