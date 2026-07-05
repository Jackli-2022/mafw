#!/usr/bin/env node

/**
 * mafw-gateway CLI — Gateway lifecycle management
 *
 * Usage: npx mafw-gateway <command>
 * Commands: start, stop, status, restart, daemon, service-register, service-unregister, logs, config
 */

const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const CONFIG_DIR = path.join(os.homedir(), '.config', 'mafw');
const PID_FILE = path.join(CONFIG_DIR, 'gateway.pid');
const LOG_DIR = path.join(CONFIG_DIR, 'logs');
const GATEWAY_SCRIPT = path.join(__dirname, '..', 'gateway', 'dist', 'index.js');

const COMMANDS = ['start', 'stop', 'status', 'restart', 'daemon', 'service-register', 'service-unregister', 'logs', 'config', 'dashboard'];

function main() {
  const cmd = process.argv[2];

  if (!cmd || cmd === '--help' || cmd === '-h') {
    printUsage();
    process.exit(0);
  }

  if (!COMMANDS.includes(cmd)) {
    console.error(`Unknown command: ${cmd}`);
    printUsage();
    process.exit(1);
  }

  switch (cmd) {
    case 'start':
      startGateway(false);
      break;
    case 'daemon':
      startGateway(true);
      break;
    case 'stop':
      stopGateway();
      break;
    case 'status':
      showStatus();
      break;
    case 'restart':
      stopGateway();
      setTimeout(() => startGateway(false), 1000);
      break;
    case 'service-register':
      registerService();
      break;
    case 'service-unregister':
      unregisterService();
      break;
    case 'logs':
      showLogs();
      break;
    case 'config':
      showConfig();
      break;
    case 'dashboard':
      openDashboard();
      break;
  }
}

function printUsage() {
  console.log(`
MAFW Gateway CLI v5.0

Usage: npx mafw-gateway <command>

Commands:
  start              Start Gateway in foreground
  daemon             Start Gateway in background
  stop               Stop running Gateway
  status             Show Gateway status
  restart            Restart Gateway
  dashboard          Open Dashboard in browser
  service-register   Register as system service (auto-start)
  service-unregister Unregister system service
  logs               Show recent logs
  config             Show/edit configuration
`);
}

function ensureDirs() {
  if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
  if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
}

function startGateway(background) {
  ensureDirs();

  if (fs.existsSync(PID_FILE)) {
    const pid = fs.readFileSync(PID_FILE, 'utf-8').trim();
    try {
      process.kill(Number(pid), 0);
      console.log(`[Gateway] Already running (PID: ${pid})`);
      return;
    } catch {
      fs.unlinkSync(PID_FILE);
    }
  }

  if (!fs.existsSync(GATEWAY_SCRIPT)) {
    console.error(`[Gateway] Not found: ${GATEWAY_SCRIPT}`);
    console.error('[Gateway] Please run: npm run build');
    process.exit(1);
  }

  const args = [GATEWAY_SCRIPT];
  const opts = {
    stdio: background ? 'ignore' : 'inherit',
    detached: background,
    windowsHide: true
  };

  if (background) {
    const child = spawn(process.execPath, args, opts);
    child.unref();
    fs.writeFileSync(PID_FILE, String(child.pid));
    console.log(`[Gateway] Started in background (PID: ${child.pid})`);
    console.log(`[Gateway] Logs: ${path.join(LOG_DIR, 'gateway.log')}`);
  } else {
    console.log('[Gateway] Starting in foreground...');
    const child = spawn(process.execPath, args, { stdio: 'inherit', windowsHide: true });
    fs.writeFileSync(PID_FILE, String(child.pid));
    child.on('exit', (code) => {
      fs.unlinkSync(PID_FILE);
      process.exit(code);
    });
  }
}

function stopGateway() {
  if (!fs.existsSync(PID_FILE)) {
    console.log('[Gateway] Not running');
    return;
  }

  const pid = fs.readFileSync(PID_FILE, 'utf-8').trim();
  try {
    process.kill(Number(pid), 'SIGTERM');
    console.log(`[Gateway] Stopped (PID: ${pid})`);
  } catch (err) {
    console.error(`[Gateway] Failed to stop: ${err.message}`);
  }
  fs.unlinkSync(PID_FILE);
}

function showStatus() {
  if (!fs.existsSync(PID_FILE)) {
    console.log('[Gateway] Status: STOPPED');
    return;
  }

  const pid = fs.readFileSync(PID_FILE, 'utf-8').trim();
  try {
    process.kill(Number(pid), 0);
    console.log(`[Gateway] Status: RUNNING (PID: ${pid})`);
  } catch {
    console.log('[Gateway] Status: STOPPED (stale PID file)');
    fs.unlinkSync(PID_FILE);
  }
}

function showLogs() {
  const logFile = path.join(LOG_DIR, 'gateway.log');
  if (!fs.existsSync(logFile)) {
    console.log('[Gateway] No logs yet');
    return;
  }
  try {
    const lines = fs.readFileSync(logFile, 'utf-8').split(/\r?\n/);
    const tail = lines.length > 50 ? lines.slice(lines.length - 50) : lines;
    console.log(tail.join('\n'));
  } catch {
    console.log('[Gateway] Cannot read logs');
  }
}

function showConfig() {
  const configFile = path.join(CONFIG_DIR, 'config.json');
  if (fs.existsSync(configFile)) {
    console.log(fs.readFileSync(configFile, 'utf-8'));
  } else {
    console.log('{}');
  }
}

function registerService() {
  const platform = process.platform;
  ensureDirs();
  const gatewayScript = path.resolve(GATEWAY_SCRIPT);

  if (platform === 'win32') {
    const taskName = 'MAFW-Gateway';
    const cmd = `schtasks /create /tn "${taskName}" /tr "node \\"${gatewayScript}\\"" /sc onlogon /rl highest /f`;
    try {
      execSync(cmd, { stdio: 'inherit' });
      console.log(`[Gateway] Windows scheduled task "${taskName}" registered (runs at logon)`);
    } catch (err) {
      console.error(`[Gateway] Failed to register scheduled task: ${err.message}`);
      process.exit(1);
    }
  } else if (platform === 'darwin') {
    const agentDir = path.join(os.homedir(), 'Library', 'LaunchAgents');
    const plistPath = path.join(agentDir, 'com.mafw.gateway.plist');
    if (!fs.existsSync(agentDir)) fs.mkdirSync(agentDir, { recursive: true });

    const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.mafw.gateway</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/node</string>
    <string>${gatewayScript}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${path.join(LOG_DIR, 'gateway.log')}</string>
  <key>StandardErrorPath</key>
  <string>${path.join(LOG_DIR, 'gateway.log')}</string>
</dict>
</plist>`;
    fs.writeFileSync(plistPath, plist, 'utf-8');
    try {
      execSync(`launchctl load "${plistPath}"`, { stdio: 'inherit' });
      console.log(`[Gateway] macOS LaunchAgent registered: ${plistPath}`);
    } catch (err) {
      console.error(`[Gateway] Failed to load LaunchAgent: ${err.message}`);
    }
  } else {
    const unitDir = path.join(os.homedir(), '.config', 'systemd', 'user');
    const unitPath = path.join(unitDir, 'mafw-gateway.service');
    if (!fs.existsSync(unitDir)) fs.mkdirSync(unitDir, { recursive: true });

    const unit = `[Unit]
Description=MAFW Gateway
After=network.target

[Service]
ExecStart=/usr/bin/node ${gatewayScript}
Restart=on-failure
RestartSec=5
StandardOutput=append:${path.join(LOG_DIR, 'gateway.log')}
StandardError=append:${path.join(LOG_DIR, 'gateway.log')}

[Install]
WantedBy=default.target
`;
    fs.writeFileSync(unitPath, unit, 'utf-8');
    try {
      execSync('systemctl --user daemon-reload', { stdio: 'inherit' });
      execSync('systemctl --user enable mafw-gateway.service', { stdio: 'inherit' });
      console.log(`[Gateway] Linux systemd user service registered: ${unitPath}`);
    } catch (err) {
      console.error(`[Gateway] Failed to register systemd service: ${err.message}`);
    }
  }
}

function unregisterService() {
  const platform = process.platform;
  if (platform === 'win32') {
    const taskName = 'MAFW-Gateway';
    try {
      execSync(`schtasks /delete /tn "${taskName}" /f`, { stdio: 'inherit' });
      console.log(`[Gateway] Windows scheduled task "${taskName}" unregistered`);
    } catch (err) {
      console.error(`[Gateway] Failed to unregister scheduled task: ${err.message}`);
    }
  } else if (platform === 'darwin') {
    const plistPath = path.join(os.homedir(), 'Library', 'LaunchAgents', 'com.mafw.gateway.plist');
    if (fs.existsSync(plistPath)) {
      try {
        execSync(`launchctl unload "${plistPath}"`, { stdio: 'inherit' });
        fs.unlinkSync(plistPath);
        console.log('[Gateway] macOS LaunchAgent unregistered');
      } catch (err) {
        console.error(`[Gateway] Failed to unload LaunchAgent: ${err.message}`);
      }
    } else {
      console.log('[Gateway] No LaunchAgent found');
    }
  } else {
    try {
      execSync('systemctl --user disable mafw-gateway.service', { stdio: 'inherit' });
      const unitPath = path.join(os.homedir(), '.config', 'systemd', 'user', 'mafw-gateway.service');
      if (fs.existsSync(unitPath)) fs.unlinkSync(unitPath);
      console.log('[Gateway] Linux systemd service unregistered');
    } catch (err) {
      console.error(`[Gateway] Failed to unregister systemd service: ${err.message}`);
    }
  }
}

function openDashboard() {
  const url = 'http://localhost:3001/';
  const platform = process.platform;
  console.log(`[Gateway] Opening Dashboard: ${url}`);
  try {
    if (platform === 'win32') {
      execSync(`start "" "${url}"`, { stdio: 'ignore' });
    } else if (platform === 'darwin') {
      execSync(`open "${url}"`, { stdio: 'ignore' });
    } else {
      execSync(`xdg-open "${url}"`, { stdio: 'ignore' });
    }
  } catch (err) {
    console.log(`[Gateway] Open in browser: ${url}`);
  }
}

main();
