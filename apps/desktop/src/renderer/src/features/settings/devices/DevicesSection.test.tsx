import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { PairingUiEvent } from "@flint/core/pairing/controller";
import { ToastProvider } from "../../../ui";
import { DevicesSection } from "./DevicesSection";

type Listener = (e: PairingUiEvent) => void;

function installHost(devices = [{ deviceName: "Old iPhone", pairedAt: 1_700_000_000_000 }]) {
  let listener: Listener = () => undefined;
  const pairing = {
    start: vi.fn(async () => undefined),
    approve: vi.fn(async () => undefined),
    cancel: vi.fn(async () => undefined),
    devices: vi.fn(async () => devices),
    forget: vi.fn(async () => []),
    onEvent: vi.fn((cb: Listener) => { listener = cb; return () => undefined; }),
  };
  (window as unknown as { flintHost: unknown }).flintHost = { platform: "darwin", pairing };
  return { pairing, emit: (e: PairingUiEvent) => act(() => listener(e)) };
}

const mount = () => render(<ToastProvider><DevicesSection /></ToastProvider>);

beforeEach(() => { (window as unknown as { flintHost?: unknown }).flintHost = undefined; });
afterEach(() => { (window as unknown as { flintHost?: unknown }).flintHost = undefined; });

describe("DevicesSection", () => {
  it("lists paired devices and removes one", async () => {
    const { pairing } = installHost();
    mount();
    await screen.findByText("Old iPhone");
    fireEvent.click(screen.getByRole("button", { name: "Remove Old iPhone from this list" }));
    await waitFor(() => expect(pairing.forget).toHaveBeenCalledWith(1_700_000_000_000));
    await screen.findByText("No iPhones set up yet.");
  });

  it("says pairing needs the Mac app when the host has none", () => {
    mount();
    expect(screen.getByText(/works in the Flint app for Mac/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Show code" })).toBeNull();
  });

  it("shows the code, asks for approval with the password choice, and sends it", async () => {
    const { pairing, emit } = installHost([]);
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Show code" }));
    await waitFor(() => expect(pairing.start).toHaveBeenCalledTimes(1));
    emit({ type: "listening", svg: "<svg xmlns='http://www.w3.org/2000/svg'/>", expiresAt: Date.now() + 120_000, addrs: ["192.168.1.20"] });
    expect(await screen.findByAltText("Pairing code for your iPhone")).toBeTruthy();
    expect(screen.getByText(/192\.168\.1\.20/)).toBeTruthy();
    emit({ type: "approval", deviceName: "Neel's iPhone", sas: "482 913", passwordAccounts: 2 });
    await screen.findByText("Pair with Neel's iPhone?");
    expect(screen.getByLabelText("Code 482 913")).toBeTruthy();
    const box = screen.getByRole("checkbox", { name: "Include passwords for 2 accounts" }) as HTMLInputElement;
    expect(box.checked).toBe(true);
    fireEvent.click(box);
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(pairing.approve).toHaveBeenCalledWith(false);
    emit({ type: "done", deviceName: "Neel's iPhone", counts: { accounts: 2, signatures: 1, templates: 0, rules: 12, blockedSenders: 0 } });
    await screen.findByText("Added 2 accounts, 1 signature, 12 rules.");
  });

  it("hides the password option when no account has one, and says Google accounts are not sent", async () => {
    const { emit } = installHost([]);
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Show code" }));
    emit({ type: "approval", deviceName: "Phone", sas: "000 123", passwordAccounts: 0 });
    await screen.findByText("Pair with Phone?");
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.getByText(/Google accounts are never sent/)).toBeTruthy();
  });

  it("cancels the session when the dialog is cancelled, and offers a new code after an expiry", async () => {
    const { pairing, emit } = installHost([]);
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Show code" }));
    emit({ type: "closed", reason: "expired", bundleSent: false });
    fireEvent.click(await screen.findByRole("button", { name: "Show new code" }));
    await waitFor(() => expect(pairing.start).toHaveBeenCalledTimes(2));
    emit({ type: "listening", svg: "<svg/>", expiresAt: Date.now() + 60_000, addrs: ["10.0.0.5"] });
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(pairing.cancel).toHaveBeenCalled());
  });
});
