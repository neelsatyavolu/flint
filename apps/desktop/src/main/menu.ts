import { Menu } from "electron";
import { buildMenuTemplate, type MenuSend } from "./menu-template";

export function installMenu(opts: { isMac: boolean; isDev: boolean; send: MenuSend; checkForUpdates?: () => void }): void {
  Menu.setApplicationMenu(Menu.buildFromTemplate(buildMenuTemplate(opts)));
}
