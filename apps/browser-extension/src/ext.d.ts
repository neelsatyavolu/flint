/** The few WebExtension APIs this extension uses. Chrome and Firefox (MV3) both expose them on `chrome`. */
interface ExtSender {
  id?: string;
  url?: string;
  tab?: { url?: string };
}

interface ExtRuntime {
  id?: string;
  lastError?: { message?: string };
  sendMessage(message: unknown, callback?: (reply: unknown) => void): void;
  sendNativeMessage(host: string, message: unknown, callback?: (reply: unknown) => void): void;
  onMessage: {
    addListener(listener: (message: unknown, sender: ExtSender, sendResponse: (reply: unknown) => void) => boolean | void): void;
  };
}

declare const chrome: { runtime: ExtRuntime };
