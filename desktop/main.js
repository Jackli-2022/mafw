const { app, BrowserWindow, ipcMain, Notification } = require('electron')
const path = require('path')
const http = require('http')
const GatewayManager = require('./gateway-manager')
const createTray = require('./tray')

let mainWindow = null
let tray = null
const gatewayManager = new GatewayManager()

function setupSSENotifications() {
  function connect() {
    const req = http.get('http://localhost:3001/api/events?stream=true', (res) => {
      let buf = ''
      res.on('data', (chunk) => {
        buf += chunk.toString()
        const lines = buf.split('\n')
        buf = lines.pop() || ''
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const ev = JSON.parse(line.slice(6))
              if (ev.patch?.phase === 'COMPLETED') {
                new Notification({ title: 'Goal Complete', body: ev.goalId + ' completed' }).show()
              }
              if (ev.patch?.phase === 'FAILED') {
                new Notification({ title: 'Goal Failed', body: ev.goalId + ' failed' }).show()
              }
            } catch {}
          }
        }
      })
      res.on('end', () => setTimeout(connect, 5000))
    })
    req.on('error', () => setTimeout(connect, 5000))
  }
  connect()
}

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
    setTimeout(setupSSENotifications, 2000)
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
