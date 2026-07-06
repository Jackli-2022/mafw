const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('path')
const GatewayManager = require('./gateway-manager')
const createTray = require('./tray')

let mainWindow = null
let tray = null
const gatewayManager = new GatewayManager()

app.whenReady().then(() => {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  tray = createTray(mainWindow, gatewayManager)

  mainWindow.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault()
      mainWindow.hide()
    }
  })

  gatewayManager.on('ready', () => {
    mainWindow.loadURL('http://localhost:3001')
  })

  ipcMain.handle('gateway:status', () => gatewayManager.getStatus())
  ipcMain.handle('gateway:logs', () => gatewayManager.getLogs())
  ipcMain.handle('gateway:start', () => gatewayManager.start())
  ipcMain.handle('gateway:stop', () => gatewayManager.stop())
  ipcMain.handle('gateway:restart', () => gatewayManager.restart())

  gatewayManager.start()
})

app.on('before-quit', () => {
  gatewayManager.stop()
})
