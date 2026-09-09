import { BrowserWindow } from "electron"
import { sendNavigateMafw } from "./ipc"

export function getMafwMenuTemplate() {
  return {
    label: "MAFW",
    submenu: [
      {
        label: "Open MAFW Dashboard",
        accelerator: "CmdOrCtrl+Shift+M",
        click: () => {
          const win = BrowserWindow.getFocusedWindow()
          if (win) sendNavigateMafw(win)
        },
      },
    ],
  }
}
