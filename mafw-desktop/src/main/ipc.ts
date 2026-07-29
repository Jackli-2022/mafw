import { ipcMain, BrowserWindow } from 'electron'

let winRef: BrowserWindow | null = null

export function setMainWindow(win: BrowserWindow) {
  winRef = win
}

function broadcast(channel: string, data: any) {
  if (winRef && !winRef.isDestroyed()) {
    winRef.webContents.send(channel, data)
  }
}

export function registerIpcHandlers(port: number) {
  ipcMain.handle('gateway:get-port', () => port)

  ipcMain.handle('gateway:health-check', async () => {
    try {
      const res = await fetch(`http://localhost:${port}/health`, { signal: AbortSignal.timeout(3000) })
      return res.ok
    } catch {
      return false
    }
  })

  // Push health status every 5 seconds
  setInterval(async () => {
    try {
      const res = await fetch(`http://localhost:${port}/health`, { signal: AbortSignal.timeout(3000) })
      broadcast('gateway:health', res.ok)
    } catch {
      broadcast('gateway:health', false)
    }
  }, 5000)
}
