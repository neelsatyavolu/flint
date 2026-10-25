import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Account } from "@flint/core";
import { flint } from "../../../lib/api";
import { ToastProvider } from "../../../ui";
import { AccountPhoto } from "./AccountPhoto";
import { squareCrop } from "./cropImage";

afterEach(() => vi.restoreAllMocks());

const account = async (over: Partial<Account> = {}): Promise<Account> => ({ ...(await flint.listAccounts())[0]!, ...over });
const mount = (a: Account, onChanged = vi.fn()) => render(<ToastProvider><AccountPhoto account={a} onChanged={onChanged} /></ToastProvider>);

describe("squareCrop", () => {
  it("centers the square on the shorter side", () => {
    expect(squareCrop(400, 200)).toEqual({ sx: 100, sy: 0, side: 200 });
    expect(squareCrop(200, 301)).toEqual({ sx: 0, sy: 50, side: 200 });
    expect(squareCrop(64, 64)).toEqual({ sx: 0, sy: 0, side: 64 });
  });
});

describe("AccountPhoto", () => {
  it("offers Choose photo, and Remove only for a custom photo", async () => {
    const { unmount } = mount(await account({ avatarSource: null }));
    expect(screen.getByRole("button", { name: "Choose photo" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Remove photo" })).toBeNull();
    unmount();
    mount(await account({ avatarSource: "custom" }));
    expect(screen.getByRole("button", { name: "Change photo" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Remove photo" })).toBeTruthy();
  });

  it("removes the photo through the api and reports the updated account", async () => {
    const a = await account({ avatarSource: "custom" });
    const updated = { ...a, avatarSource: null };
    const spy = vi.spyOn(flint, "setAccountAvatar").mockResolvedValue(updated);
    const onChanged = vi.fn();
    mount(a, onChanged);
    fireEvent.click(screen.getByRole("button", { name: "Remove photo" }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith(updated));
    expect(spy).toHaveBeenCalledWith(a.id, null);
  });

  it("shows an error when the picked file is not an image", async () => {
    const spy = vi.spyOn(flint, "setAccountAvatar");
    mount(await account());
    const input = screen.getByLabelText(/Choose a photo for/) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(["x"], "notes.txt", { type: "text/plain" })] } });
    expect((await screen.findByRole("alert")).textContent).toMatch(/Choose an image/);
    expect(spy).not.toHaveBeenCalled();
  });
});
