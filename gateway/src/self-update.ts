import { spawn, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { log } from './core/utils/logger';

export interface UpdateToken {
  target: string;
  action: 'update' | 'restart';
  reason?: string;
  requestedAt?: string;
  delayMs?: number;
  commit?: string;
}

export interface RestartInfo {
  reason?: string;
  commit?: string;
  requestedAt?: string;
  sessionID?: string | null;
  startedAt?: string;
  success?: boolean;
  notified?: boolean;
  notifyFailed?: boolean;
}

const CONTROL_DIR = path.join(os.homedir(), '.mafw');
const TOKEN_FILE = path.join(CONTROL_DIR, 'pending-restart.json');
const LAST_RESTART_FILE = path.join(CONTROL_DIR, 'last-restart.json');
const TOKEN_POLL_MS = 2000;
const TOKEN_BAD_LIMIT = 5;

export function tokenFile(): string {
  return TOKEN_FILE;
}

// ── Token file ──

export function readUpdateToken(): UpdateToken | null {
  try {
    if (!fs.existsSync(TOKEN_FILE)) return null;
    // PowerShell 5.1 Set-Content -Encoding UTF8 writes a BOM; strip it so
    // agent-written tokens parse regardless of writer.
    const raw = fs.readFileSync(TOKEN_FILE, 'utf-8').replace(/^\uFEFF/, '');
    const token = JSON.parse(raw) as UpdateToken;
    if (token?.target !== 'gateway') return null;
    if (token.action !== 'update' && token.action !== 'restart') return null;
    return token;
  } catch {
    return null;
  }
}

export function removeToken(): void {
  try {
    fs.unlinkSync(TOKEN_FILE);
  } catch { /* already gone */ }
}

// ── Restart info (written before takeover, read by the successor) ──

export function writeRestartInfo(info: RestartInfo): void {
  try {
    if (!fs.existsSync(CONTROL_DIR)) fs.mkdirSync(CONTROL_DIR, { recursive: true });
    fs.writeFileSync(LAST_RESTART_FILE, JSON.stringify({ ...info, startedAt: new Date().toISOString() }, null, 2), 'utf-8');
  } catch (err: any) {
    log.warn(`[SelfUpdate] failed to write restart info: ${err.message}`);
  }
}

export function readRestartInfo(): RestartInfo | null {
  try {
    if (!fs.existsSync(LAST_RESTART_FILE)) return null;
    return JSON.parse(fs.readFileSync(LAST_RESTART_FILE, 'utf-8')) as RestartInfo;
  } catch {
    return null;
  }
}

export function markRestartNotified(ok: boolean): void {
  const info = readRestartInfo();
  if (!info) return;
  writeRestartInfo({
    ...info,
    success: true,
    notified: ok,
    notifyFailed: !ok,
  });
}

// ── Build & package ──

function gatewayPackageRoot(): string {
  // __dirname = <root>/gateway/dist
  return path.dirname(path.dirname(__filename));
}

export function buildGateway(): { ok: boolean; error?: string; skipped?: boolean } {
  return buildGatewayAt(gatewayPackageRoot());
}

/**
 * Build the gateway package at the given root. Global-install form (npm files
 * whitelist excludes src/ and tsconfig.json) cannot build in place — the
 * installed dist IS the newest artifact shipped by `install -g`, so degrade
 * `update` to a plain restart instead of aborting (historical bug: tsc failed
 * on .opencode/plugins/mafw-plugin.ts → ../src/plugin and the whole update
 * aborted, never restarting).
 */
export function buildGatewayAt(
  pkgRoot: string,
  runBuild: (pkgRoot: string) => { ok: boolean; error?: string } = runNpmBuild,
): { ok: boolean; error?: string; skipped?: boolean } {
  if (!fs.existsSync(path.join(pkgRoot, 'src'))) {
    log.info('[SelfUpdate] global install detected (no src/) — skip build, restart with installed dist');
    return { ok: true, skipped: true };
  }
  const r = runBuild(pkgRoot);
  if (!r.ok) return { ok: false, error: r.error };
  if (!fs.existsSync(path.join(pkgRoot, 'dist', 'index.js'))) {
    return { ok: false, error: 'dist/index.js missing after build' };
  }
  return { ok: true };
}

function runNpmBuild(pkgRoot: string): { ok: boolean; error?: string } {
  const r = spawnSync('npm', ['run', 'build'], {
    cwd: pkgRoot,
    shell: process.platform === 'win32',
    encoding: 'utf8',
    windowsHide: true,
    timeout: 5 * 60 * 1000,
  });
  if (r.status !== 0) {
    return { ok: false, error: (r.stderr || r.stdout || '').trim().slice(-800) };
  }
  return { ok: true };
}

// Best-effort npm packaging so the global `mafw` CLI/daemon entry also gets the
// new build. The pack target is the plugin root (parent of the gateway package)
// — that is what `mafw` resolves; failures are non-fatal and never block the
// takeover restart. Only meaningful for a source checkout (gateway/src exists).
export function repackageGlobal(): void {
  const root = path.dirname(gatewayPackageRoot());
  if (!fs.existsSync(path.join(root, 'package.json'))) return;
  if (!fs.existsSync(path.join(root, 'gateway', 'src'))) return;
  try {
    // --ignore-scripts: the build already ran in buildGateway; skipping the
    // prepare rebuild also keeps the --json stdout pure (no build logs before
    // the JSON array, which would break JSON.parse).
    const pack = spawnSync('npm', ['pack', '--json', '--ignore-scripts'], {
      cwd: root,
      shell: process.platform === 'win32',
      encoding: 'utf8',
      windowsHide: true,
      timeout: 120000,
    });
    if (pack.status !== 0) {
      log.warn(`[SelfUpdate] npm pack failed (non-fatal): ${(pack.stderr || '').trim().slice(-300)}`);
      return;
    }
    let tgz = '';
    try {
      const jsonStart = pack.stdout.indexOf('[');
      const parsed = JSON.parse(jsonStart >= 0 ? pack.stdout.slice(jsonStart) : pack.stdout);
      tgz = Array.isArray(parsed) ? String(parsed[parsed.length - 1]?.filename || '') : '';
    } catch {
      const lines = pack.stdout.trim().split(/\r?\n/);
      tgz = lines[lines.length - 1]?.trim() || '';
    }
    if (!tgz || !fs.existsSync(path.join(root, tgz))) return;
    const install = spawnSync('npm', ['install', '-g', path.join(root, tgz)], {
      shell: process.platform === 'win32',
      encoding: 'utf8',
      windowsHide: true,
      timeout: 180000,
    });
    if (install.status !== 0) {
      log.warn(`[SelfUpdate] npm install -g failed (non-fatal): ${(install.stderr || '').trim().slice(-300)}`);
    } else {
      log.info(`[SelfUpdate] repackaged to global npm (${tgz})`);
    }
  } catch (err: any) {
    log.warn(`[SelfUpdate] repackage failed (non-fatal): ${err.message}`);
  }
}

// ── Takeover (self-restart) ──

export function spawnTakeoverChild(): ReturnType<typeof spawn> | null {
  try {
    // Self-updates always rebuild dist first, so dist/index.js is the
    // up-to-date entry. __filename here is the module file (self-update.js),
    // not the gateway entry. detached+unref: on Windows the child dies with
    // its parent unless it gets its own process group.
    const entry = path.join(__dirname, 'index.js');
    const child = spawn(process.execPath, [entry], {
      env: { ...process.env, MAFW_TAKEOVER: '1' },
      stdio: 'ignore',
      detached: true,
      windowsHide: true,
    });
    child.unref();
    return child;
  } catch {
    return null;
  }
}

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// ── Token watcher (polls; rename-safe on Windows) ──

export interface SelfUpdateDeps {
  stop: () => void;
  /** Locate the caller session (the agent that wrote the token). */
  locateCaller: () => string | null;
  onError: (message: string) => void;
}

export function startTokenWatcher(deps: SelfUpdateDeps): () => void {
  let badCount = 0;
  let running = true;

  const timer = setInterval(async () => {
    if (!running) return;
    const token = readUpdateToken();
    if (!token) {
      // Distinguish "no token" (reset) from "token present but unreadable"
      // (count toward the bad-token limit so garbage never lingers forever).
      if (fs.existsSync(TOKEN_FILE)) {
        badCount++;
        if (badCount >= TOKEN_BAD_LIMIT) {
          removeToken();
          deps.onError('[SelfUpdate] token unreadable for 5 consecutive polls; removed');
          badCount = 0;
        }
      } else {
        badCount = 0;
      }
      return;
    }
    badCount = 0;

    // Token accepted: record the caller, remove the file (prevents loops), then
    // build if requested and hand off to the takeover child.
    const callerSession = deps.locateCaller();
    removeToken();
    deps.onError(`[SelfUpdate] token accepted: action=${token.action} reason=${token.reason || '-'} caller=${callerSession || 'unknown'}`);

    if (token.action === 'update') {
      const build = buildGateway();
      if (!build.ok) {
        deps.onError(`[SelfUpdate] build failed; update aborted, continuing with current build: ${build.error}`);
        return;
      }
      // Global-install form: nothing to repackage (the installed dist is the
      // artifact being restarted). repackageGlobal also self-guards, but the
      // explicit skip keeps intent clear.
      if (!build.skipped) repackageGlobal();
    }

    const delay = Math.max(0, token.delayMs ?? 5000);
    deps.onError(`[SelfUpdate] restarting gateway in ${delay}ms`);
    await sleep(delay);
    if (!running) return;

    writeRestartInfo({
      reason: token.reason,
      commit: token.commit,
      requestedAt: token.requestedAt,
      sessionID: callerSession,
    });

    const child = spawnTakeoverChild();
    if (!child) {
      deps.onError('[SelfUpdate] failed to spawn takeover child; aborting restart');
      return;
    }
    await sleep(2000);
    if (child.exitCode !== null) {
      deps.onError(`[SelfUpdate] takeover child exited early (code=${child.exitCode}); aborting restart`);
      return;
    }
    deps.onError('[SelfUpdate] takeover child alive; shutting down gracefully');
    running = false;
    deps.stop();
    process.exit(0);
  }, TOKEN_POLL_MS);
  timer.unref();

  return () => {
    running = false;
    clearInterval(timer);
  };
}
