import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const TRAY_PID_FILE = path.join(os.homedir(), '.config', 'mafw', 'tray.pid');
const TRAY_SCRIPT = path.join(__dirname, 'tray.ps1');

let trayProcess: ReturnType<typeof spawn> | null = null;

function writePid(pid: number) {
  try {
    fs.writeFileSync(TRAY_PID_FILE, String(pid));
  } catch {}
}

function readPid(): number | null {
  try {
    if (!fs.existsSync(TRAY_PID_FILE)) return null;
    const pid = Number(fs.readFileSync(TRAY_PID_FILE, 'utf-8').trim());
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function startTray(port: number): void {
  if (process.platform !== 'win32') return;
  if (process.env.MAFW_TRAY_ENABLED === '0' || process.env.MAFW_TRAY_ENABLED === 'false') return;
  if (trayProcess) return;
  if (!fs.existsSync(TRAY_SCRIPT)) return;

  // Clear any stale tray left over from a hard-killed previous gateway.
  const stalePid = readPid();
  if (stalePid && isAlive(stalePid)) {
    try {
      process.kill(stalePid);
    } catch {}
  }
  try {
    fs.unlinkSync(TRAY_PID_FILE);
  } catch {}

  const child = spawn(
    'powershell.exe',
    [
      '-NoProfile',
      '-STA',
      '-WindowStyle', 'Hidden',
      '-ExecutionPolicy', 'Bypass',
      '-File', TRAY_SCRIPT,
      '-Port', String(port),
      '-PidFile', TRAY_PID_FILE,
    ],
    { windowsHide: true },
  );

  trayProcess = child;

  child.on('exit', (code) => {
    if (trayProcess === child) trayProcess = null;
    if (code !== 0) {
      console.log(`[Tray] tray exited with code ${code}`);
    }
  });
  child.on('error', (err) => {
    console.log(`[Tray] failed to start tray: ${err.message}`);
    trayProcess = null;
  });

  console.log('[Tray] started on port ' + port);
}

export function stopTray(): void {
  const pid = readPid();
  if (pid && isAlive(pid)) {
    try {
      process.kill(pid);
    } catch {}
  }
  try {
    fs.unlinkSync(TRAY_PID_FILE);
  } catch {}
  if (trayProcess) {
    trayProcess.kill();
    trayProcess = null;
  }
}
