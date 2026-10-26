import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { flint } from "./api";
import { resetAvatarImages, useAvatarImage } from "./avatarImages";

beforeEach(() => resetAvatarImages());
afterEach(() => vi.restoreAllMocks());

describe("useAvatarImage", () => {
  it("batches asks from several avatars into one call and caches the answer", async () => {
    const spy = vi.spyOn(flint, "getAvatars").mockImplementation(async (refs) =>
      Object.fromEntries(refs.map((r) => [r.kind === "account" ? `account:${r.accountId}` : `sender:${r.address.toLowerCase()}`, "data:image/png;base64,AAAA"])));
    // Both avatars mount in the same render, as rows of a list do, so they land in one batch however busy the machine is.
    const { result } = renderHook(() => ({
      a: useAvatarImage({ kind: "sender", address: "a@example.org" }),
      b: useAvatarImage({ kind: "account", accountId: "acc_x" }),
    }));
    expect(result.current.a).toBeNull();
    await waitFor(() => expect(result.current.a).toBe("data:image/png;base64,AAAA"));
    await waitFor(() => expect(result.current.b).toBe("data:image/png;base64,AAAA"));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0]).toHaveLength(2);
    const again = renderHook(() => useAvatarImage({ kind: "sender", address: "a@example.org" }));
    expect(again.result.current).toBe("data:image/png;base64,AAAA");
    await new Promise((r) => setTimeout(r, 50));
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("stays null with no ref, on a miss and on an error", async () => {
    const spy = vi.spyOn(flint, "getAvatars").mockRejectedValue(new Error("boom"));
    const none = renderHook(() => useAvatarImage(null));
    const miss = renderHook(() => useAvatarImage({ kind: "sender", address: "z@example.org" }));
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    expect(none.result.current).toBeNull();
    expect(miss.result.current).toBeNull();
  });

  it("does not look anything up when avatars are off", async () => {
    const real = await flint.getSettings();
    vi.spyOn(flint, "getSettings").mockResolvedValue({ ...real, appearance: { ...real.appearance, avatars: "off" } });
    const spy = vi.spyOn(flint, "getAvatars");
    const { result } = renderHook(() => useAvatarImage({ kind: "sender", address: "a@example.org" }));
    await new Promise((r) => setTimeout(r, 80));
    expect(spy).not.toHaveBeenCalled();
    expect(result.current).toBeNull();
  });
});
