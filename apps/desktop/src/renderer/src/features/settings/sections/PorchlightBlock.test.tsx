import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { FlintError, type FlintEvent, type PorchlightStatus } from "@flint/core/types";
import { flint } from "../../../lib/api";
import { PorchlightBlock } from "./PorchlightBlock";

const openExternal = vi.fn();
vi.mock("../../../lib/host", () => ({ openExternal: (url: string) => openExternal(url) }));

const off: PorchlightStatus = { connection: null, imported: 0, pending: 0, lastImportAt: null };
const on: PorchlightStatus = { connection: { label: "Flint on Studio", account: "n•••@xanom.co", pairedAt: 1, signedOut: false }, imported: 3, pending: 1, lastImportAt: null };
let emit: (e: FlintEvent) => void = () => undefined;

beforeEach(() => {
  openExternal.mockReset();
  vi.spyOn(flint, "porchlightStatus").mockResolvedValue(off);
  vi.spyOn(flint, "pairPorchlight").mockResolvedValue(on);
  vi.spyOn(flint, "disconnectPorchlight").mockResolvedValue({ revoked: false });
  vi.spyOn(flint, "subscribe").mockImplementation((cb) => { emit = cb; return () => undefined; });
});
afterEach(() => vi.restoreAllMocks());

const showCodeField = async () => fireEvent.click(await screen.findByText("Use a code instead"));

describe("Porchlight in Settings", () => {
  it("connects with one button that opens Porchlight in the browser", async () => {
    render(<PorchlightBlock />);
    fireEvent.click(await screen.findByRole("button", { name: "Connect Porchlight" }));
    expect(openExternal).toHaveBeenCalledWith("https://porchlight.xanom.co/app/connect/flint");
    expect(flint.pairPorchlight).not.toHaveBeenCalled();
  });

  it("shows the connection as soon as Flint pairs from a link", async () => {
    render(<PorchlightBlock />);
    await screen.findByRole("button", { name: "Connect Porchlight" });
    act(() => emit({ type: "porchlight", status: on }));
    expect(await screen.findByText("Connected to n•••@xanom.co")).toBeTruthy();
    expect(screen.getByText("Flint on Studio")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Disconnect" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Connect Porchlight" })).toBeNull();
  });

  it("still pairs with a typed code under “Use a code instead”", async () => {
    render(<PorchlightBlock />);
    await showCodeField();
    const connect = screen.getByRole("button", { name: "Connect with code" });
    expect((connect as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Porchlight code"), { target: { value: "abcd-efgh" } });
    fireEvent.click(connect);
    expect(flint.pairPorchlight).toHaveBeenCalledWith("abcd-efgh");
    expect(await screen.findByText("Flint on Studio")).toBeTruthy();
    expect(screen.getByText(/3 packages sent · 1 waiting/)).toBeTruthy();
    expect(screen.queryByLabelText("Porchlight code")).toBeNull();
  });

  it("shows why pairing with a code failed", async () => {
    vi.mocked(flint.pairPorchlight).mockRejectedValue(new FlintError("invalid", "That code didn't work."));
    render(<PorchlightBlock />);
    await showCodeField();
    fireEvent.change(screen.getByLabelText("Porchlight code"), { target: { value: "ABCDEFGH" } });
    fireEvent.click(screen.getByRole("button", { name: "Connect with code" }));
    expect((await screen.findByRole("alert")).textContent).toBe("That code didn't work.");
  });

  it("disconnects and says where to remove the token when Porchlight couldn't be told", async () => {
    vi.mocked(flint.porchlightStatus).mockResolvedValueOnce(on).mockResolvedValue(off);
    render(<PorchlightBlock />);
    fireEvent.click(await screen.findByRole("button", { name: "Disconnect" }));
    expect((await screen.findByRole("status")).textContent).toContain("delete “Flint on Studio” in Porchlight Settings");
    expect(flint.disconnectPorchlight).toHaveBeenCalled();
  });

  it("offers to connect again after Porchlight signs this Mac out", async () => {
    vi.mocked(flint.porchlightStatus).mockResolvedValue({ ...on, connection: { ...on.connection!, signedOut: true } });
    render(<PorchlightBlock />);
    expect(await screen.findByText("Porchlight signed this Mac out. Connect again to resume.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Connect Porchlight" })).toBeTruthy();
  });
});
