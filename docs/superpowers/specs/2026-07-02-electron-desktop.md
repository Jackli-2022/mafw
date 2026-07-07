# MAFW Electron Desktop App Design

> **Goal**: Build a Windows desktop application wrapping the MAFW Gateway + Dashboard for system tray integration, process management, and desktop notifications.

## Architecture Overview

```
Electron Main Process
    │
    ├── GatewayManager
    │     └── spawn gateway/dist/index.js → child process
    │         ├── stdout → log buffer
    │         └── exit → auto-restart (3s)
    │
    ├── BrowserWindow
    │     └── load http://localhost:3001 (existing Dashboard SPA)
    │         ├── show on tray "Open Dashboard"
    │         └── hide on close (minimize to tray)
    │
    ├── System Tray
    │     ├── icon: green (running) / red (stopped)
    │     ├── menu: start/stop/restart/open/logs/quit
    │     └── notifications on goal completion/failure
    │
    └── Log Window
          └── BrowserWindow showing filtered log output
```

### Key Principle

**Zero modifications** to existing Gateway, Plugin, MCP Server, or Dashboard code. Electron is purely a wrapper + process manager.

---

## File Structure

```
desktop/
├── main.js                  # Electron entry point (80 lines)
├── tray.js                  # System tray + menu (60 lines)
├── gateway-manager.js       # Gateway child process management (50 lines)
├── preload.js               # IPC security bridge (20 lines)
├── package.json             # Dependencies + build config (15 lines)
└── public/
    ├── index.html            # Log viewer page (30 lines)
    └── app.js               # Log viewer logic (20 lines)
```

---

## Component Design

### main.js — Electron Entry Point

```javascript
const { app, BrowserWindow, ipcMain } = require('electron');
const { GatewayManager } = require('./gateway-manager');
const { createTray } = require('./tray');

let mainWindow;
let gatewayManager;

app.whenReady().then(() => {
  // 1. Start Gateway as child process
  gatewayManager = new GatewayManager();
  gatewayManager.start();

  // 2. Create main BrowserWindow (loads Dashboard SPA)
  mainWindow = new BrowserWindow({
    width: 1280, height: 800,
    show: false,  // start minimized to tray
    webPreferences: { preload: path.join(__dirname, 'preload.js') }
  });

  mainWindow.on('close', (e) => {
    if (!app.isQuitting) { e.preventDefault(); mainWindow.hide(); }
  });

  // 3. Create system tray
  createTray(mainWindow, gatewayManager);

  // 4. IPC handlers
  ipcMain.handle('gateway:start', () => gatewayManager.start());
  ipcMain.handle('gateway:stop', () => gatewayManager.stop());
  ipcMain.handle('gateway:restart', () => gatewayManager.restart());
  ipcMain.handle('gateway:status', () => gatewayManager.getStatus());
  ipcMain.handle('gateway:logs', () => gatewayManager.getLogs());

  // 5. Listen for notifications via SSE
  setupSSENotifications(gatewayManager);
});

app.on('before-quit', () => {
  app.isQuitting = true;
  gatewayManager.stop();
});
```

### tray.js — System Tray

```javascript
const { Tray, Menu, Notification, nativeImage } = require('electron');

function createTray(mainWindow, gatewayManager) {
  const iconGreen = nativeImage.createFromPath('icon-green.png');
  const iconRed = nativeImage.createFromPath('icon-red.png');

  const tray = new Tray(iconGreen);
  tray.setToolTip('MAFW Gateway');

  // Update icon based on Gateway status
  gatewayManager.on('status-change', (status) => {
    tray.setImage(status === 'running' ? iconGreen : iconRed);
    tray.setContextMenu(buildMenu());
  });

  function buildMenu() {
    const isRunning = gatewayManager.getStatus() === 'running';
    return Menu.buildFromTemplate([
      { label: '📊 打开 Dashboard', click: () => mainWindow.show() },
      { type: 'separator' },
      { label: isRunning ? '⏸ 暂停所有 Goal' : '▶️ 启动 Gateway',
        click: () => isRunning ? gatewayManager.pause() : gatewayManager.start() },
      { label: '🔄 重启 Gateway', click: () => gatewayManager.restart() },
      { label: '📋 查看日志', click: () => openLogWindow() },
      { type: 'separator' },
      { label: '❌ 退出', click: () => { app.isQuitting = true; app.quit(); } }
    ]);
  }

  tray.setContextMenu(buildMenu());
  gatewayManager.on('status-change', () => tray.setContextMenu(buildMenu()));

  return tray;
}
```

### gateway-manager.js — Process Manager

```javascript
const { spawn } = require('child_process');
const path = require('path');
const EventEmitter = require('events');

class GatewayManager extends EventEmitter {
  constructor() {
    super();
    this.process = null;
    this.logLines = [];
  }

  start() {
    if (this.process) return;
    const script = path.join(__dirname, '..', 'gateway', 'dist', 'index.js');
    this.process = spawn(process.execPath, [script], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });

    this.process.stdout.on('data', (data) => {
      const lines = data.toString().split('\n').filter(Boolean);
      this.logLines.push(...lines);
      this.emit('log', lines);
      if (lines.some(l => l.includes('HTTP server @'))) {
        this.emit('ready');
        this.emit('status-change', 'running');
      }
    });

    this.process.stderr.on('data', (data) => {
      this.logLines.push(...data.toString().split('\n').filter(Boolean));
    });

    this.process.on('exit', (code) => {
      this.emit('status-change', 'stopped');
      this.process = null;
      if (code !== 0) {
        this.emit('crashed', code);
        new Notification({ title: 'MAFW Gateway', body: `Gateway 异常退出 (code ${code})，3秒后自动重启` }).show();
        setTimeout(() => this.start(), 3000);
      }
    });
  }

  stop() {
    if (this.process) { this.process.kill('SIGTERM'); this.process = null; }
  }

  restart() {
    this.stop();
    setTimeout(() => this.start(), 1000);
  }

  getStatus() { return this.process ? 'running' : 'stopped'; }
  getLogs() { return [...this.logLines]; }
}
```

### preload.js — IPC Bridge

```javascript
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('mafw', {
  startGateway: () => ipcRenderer.invoke('gateway:start'),
  stopGateway: () => ipcRenderer.invoke('gateway:stop'),
  restartGateway: () => ipcRenderer.invoke('gateway:restart'),
  getGatewayStatus: () => ipcRenderer.invoke('gateway:status'),
  getGatewayLogs: () => ipcRenderer.invoke('gateway:logs')
});
```

---

## Notifications

SSE listener runs in the main process to catch state changes:

```javascript
function setupSSENotifications(gatewayManager) {
  const es = new EventSource('http://localhost:3001/api/events?stream=true');
  es.onmessage = (e) => {
    try {
      const ev = JSON.parse(e.data);
      if (ev.type === 'state_change' && ev.patch?.phase === 'COMPLETED') {
        new Notification({
          title: '✅ MAFW Goal Complete',
          body: `Goal ${ev.goalId} 已完成`
        }).show();
      }
      if (ev.type === 'state_change' && ev.patch?.phase === 'FAILED') {
        new Notification({
          title: '❌ MAFW Goal Failed',
          body: `Goal ${ev.goalId} 执行失败`
        }).show();
      }
    } catch {}
  };
}
```

---

## Packaging

Using electron-builder for Windows packaging:

```json
{
  "scripts": {
    "start": "electron .",
    "pack": "electron-builder --win portable",
    "dist": "electron-builder --win nsis"
  },
  "build": {
    "appId": "com.mafw.desktop",
    "productName": "MAFW",
    "directories": { "output": "release" },
    "win": { "target": ["portable", "nsis"], "icon": "icon.png" },
    "extraResources": [
      { "from": "../gateway/dist", "to": "gateway/dist" },
      { "from": "../node_modules", "to": "node_modules" }
    ]
  }
}
```

---

## File Manifest

| File | Lines | Purpose |
|---|---|---|
| `desktop/main.js` | 80 | Electron entry, BrowserWindow, IPC, SSE notifications |
| `desktop/tray.js` | 60 | System tray icon, context menu, status indicator |
| `desktop/gateway-manager.js` | 50 | Gateway child process spawn, monitor, auto-restart |
| `desktop/preload.js` | 20 | Secure IPC bridge for renderer |
| `desktop/public/index.html` | 30 | Log viewer page |
| `desktop/public/app.js` | 20 | Log viewer logic |
| `desktop/package.json` | 15 | Dependencies + electron-builder config |
| **Total** | **~275** | |

---

## Decision Log

| # | Decision | Rationale |
|---|---|---|
| 1 | Electron, not Tauri/WPF | Reuse existing Dashboard SPA, lowest dev cost |
| 2 | Zero modifications to existing code | Electron is pure wrapper |
| 3 | Gateway spawn as child process | Shared stdout/stderr for logging |
| 4 | Hide window on close (minimize to tray) | Expected desktop app behavior |
| 5 | Auto-restart on crash (3s delay) | Production reliability |
| 6 | Notifications via SSE | Reuse existing event system, no new protocol |
| 7 | electron-builder for packaging | Mature, supports portable + installer |
