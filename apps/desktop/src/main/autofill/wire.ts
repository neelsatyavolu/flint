import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ACCESSIBILITY_PANE_URL, HELPER_RESOURCE_PATH } from "@flint/core/autofill/contract";
import { app, globalShortcut, shell } from "electron";
import { openDemoField } from "./demo-window";
import { spawnHelperProcess } from "./helper-process";
import { createAutofillManager, type AutofillManager } from "./manager";

/** Binds the manager to Electron: helper path (Resources/autofill/FlintAutofill packaged; apps/autofill-helper/dist in development), child_process spawn, globalShortcut, shell, the demo window. */
export function createDesktopAutofill(): AutofillManager {
  const candidate = app.isPackaged
    ? join(process.resourcesPath, HELPER_RESOURCE_PATH)
    : fileURLToPath(new URL("../../../autofill-helper/dist/FlintAutofill", import.meta.url)); // out/main -> apps/autofill-helper/dist
  const helperPath = existsSync(candidate) ? candidate : null;
  return createAutofillManager({
    helperPath,
    isMac: process.platform === "darwin",
    spawnHelper: spawnHelperProcess,
    shortcuts: {
      register: (accelerator, cb) => globalShortcut.register(accelerator, cb),
      unregister: (accelerator) => globalShortcut.unregister(accelerator),
    },
    openDemoField,
    openAccessibilityPane: () => shell.openExternal(ACCESSIBILITY_PANE_URL),
  });
}
