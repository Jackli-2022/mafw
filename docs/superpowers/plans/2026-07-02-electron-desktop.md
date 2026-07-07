# Electron Desktop App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Windows Electron desktop app wrapping MAFW Gateway + Dashboard with system tray, process management, and notifications.

**Architecture:** Electron main process spawns Gateway as child process. BrowserWindow loads existing Dashboard SPA (http://localhost:3001). System tray shows Gateway status. SSE listener triggers desktop notifications.

**Tech Stack:** Electron, Node.js, electron-builder.

## Global Constraints

- Do NOT modify any existing Gateway, Plugin, MCP Server, or Dashboard code
- All new files go under `desktop/` directory
- Gateway is spawned as child process, not included in the Electron package
- Notifications use Electron's Notification API, not HTML5
- System tray uses nativeImage for status icons (green=running, red=stopped)
- Packaging uses electron-builder with portable + nsis targets

---

## Task 1: Project scaffolding + GatewayManager

**Files:**
- Create: `desktop/package.json`
- Create: `desktop/gateway-manager.js`

- [ ] **Step 1: Create `desktop/package.json`**

```json
{
  "name": "mafw-desktop",
  "version": "1.0.0",
  "description": "MAFW Desktop App — Gateway management + Dashboard",
  "main": "main.js",
  "scripts": {
    "start": "electron .",
    "pack": "electron-builder --win portable",
    "dist": "electron-builder --win nsis"
  },
  "devDependencies": {
    "electron": "^33.0.0",
    "electron-builder": "^25.0.0"
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

- [ ] **Step 2: Create `desktop/gateway-manager.js`**

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
    if (!require('fs').existsSync(script)) {
      this.emit('error', 'Gateway dist not found. Run npm run build first.');
      return;
    }
    this.process = spawn(process.execPath, [script], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      env: { ...process.env, PORT: '3000', DASHBOARD_PORT: '3001' }
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
      const lines = data.toString().split('\n').filter(Boolean);
      this.logLines.push(...lines);
    });

    this.process.on('exit', (code) => {
      this.emit('status-change', 'stopped');
      this.process = null;
      if (code !== 0 && code !== null) {
        this.emit('crashed', code);
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

  getStatus() { return this.process && !this.process.killed ? 'running' : 'stopped'; }
  getLogs() { return [...this.logLines]; }
}

module.exports = { GatewayManager };
```

- [ ] **Step 3: Verify**

```bash
cd desktop && npm install
node -e "const {GatewayManager} = require('./gateway-manager'); const g = new GatewayManager(); console.log('GatewayManager loaded');"
```

Expected: "GatewayManager loaded"

- [ ] **Step 4: Commit**

```bash
git add desktop/package.json desktop/gateway-manager.js
git commit -m "feat: add Electron desktop scaffolding and GatewayManager"
```

---

## Task 2: main.js + tray.js + preload.js

**Files:**
- Create: `desktop/main.js`
- Create: `desktop/tray.js`
- Create: `desktop/preload.js`

- [ ] **Step 1: Create `desktop/preload.js`**

```javascript
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('mafw', {
  getGatewayStatus: () => ipcRenderer.invoke('gateway:status'),
  getGatewayLogs: () => ipcRenderer.invoke('gateway:logs'),
  startGateway: () => ipcRenderer.invoke('gateway:start'),
  stopGateway: () => ipcRenderer.invoke('gateway:stop'),
  restartGateway: () => ipcRenderer.invoke('gateway:restart')
});
```

- [ ] **Step 2: Create `desktop/tray.js`**

```javascript
const { Tray, Menu, Notification, nativeImage, app } = require('electron');
const path = require('path');

function createTray(mainWindow, gatewayManager) {
  const iconGreen = nativeImage.createEmpty();
  const iconRed = nativeImage.createEmpty();

  const tray = new Tray(iconGreen);
  tray.setToolTip('MAFW Gateway');

  function buildMenu() {
    const isRunning = gatewayManager.getStatus() === 'running';
    return Menu.buildFromTemplate([
      { label: 'Open Dashboard', click: () => { mainWindow.show(); mainWindow.focus(); } },
      { type: 'separator' },
      {
        label: isRunning ? 'Pause Gateway' : 'Start Gateway',
        click: () => isRunning ? gatewayManager.stop() : gatewayManager.start()
      },
      { label: 'Restart Gateway', click: () => gatewayManager.restart() },
      { type: 'separator' },
      { label: 'Quit', click: () => { app.isQuitting = true; app.quit(); } }
    ]);
  }

  tray.setContextMenu(buildMenu());

  gatewayManager.on('status-change', () => {
    tray.setContextMenu(buildMenu());
  });

  return tray;
}

module.exports = { createTray };
```

- [ ] **Step 3: Create `desktop/main.js`**

```javascript
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { GatewayManager } = require('./gateway-manager');
const { createTray } = require('./tray');

let mainWindow;
let tray;
let gatewayManager;

app.whenReady().then(() => {
  gatewayManager = new GatewayManager();

  mainWindow = new BrowserWindow({
    width: 1280, height: 800,
    show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js') }
  });

  mainWindow.on('close', (e) => {
    if (!app.isQuitting) { e.preventDefault(); mainWindow.hide(); }
  });

  tray = createTray(mainWindow, gatewayManager);

  ipcMain.handle('gateway:status', () => gatewayManager.getStatus());
  ipcMain.handle('gateway:logs', () => gatewayManager.getLogs());
  ipcMain.handle('gateway:start', () => gatewayManager.start());
  ipcMain.handle('gateway:stop', () => gatewayManager.stop());
  ipcMain.handle('gateway:restart', () => gatewayManager.restart());

  // Wait for Gateway to be ready, then load Dashboard
  gatewayManager.on('ready', () => {
    mainWindow.loadURL('http://localhost:3001');
    mainWindow.show();
  });

  gatewayManager.on('error', (msg) => {
    mainWindow.loadURL(`data:text/html,<h2>Error</h2><p>${msg}</p>`);
    mainWindow.show();
  });

  gatewayManager.start();
});

app.on('before-quit', () => {
  app.isQuitting = true;
  if (gatewayManager) gatewayManager.stop();
});
```

- [ ] **Step 4: Test**

```bash
npx electron ./desktop/main.js
```

Expected: Electron window opens, loads Dashboard after Gateway starts.

- [ ] **Step 5: Commit**

```bash
git add desktop/main.js desktop/tray.js desktop/preload.js
git commit -m "feat: add Electron main process, tray, and preload"
```

---

## Task 3: Notifications + packaging

**Files:**
- Create: `desktop/public/index.html`
- Create: `desktop/public/app.js`

- [ ] **Step 1: Add SSE notification listener to main.js**

Add before `app.whenReady()`:

```javascript
const http = require('http');

function setupNotifications(gatewayManager) {
  function connectSSE() {
    const req = http.get('http://localhost:3001/api/events?stream=true', (res) => {
      let buffer = '';
      res.on('data', (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const ev = JSON.parse(line.slice(6));
              if (ev.patch?.phase === 'COMPLETED') {
                new Notification({ title: 'Goal Complete', body: `${ev.goalId} completed` }).show();
              }
            } catch {}
          }
        }
      });
      res.on('error', () => setTimeout(connectSSE, 5000));
    });
    req.on('error', () => setTimeout(connectSSE, 5000));
  }

  gatewayManager.on('ready', () => {
    setTimeout(connectSSE, 2000); // Wait for server to be fully ready
  });
}
```

- [ ] **Step 2: Create log viewer**

`desktop/public/index.html`:
```html
<!DOCTYPE html>
<html><head><title>MAFW Logs</title></head>
<body><pre id="log"></pre><script src="app.js"></script></body>
</html>
```

`desktop/public/app.js`:
```javascript
const log = document.getElementById('log');
async function poll() {
  const lines = await window.mafw.getGatewayLogs();
  log.textContent = lines.join('\n');
  log.scrollTop = log.scrollHeight;
}
setInterval(poll, 2000);
```

- [ ] **Step 3: Run full test**

```bash
npx electron ./desktop/main.js
```

Expected: Window opens, Dashboard loads, tray icon appears, close minimizes to tray.

- [ ] **Step 4: Commit**

```bash
git add desktop/public/
git commit -m "feat: add desktop notifications and log viewer"
```

---

## Verification

```bash
cd desktop
npm install
npx electron .
# App starts, Gateway launches, Dashboard loads in window
# Close window → minimizes to tray
# Tray menu → Open Dashboard / Start / Stop / Quit
```
