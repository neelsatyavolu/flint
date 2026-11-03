import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Account } from "@flint/core";
import { flint } from "../../../lib/api";
import { ServerEditor } from "./ServerEditor";

const account = async (): Promise<Account> => ({
  ...(await flint.listAccounts())[0]!,
  authKind: "password", imapHost: "127.0.0.1", imapPort: 1143, imapSecure: false, smtpHost: "127.0.0.1", smtpPort: 1025, smtpSecure: false,
});

describe("ServerEditor", () => {
  it("shows Save only once something changed, and saves the new port", async () => {
    const onSave = vi.fn(async () => true);
    render(<ServerEditor account={await account()} onSave={onSave} />);
    expect(screen.queryByRole("button", { name: "Save servers" })).toBeNull();

    fireEvent.change(screen.getByLabelText("IMAP port"), { target: { value: "1144" } });
    fireEvent.click(screen.getByRole("button", { name: "Save servers" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ imapPort: 1144, smtpPort: 1025, imapHost: "127.0.0.1" }));
  });

  it("can't save an empty port, and Cancel puts the saved values back", async () => {
    render(<ServerEditor account={await account()} onSave={vi.fn(async () => true)} />);
    const port = screen.getByLabelText("SMTP port") as HTMLInputElement;
    fireEvent.change(port, { target: { value: "" } });
    expect((screen.getByRole("button", { name: "Save servers" }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(port.value).toBe("1025");
    expect(screen.queryByRole("button", { name: "Save servers" })).toBeNull();
  });
});
