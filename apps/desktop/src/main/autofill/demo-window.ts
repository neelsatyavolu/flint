import { BrowserWindow } from "electron";
import type { ScreenRect } from "@flint/core/autofill/contract";

const PAGE = `<!doctype html><meta charset="utf-8"><title>Try Flint autofill</title>
<meta name="color-scheme" content="light dark">
<style>
  :root { color-scheme: light dark; font: 13px -apple-system, BlinkMacSystemFont, sans-serif; }
  body { margin: 0; padding: 28px 24px; background: Canvas; color: CanvasText; }
  h1 { font-size: 15px; font-weight: 600; margin: 0 0 6px; }
  p { margin: 0 0 18px; opacity: .7; line-height: 1.45; }
  label { display: block; font-size: 12px; opacity: .7; margin-bottom: 6px; }
  input { box-sizing: border-box; width: 100%; height: 32px; padding: 0 10px; font: 15px ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: .08em; border: 1px solid color-mix(in srgb, CanvasText 25%, transparent); border-radius: 6px; background: Canvas; color: CanvasText; }
  input:focus { outline: 2px solid #4C8DFF; outline-offset: -1px; }
</style>
<h1>Try autofill</h1>
<p>A suggestion with a sample code appears next to this field. Click it to type the code. Nothing is saved.</p>
<label for="code">Verification code</label>
<input id="code" autocomplete="one-time-code" inputmode="numeric" placeholder="Enter code" autofocus>`;

/** Opens a small window with a one-time-code input and resolves with that input's rectangle in screen coordinates. */
export async function openDemoField(onClosed?: () => void, onMoved?: (field: ScreenRect) => void): Promise<ScreenRect> {
  const win = new BrowserWindow({
    width: 380, height: 240, resizable: false, minimizable: false, maximizable: false, fullscreenable: false,
    title: "Try Flint autofill", show: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (e) => e.preventDefault());
  win.once("closed", () => onClosed?.());
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(PAGE)}`);
  win.show();
  const r = (await win.webContents.executeJavaScript(
    `(() => { const b = document.getElementById("code").getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height }; })()`,
  )) as ScreenRect;
  const place = (): ScreenRect => {
    const content = win.getContentBounds();
    return { x: content.x + r.x, y: content.y + r.y, width: r.width, height: r.height };
  };
  if (onMoved) {
    win.on("move", () => { if (!win.isDestroyed()) onMoved(place()); });
  }
  return place();
}
