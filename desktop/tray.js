const { Tray, Menu, nativeImage } = require('electron')

function createTray(mainWindow, gatewayManager) {
  const icon = nativeImage.createEmpty()
  const tray = new Tray(icon)
  tray.setToolTip('MAFW Gateway')

  function buildMenu() {
    const status = gatewayManager.getStatus()
    const isRunning = status === 'running'
    const menu = Menu.buildFromTemplate([
      {
        label: 'Open Dashboard',
        click: () => {
          mainWindow.show()
          mainWindow.focus()
        },
      },
      { type: 'separator' },
      {
        label: isRunning ? 'Stop Gateway' : 'Start Gateway',
        click: () => {
          if (isRunning) {
            gatewayManager.stop()
          } else {
            gatewayManager.start()
          }
        },
      },
      {
        label: 'Restart Gateway',
        click: () => gatewayManager.restart(),
      },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => {
          const { app } = require('electron')
          app.isQuitting = true
          app.quit()
        },
      },
    ])
    tray.setContextMenu(menu)
  }

  buildMenu()
  gatewayManager.on('status-change', buildMenu)

  return tray
}

module.exports = createTray
