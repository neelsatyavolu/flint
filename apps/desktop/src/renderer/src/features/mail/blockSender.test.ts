import { describe, expect, it, vi } from "vitest";
import type { ToastInput } from "../../ui";
import { blockSender, unsubscribeExplanation, unsubscribedMessage } from "./blockSender";

const setup = (block: () => Promise<void> = async () => undefined, unblock: () => Promise<void> = async () => undefined) => {
  const shown: ToastInput[] = [];
  const toast = { show: (t: ToastInput) => shown.push(t) };
  const api = { blockSender: vi.fn(block), unblockSender: vi.fn(unblock) };
  return { shown, toast, api };
};

describe("blockSender", () => {
  it("blocks, says where their mail goes, and Undo unblocks", async () => {
    const { shown, toast, api } = setup();
    expect(await blockSender(api, toast, "spam@x.com")).toBe(true);
    expect(api.blockSender).toHaveBeenCalledWith("spam@x.com");
    expect(shown[0]?.message).toBe("Blocked spam@x.com. Their mail goes to Blocked");
    expect(shown[0]?.action?.label).toBe("Undo");
    shown[0]?.action?.onClick();
    await vi.waitFor(() => expect(shown[1]?.message).toBe("Unblocked spam@x.com"));
    expect(api.unblockSender).toHaveBeenCalledWith("spam@x.com");
  });

  it("shows an error when the block fails", async () => {
    const { shown, toast, api } = setup(async () => Promise.reject(new Error("offline")));
    expect(await blockSender(api, toast, "a@x.com")).toBe(false);
    expect(shown).toEqual([{ message: "Couldn't block a@x.com. Try again.", level: "error" }]);
  });

  it("shows an error when Undo fails", async () => {
    const { shown, toast, api } = setup(undefined, async () => Promise.reject(new Error("offline")));
    await blockSender(api, toast, "a@x.com");
    shown[0]?.action?.onClick();
    await vi.waitFor(() => expect(shown[1]).toEqual({ message: "Couldn't unblock a@x.com. Try again.", level: "error" }));
  });
});

describe("unsubscribe copy", () => {
  it("explains the method core will try first", () => {
    expect(unsubscribeExplanation({ url: "https://x.test/u", oneClick: true })).toMatch(/ask the sender's server/);
    expect(unsubscribeExplanation({ mailto: "mailto:leave@list.test?subject=unsubscribe", oneClick: false })).toBe(
      "Flint will send an unsubscribe email from your account to leave@list.test.",
    );
    expect(unsubscribeExplanation({ url: "https://x.test/u", oneClick: false })).toMatch(/open the sender's unsubscribe page/);
  });

  it("names what happened", () => {
    expect(unsubscribedMessage("browser")).toBe("Opened the unsubscribe page");
    expect(unsubscribedMessage("mailto")).toBe("Sent an unsubscribe email");
    expect(unsubscribedMessage("one_click")).toBe("Unsubscribed");
  });
});
