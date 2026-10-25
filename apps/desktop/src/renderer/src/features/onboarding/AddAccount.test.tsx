import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Account } from "@flint/core";
import { flint } from "../../lib/api";
import { AddAccount } from "./AddAccount";

afterEach(() => vi.restoreAllMocks());

function fill(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

async function openOther() {
  fireEvent.click(screen.getByText("Other (IMAP)"));
  fill("Email", "sam@fastcomet.io");
  fill("Name", "Sam Lee");
  fill("Password", "secret");
}

describe("AddAccount", () => {
  it("shows the welcome copy", () => {
    render(<AddAccount welcome onDone={() => {}} />);
    expect(screen.getByText("Add your first account")).toBeTruthy();
  });

  it("detects servers on email blur and lets the user edit them", async () => {
    const spy = vi.spyOn(flint, "autoconfig");
    render(<AddAccount onDone={() => {}} />);
    await openOther();
    fireEvent.blur(screen.getByLabelText("Email"));
    expect(await screen.findByText("Servers found")).toBeTruthy();
    expect(spy).toHaveBeenCalledWith("sam@fastcomet.io");
    expect(screen.getByText(/imap\.fastcomet\.io:993 SSL/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Edit servers" }));
    expect((screen.getByLabelText("IMAP port") as HTMLInputElement).value).toBe("993");
  });

  it("opens the server fields when nothing is detected", async () => {
    vi.spyOn(flint, "autoconfig").mockResolvedValue(null);
    render(<AddAccount onDone={() => {}} />);
    await openOther();
    fireEvent.blur(screen.getByLabelText("Email"));
    expect(await screen.findByText(/Couldn't find the servers/)).toBeTruthy();
    expect(screen.getByLabelText("IMAP port")).toBeTruthy();
  });

  it("explains which server failed and does not add the account", async () => {
    vi.spyOn(flint, "testConnection").mockResolvedValue({ imap: "ok", smtp: "Authentication failed" });
    const add = vi.spyOn(flint, "addAccount");
    render(<AddAccount onDone={() => {}} />);
    await openOther();
    fireEvent.blur(screen.getByLabelText("Email"));
    await screen.findByText("Servers found");
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    expect(await screen.findByText(/Outgoing mail \(SMTP smtp\.fastcomet\.io\): Authentication failed\./)).toBeTruthy();
    expect(add).not.toHaveBeenCalled();
  });

  it("validates before connecting", async () => {
    const test = vi.spyOn(flint, "testConnection");
    render(<AddAccount onDone={() => {}} />);
    fireEvent.click(screen.getByText("Other (IMAP)"));
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    expect(await screen.findByText("Enter a full email address.")).toBeTruthy();
    expect(test).not.toHaveBeenCalled();
  });

  it("adds the account and reports it", async () => {
    const onDone = vi.fn<(a: Account) => void>();
    render(<AddAccount onDone={onDone} />);
    await openOther();
    fireEvent.blur(screen.getByLabelText("Email"));
    await screen.findByText("Servers found");
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(onDone.mock.calls[0]![0].email).toBe("sam@fastcomet.io");
    expect(screen.getByText(/Syncing your mail/)).toBeTruthy();
  });

  it("shows the setup panel when no Google client is saved, then saves it", async () => {
    const real = await flint.getSettings();
    vi.spyOn(flint, "getSettings").mockResolvedValue({ ...real, google: { clientId: "", clientSecret: "" } });
    const update = vi.spyOn(flint, "updateSettings");
    render(<AddAccount onDone={() => {}} />);
    fireEvent.click(screen.getByText("Sign in with Google"));
    expect(await screen.findByText(/Desktop app/)).toBeTruthy();
    expect(screen.getByText(/https:\/\/mail\.google\.com\//)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save and continue" }));
    expect(await screen.findByText(/ends in \.apps\.googleusercontent\.com/)).toBeTruthy();
    fill("Client ID", "1-a.apps.googleusercontent.com");
    fill("Client secret", "s");
    fireEvent.click(screen.getByRole("button", { name: "Save and continue" }));
    await waitFor(() => expect(update).toHaveBeenCalledWith({ google: { clientId: "1-a.apps.googleusercontent.com", clientSecret: "s" } }));
  });

  it("signs in with Google when a client exists", async () => {
    const real = await flint.getSettings();
    vi.spyOn(flint, "getSettings").mockResolvedValue({ ...real, google: { clientId: "1-a.apps.googleusercontent.com", clientSecret: "s" } });
    const onDone = vi.fn();
    render(<AddAccount onDone={onDone} />);
    fireEvent.click(screen.getByText("Sign in with Google"));
    fireEvent.click(await screen.findByRole("button", { name: "Sign in with Google" }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });
});
