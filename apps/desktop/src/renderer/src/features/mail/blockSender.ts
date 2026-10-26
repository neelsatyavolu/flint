import type { FlintApi, MessageView } from "@flint/core";
import type { ToastInput } from "../../ui";

type Notify = { show: (t: ToastInput) => unknown };

/**
 * Blocks a sender and says where their mail goes, with an Undo that unblocks them. Shared by the reader toolbar, the
 * message ... menu and the person card. Resolves true when the block went through.
 */
export async function blockSender(api: Pick<FlintApi, "blockSender" | "unblockSender">, toast: Notify, address: string): Promise<boolean> {
  try {
    await api.blockSender(address);
  } catch {
    toast.show({ message: `Couldn't block ${address}. Try again.`, level: "error" });
    return false;
  }
  toast.show({
    message: `Blocked ${address}. Their mail goes to Blocked`,
    action: {
      label: "Undo",
      onClick: () =>
        void api.unblockSender(address).then(
          () => toast.show({ message: `Unblocked ${address}` }),
          () => toast.show({ message: `Couldn't unblock ${address}. Try again.`, level: "error" }),
        ),
    },
  });
  return true;
}

/** What Unsubscribe will do for this message, in the order core tries the methods (one-click, email, web page). */
export function unsubscribeExplanation(info: NonNullable<MessageView["unsubscribe"]>): string {
  if (info.oneClick && info.url) return "Flint will ask the sender's server to remove you. Nothing opens and no email is sent.";
  const to = info.mailto ? info.mailto.replace(/^mailto:/i, "").split("?")[0] : "";
  if (to) return `Flint will send an unsubscribe email from your account to ${to}.`;
  return "Flint will open the sender's unsubscribe page in your browser. You may need to confirm there.";
}

/** The toast after an unsubscribe went through. */
export function unsubscribedMessage(method: "one_click" | "mailto" | "browser"): string {
  return method === "browser" ? "Opened the unsubscribe page" : method === "mailto" ? "Sent an unsubscribe email" : "Unsubscribed";
}
