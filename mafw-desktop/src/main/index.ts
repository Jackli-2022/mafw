import { app, BrowserWindow, shell } from 'electron'
import path from 'node:path'
import { registerIpcHandlers, setMainWindow } from './ipc'
import { startGateway } from './sidecar'

let mainWindow: BrowserWindow | null = null

const GATEWAY_PORT = process.env.MAFW_DESKTOP_GATEWAY_PORT
  ? parseInt(process.env.MAFW_DESKTOP_GATEWAY_PORT) : 3000
const DEV = process.env.MAFW_DESKTOP_DEV === 'true'

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: 'MAFW Desktop',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
    setMainWindow(mainWindow!)
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (DEV || process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL || 'http://localhost:5173')
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  const gatewayDir = DEV
    ? path.resolve(process.cwd(), '..')
    : path.dirname(app.getPath('exe'))

  registerIpcHandlers(GATEWAY_PORT)

  // 检查 Gateway 是否已在运行，未运行则启动
  void checkGateway(gatewayDir, GATEWAY_PORT)

  createWindow()

async function checkGateway(gatewayDir: string, port: number) {
  try {
    const res = await fetch(`http://localhost:${port}/health`, { signal: AbortSignal.timeout(2000) })
    if (res.ok) {
      console.log('[main] Gateway already running on port', port)
      return
    }
  } catch { /* not running, will start */ }
  console.log('[main] Starting Gateway on port', port)
  startGateway(gatewayDir, port)
}

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
