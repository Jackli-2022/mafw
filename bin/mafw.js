#!/usr/bin/env node

const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');
const os = require('os');

const pkg = require('../package.json');
const CONFIG_DIR = path.join(os.homedir(), '.config', 'mafw');
const PID_FILE = path.join(CONFIG_DIR, 'gateway.pid');
const LOG_DIR = path.join(os.homedir(), '.mafw', 'logs');
const LOG_FILE = path.join(LOG_DIR, 'mafw.log');
const GATEWAY_SCRIPT = path.resolve(__dirname, '..', 'gateway', 'dist', 'index.js');
const GATEWAY_PORT = process.env.MAFW_GATEWAY_PORT || process.env.MAFW_SERVER_API_PORT || '3000';
const GATEWAY_URL = process.env.MAFW_GATEWAY_URL || `http://localhost:${GATEWAY_PORT}`;

const USAGE = `
MAFW CLI v${pkg.version}

Usage: mafw <command> [options]

Process Commands:
  start              Start Gateway in foreground
  daemon             Start Gateway in background (detached)
  stop               Stop running Gateway
  status             Show Gateway status (PID / health)
  restart            Restart Gateway
  logs               Show recent logs (last 50 lines)

API Commands:
  health             Gateway health check (GET /health)
  stats              Gateway statistics (GET /api/stats)
  restart-agent      Restart the agent serve process (POST /api/runtime/restart-agent)
  projects           List registered projects (GET /api/projects)
  goals              List active goals (GET /api/goals)
  register <dir>     Register a project (POST /register)
  sessions           List sessions (GET /api/sessions)
  control <action> <goalId>  Control goal (pause|abort|force-phase)
  memory-search <query>      Memory context injection (GET /api/memory/merged-search)
  automations        List automation rules (GET /api/automations)
  approvals          List pending approvals (GET /api/approvals)
  triage             List triage items (GET /api/triage)

Service Commands:
  service-register   Register as OS-level auto-start service
  service-unregister Unregister OS-level service

Utility Commands:
  config             Show gateway config
  dashboard          Open Dashboard in browser
  uninstall          Uninstall instructions
  version            Show version
`;

const COMMANDS = [
  'start', 'daemon', 'stop', 'status', 'restart', 'logs',
    'health', 'stats', 'projects', 'goals', 'register',
    'sessions', 'control', 'memory-search',
    'automations', 'approvals', 'triage', 'restart-agent',
  'service-register', 'service-unregister',
  'config', 'dashboard', 'uninstall', 'version', 'update',
];

function httpRequest(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, GATEWAY_URL);
    const opts = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: { 'Content-Type': 'application/json' },
      timeout: 10000,
    };
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });
    req.on('error', (err) => reject(err));
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function ensureDirs() {
  if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
  if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
}

function readPid() {
  if (!fs.existsSync(PID_FILE)) return null;
  return fs.readFileSync(PID_FILE, 'utf-8').trim();
}

function isRunning(pid) {
  try { process.kill(Number(pid), 0); return true; }
  catch { return false; }
}

function writePid(pid) { fs.writeFileSync(PID_FILE, String(pid)); }
function removePid() { try { fs.unlinkSync(PID_FILE); } catch {} }

function startGateway(background) {
  ensureDirs();
  const existingPid = readPid();
  if (existingPid && isRunning(existingPid)) {
    console.log(`Gateway already running (PID: ${existingPid})`);
    return;
  }
  if (existingPid) removePid();

  if (!fs.existsSync(GATEWAY_SCRIPT)) {
    console.error(`Gateway script not found: ${GATEWAY_SCRIPT}`);
    console.error('Run: cd gateway && npm run build');
    process.exit(1);
  }

  const child = spawn(process.execPath, [GATEWAY_SCRIPT], {
    stdio: background ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    detached: background,
    windowsHide: true,
  });

  writePid(child.pid);

  if (background) {
    // Diagnostics: capture stderr to a file (a detached gateway that crashes
    // silently otherwise leaves no trace). stdout is discarded; the gateway's
    // own file logging covers normal logs.
    const errLog = path.join(LOG_DIR, 'gateway-stderr.log');
    try { if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true }); } catch {}
    const errStream = fs.createWriteStream(errLog, { flags: 'a' });
    child.stderr?.pipe(errStream);
    child.stdout?.resume();
    child.unref();
    console.log(`Gateway started in background (PID: ${child.pid})`);
    console.log(`Logs: ${LOG_FILE}`);
  } else {
    console.log(`Gateway starting (PID: ${child.pid})`);
    child.on('exit', (code) => { removePid(); process.exit(code); });
  }
}

function stopGateway() {
  const pid = readPid();
  if (!pid) { console.log('Gateway not running'); return; }
  if (!isRunning(pid)) {
    console.log('Gateway not running (stale PID)');
    removePid();
    return;
  }
  try {
    process.kill(Number(pid), 'SIGTERM');
    console.log(`Gateway stopped (PID: ${pid})`);
  } catch (err) {
    console.error(`Failed to stop: ${err.message}`);
  }
  removePid();
}

function showStatus() {
  const pid = readPid();
  if (!pid || !isRunning(pid)) {
    console.log('Gateway: STOPPED');
    if (pid) removePid();
    return;
  }
  console.log(`Gateway: RUNNING (PID: ${pid})`);
  console.log(`URL: ${GATEWAY_URL}`);
  console.log(`Logs: ${LOG_FILE}`);
}

function showLogs() {
  if (!fs.existsSync(LOG_FILE)) {
    console.log('No logs yet');
    return;
  }
  const lines = fs.readFileSync(LOG_FILE, 'utf-8').split(/\r?\n/);
  const tail = lines.length > 50 ? lines.slice(-50) : lines;
  console.log(tail.join('\n'));
}

async function callApi(name, method, urlPath, body) {
  try {
    const res = await httpRequest(method || 'GET', urlPath, body);
    if (res.status >= 400) {
      console.error(`Error ${res.status}: ${typeof res.body === 'string' ? res.body : JSON.stringify(res.body)}`);
      return;
    }
    console.log(JSON.stringify(res.body, null, 2));
  } catch (err) {
    console.error(`API call failed: ${err.message}`);
    console.error(`Is the gateway running? Try: mafw start`);
  }
}

function registerService() {
  ensureDirs();
  const script = path.resolve(GATEWAY_SCRIPT);
  const platform = process.platform;
  if (platform === 'win32') {
    const taskName = 'MAFW-Gateway';
    const cmd = `schtasks /create /tn "${taskName}" /tr "node \\"${script}\\"" /sc onlogon /rl highest /f`;
    try { execSync(cmd, { stdio: 'inherit' }); console.log(`Scheduled task "${taskName}" registered`); }
    catch (err) { console.error(`Failed: ${err.message}`); process.exit(1); }
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
  <array><string>/usr/local/bin/node</string><string>${script}</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${LOG_FILE}</string>
  <key>StandardErrorPath</key><string>${LOG_FILE}</string>
</dict>
</plist>`;
    fs.writeFileSync(plistPath, plist, 'utf-8');
    try { execSync(`launchctl load "${plistPath}"`, { stdio: 'inherit' }); console.log(`LaunchAgent registered: ${plistPath}`); }
    catch (err) { console.error(`Failed: ${err.message}`); }
  } else {
    const unitDir = path.join(os.homedir(), '.config', 'systemd', 'user');
    const unitPath = path.join(unitDir, 'mafw-gateway.service');
    if (!fs.existsSync(unitDir)) fs.mkdirSync(unitDir, { recursive: true });
    const unit = `[Unit]
Description=MAFW Gateway
After=network.target
[Service]
ExecStart=/usr/bin/node ${script}
Restart=on-failure
RestartSec=5
StandardOutput=append:${LOG_FILE}
StandardError=append:${LOG_FILE}
[Install]
WantedBy=default.target`;
    fs.writeFileSync(unitPath, unit, 'utf-8');
    try {
      execSync('systemctl --user daemon-reload', { stdio: 'inherit' });
      execSync('systemctl --user enable mafw-gateway.service', { stdio: 'inherit' });
      console.log(`systemd service registered: ${unitPath}`);
    } catch (err) { console.error(`Failed: ${err.message}`); }
  }
}

function unregisterService() {
  const platform = process.platform;
  if (platform === 'win32') {
    try { execSync('schtasks /delete /tn "MAFW-Gateway" /f', { stdio: 'inherit' }); console.log('Scheduled task unregistered'); }
    catch (err) { console.error(`Failed: ${err.message}`); }
  } else if (platform === 'darwin') {
    const plistPath = path.join(os.homedir(), 'Library', 'LaunchAgents', 'com.mafw.gateway.plist');
    if (fs.existsSync(plistPath)) {
      try { execSync(`launchctl unload "${plistPath}"`, { stdio: 'inherit' }); fs.unlinkSync(plistPath); console.log('LaunchAgent unregistered'); }
      catch (err) { console.error(`Failed: ${err.message}`); }
    } else { console.log('No LaunchAgent found'); }
  } else {
    try {
      execSync('systemctl --user disable mafw-gateway.service', { stdio: 'inherit' });
      const unitPath = path.join(os.homedir(), '.config', 'systemd', 'user', 'mafw-gateway.service');
      if (fs.existsSync(unitPath)) fs.unlinkSync(unitPath);
      console.log('systemd service unregistered');
    } catch (err) { console.error(`Failed: ${err.message}`); }
  }
}

function openDashboard() {
  const url = `http://localhost:${Number(GATEWAY_PORT)}/`;
  console.log(`Opening Dashboard: ${url}`);
  try {
    if (process.platform === 'win32') execSync(`start "" "${url}"`, { stdio: 'ignore' });
    else if (process.platform === 'darwin') execSync(`open "${url}"`, { stdio: 'ignore' });
    else execSync(`xdg-open "${url}"`, { stdio: 'ignore' });
  } catch { console.log(`Open in browser: ${url}`); }
}

function showConfig() {
  const configFile = path.join(CONFIG_DIR, 'config.json');
  if (fs.existsSync(configFile)) {
    console.log(fs.readFileSync(configFile, 'utf-8'));
  } else {
    console.log('{}');
    console.log(`(Create ${configFile} to set persistent config)`);
  }
}

function showUninstall() {
  console.log(`
MAFW Uninstall

1. Remove plugin from opencode.json:
   - Edit ~/.config/opencode/config.json
   - Remove "opencode-plugin-mafw" from plugins array

2. Delete plugin data:
   rm -rf ~/.config/mafw
   rm -rf ~/.mafw

3. Uninstall npm package:
   npm uninstall -g opencode-plugin-mafw

4. Stop Gateway:
   mafw stop
  `);
}

async function main() {
  const cmd = process.argv[2];
  if (!cmd || cmd === '--help' || cmd === '-h') { console.log(USAGE); return; }

  if (!COMMANDS.includes(cmd)) {
    console.error(`Unknown command: ${cmd}`);
    console.log(USAGE);
    process.exit(1);
  }

  switch (cmd) {
    case 'start': startGateway(false); break;
    case 'daemon': startGateway(true); break;
    case 'stop': stopGateway(); break;
    case 'status': showStatus(); break;
    case 'restart':
      stopGateway();
      startGateway(true);
      break;
    case 'logs': showLogs(); break;

    case 'health': await callApi('health', 'GET', '/health'); break;
    case 'restart-agent': await callApi('restart-agent', 'POST', '/api/runtime/restart-agent'); break;
    case 'stats': await callApi('stats', 'GET', '/api/stats'); break;
    case 'projects': await callApi('projects', 'GET', '/api/projects'); break;
    case 'goals': await callApi('goals', 'GET', '/api/goals'); break;
    case 'sessions': await callApi('sessions', 'GET', '/api/sessions'); break;
    case 'automations': await callApi('automations', 'GET', '/api/automations'); break;
    case 'approvals': await callApi('approvals', 'GET', '/api/approvals'); break;
    case 'triage': await callApi('triage', 'GET', '/api/triage'); break;

    case 'register': {
      const dir = process.argv[3];
      if (!dir) { console.error('Usage: mafw register <projectDir>'); process.exit(1); }
      await callApi('register', 'POST', '/register', { projectDir: path.resolve(dir), mafwDir: path.join(path.resolve(dir), '.mafw') });
      break;
    }
    case 'control': {
      const action = process.argv[3];
      const goalId = process.argv[4];
      if (!action || !goalId) { console.error('Usage: mafw control <pause|abort|force-phase> <goalId>'); process.exit(1); }
      await callApi('control', 'POST', '/control', { action: action.toUpperCase(), goalId });
      break;
    }
    case 'memory-search': {
      const query = process.argv.slice(3).join(' ');
      if (!query) { console.error('Usage: mafw memory-search <query>'); process.exit(1); }
      await callApi('memory-search', 'GET', `/api/memory/merged-search?query=${encodeURIComponent(query)}`);
      break;
    }

    case 'service-register': registerService(); break;
    case 'service-unregister': unregisterService(); break;
    case 'config': showConfig(); break;
    case 'dashboard': openDashboard(); break;
    case 'uninstall': showUninstall(); break;
    case 'version': console.log(`v${pkg.version}`); break;
    case 'update': requestUpdate(); break;
  }
}

// `mafw update`: write the self-update token (atomic tmp+rename). The running
// gateway watches ~/.mafw/pending-restart.json, rebuilds itself and hands off
// to a takeover process; it then notifies the caller session.
function requestUpdate() {
  const pid = readPid();
  if (!pid || !isRunning(pid)) {
    console.error('Gateway is not running. Start it first: mafw start / mafw daemon');
    process.exit(1);
  }
  ensureDirs();
  const token = {
    target: 'gateway',
    action: 'update',
    reason: 'mafw update (CLI)',
    requestedAt: new Date().toISOString(),
    delayMs: 3000,
  };
  const tmp = path.join(CONFIG_DIR, 'pending-restart.json.tmp');
  const dst = path.join(os.homedir(), '.mafw', 'pending-restart.json');
  try {
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(token, null, 2), 'utf-8');
    fs.renameSync(tmp, dst);
    console.log('Update requested: gateway will rebuild and restart itself (~3s).');
  } catch (err) {
    console.error(`Failed to write update token: ${err.message}`);
    process.exit(1);
  }
}

main().catch(err => { console.error(err.message); process.exit(1); });

