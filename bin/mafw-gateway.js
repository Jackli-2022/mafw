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

const COMMANDS = ['start', 'stop', 'status', 'restart', 'daemon', 'service-register', 'service-unregister', 'logs', 'config'];

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
  }
}

function printUsage() {
  console.log(`
MAFW Gateway CLI v4.1

Usage: npx mafw-gateway <command>

Commands:
  start              Start Gateway in foreground
  daemon             Start Gateway in background
  stop               Stop running Gateway
  status             Show Gateway status
  restart            Restart Gateway
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
    detached: background
  };

  if (background) {
    const child = spawn(process.execPath, args, opts);
    child.unref();
    fs.writeFileSync(PID_FILE, String(child.pid));
    console.log(`[Gateway] Started in background (PID: ${child.pid})`);
    console.log(`[Gateway] Logs: ${path.join(LOG_DIR, 'gateway.log')}`);
  } else {
    console.log('[Gateway] Starting in foreground...');
    const child = spawn(process.execPath, args, { stdio: 'inherit' });
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
    const output = execSync(`tail -n 50 "${logFile}"`, { encoding: 'utf-8' });
    console.log(output);
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
  if (platform === 'win32') {
    const script = path.join(__dirname, '..', 'install-mafw.ps1');
    if (fs.existsSync(script)) {
      execSync(`powershell -ExecutionPolicy Bypass -File "${script}"`, { stdio: 'inherit' });
    } else {
      console.error('[Gateway] install-mafw.ps1 not found');
    }
  } else if (platform === 'darwin') {
    console.log('[Gateway] macOS LaunchAgent registration not yet implemented');
  } else {
    console.log('[Gateway] Linux systemd user service registration not yet implemented');
  }
}

function unregisterService() {
  const platform = process.platform;
  if (platform === 'win32') {
    const script = path.join(__dirname, '..', 'uninstall-mafw.ps1');
    if (fs.existsSync(script)) {
      execSync(`powershell -ExecutionPolicy Bypass -File "${script}"`, { stdio: 'inherit' });
    } else {
      console.error('[Gateway] uninstall-mafw.ps1 not found');
    }
  } else {
    console.log('[Gateway] Service unregistration not yet implemented');
  }
}

main();
