/**
 * Runs `opencode serve` as a supervised sidecar.
 *
 * Spawn options matter on Windows: the gateway usually runs detached (mafw
 * daemon / self-update takeover spawn it without a console). Spawning serve
 * without `windowsHide: true` makes each serve process create a NEW VISIBLE
 * console window — the user closes it, killing serve, and the watchdog
 * respawn pops the window again (the 2026-09-07 "black window" flapping
 * loop). The SDK's createOpencodeServer does not pass windowsHide, so we
 * hand-roll the spawn with the exact SDK contract: `opencode serve
 * --hostname=<host> --port=<port>`, env OPENCODE_CONFIG_CONTENT, readiness
 * on the stdout line "opencode server listening on <url>", timeout → tree
 * kill (taskkill /F /T — the cmd shim wrapper and opencode.exe form a tree).
 */
import * as childProcess from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ensureRuntimeRoot, resolveRuntimeRoot } from './runtime-root';

export interface KillServeDeps {
  platform?: NodeJS.Platform;
  execSync?: (command: string, options?: Record<string, unknown>) => any;
  execFileSync?: (file: string, args: string[], options?: Record<string, unknown>) => any;
  kill?: (pid: number, signal?: NodeJS.Signals | number) => void;
}

/** Extract the LISTENING pid for an exact port (never matches :40960). */
export function parseListeningPid(output: string, port: number): number | null {
  const line = output.split(/\r?\n/).find(
    (candidate) => new RegExp(`:${port}\\s`).test(candidate) && /LISTENING/i.test(candidate),
  );
  const match = line ? line.match(/LISTENING\s+(\d+)\s*$/i) : null;
  return match ? Number(match[1]) : null;
}

// Kill whatever is listening on the serve port. windowsHide is mandatory:
// execSync defaults to a visible console window, so every call here would
// flash a cmd popup (notably during serve crash-recovery). SIGTERM is NOT
// used: on Windows libuv maps SIGTERM to a console CTRL_C broadcast, which
// makes a process exit with 0xC000013A and can trigger recovery loops;
// hard-kill the whole tree instead (`taskkill /F /T`) — a bare process.kill
// can leave the actual listening child alive (observed with an orphaned
// opencode serve after a gateway restart). Lives here (not gateway core)
// because the serve port is an opencode-runtime implementation detail.
export function killServePort(port: number, deps: KillServeDeps = {}): void {
  const platform = deps.platform ?? process.platform;
  const execSync = deps.execSync ?? childProcess.execSync;
  const execFileSync = deps.execFileSync ?? childProcess.execFileSync;
  const kill = deps.kill ?? ((pid, signal) => process.kill(pid, signal));
  try {
    if (platform === 'win32') {
      // netstat can report PID 0 for listening sockets (observed on a
      // constrained/AppContainer-like session), so taskkill would be a no-op.
      // Get-NetTCPConnection reports the real owner; fall back to netstat only
      // when PowerShell is unavailable.
      let pid: number | null = null;
      try {
        const out = execFileSync(
          'powershell.exe',
          [
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            `Get-NetTCPConnection -LocalPort ${port} -ErrorAction SilentlyContinue | Where-Object RemotePort -eq 0 | Select-Object -First 1 -ExpandProperty OwningProcess`,
          ],
          { windowsHide: true },
        ).toString().trim();
        const parsed = Number(out);
        if (Number.isFinite(parsed) && parsed > 0) pid = parsed;
      } catch { /* fall through to netstat */ }
      if (!pid) {
        const out = execSync(`netstat -ano | findstr :${port}`, { windowsHide: true }).toString();
        pid = parseListeningPid(out, port);
      }
      if (pid && pid > 0) {
        execSync(`taskkill /F /T /PID ${pid}`, { windowsHide: true, stdio: 'ignore' });
      }
    } else {
      const out = execSync(`lsof -ti:${port}`, { windowsHide: true }).toString().trim();
      const pid = Number(out) || null;
      if (pid) kill(pid, 'SIGKILL');
    }
  } catch { /* port is free / process gone */ }
}

export interface ServeSidecarOptions {
  host: string;
  port: number;
  /** Server 启动根目录（绝对路径）。缺省 = 规范根 `~/.mafw/runtime-root`；
   *  绝不继承 gateway 进程 cwd。session 目录不由此决定。 */
  cwd?: string;
  /** How long to wait for the `opencode server listening` line. */
  timeoutMs?: number;
  /** Forwarded serve stdout/stderr chunks (restores [Serve] diagnostics). */
  onOutput?: (chunk: string) => void;
  /** Fired when the serve process exits after startup completed. */
  onExit?: (code: number | null) => void;
  /** 2.1.0 serve 强制 Basic auth——gateway 主动设 OPENCODE_SERVER_PASSWORD（双方已知，
   *  adapter 据此注入 Authorization 头；不设则 serve 随机生成密码、gateway 无法访问 API）。 */
  password?: string;
}

export interface ServeSidecar {
  url: string;
  close: () => void;
  /** 透传 spawn 时的密码（adapter 构造 Basic header 用）。 */
  password?: string;
}

let cachedServePassword: string | null = null;

/** Password file override (tests/embedding); default `~/.mafw/serve-password`. */
export function servePasswordFile(): string {
  const override = process.env.MAFW_SERVE_PASSWORD_FILE?.trim();
  return override || path.join(os.homedir(), '.mafw', 'serve-password');
}

function readPersistedServePassword(): string | null {
  try {
    const value = fs.readFileSync(servePasswordFile(), 'utf-8').trim();
    return value || null;
  } catch {
    return null;
  }
}

function persistServePassword(password: string): void {
  const file = servePasswordFile();
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, password, { encoding: 'utf-8', mode: 0o600 });
    fs.renameSync(tmp, file);
    try { fs.chmodSync(file, 0o600); } catch { /* windows */ }
  } catch {
    // fail-open: the current process still uses the generated value; a later
    // process simply cannot adopt this serve and will replace it.
  }
}

/** Password single source (2026-10-22 fix): env explicitly first; otherwise a
 *  stable per-user file so a *restarted gateway* can adopt the still-running
 *  serve. A per-process random value made every restart 401 against the old
 *  serve (orphaned listener → EADDRINUSE → MCP-only mode). */
export function resolveServePassword(): string {
  if (cachedServePassword) return cachedServePassword;
  const explicit =
    process.env.MAFW_RUNTIME_PASSWORD ??
    process.env.MAFW_OPENCODE_PASSWORD ??
    process.env.OPENCODE_SERVER_PASSWORD;
  if (explicit && explicit.trim()) {
    cachedServePassword = explicit;
    return cachedServePassword;
  }
  const persisted = readPersistedServePassword();
  if (persisted) {
    cachedServePassword = persisted;
    return cachedServePassword;
  }
  const generated = `mafw-${require('crypto').randomUUID()}`;
  persistServePassword(generated);
  cachedServePassword = generated;
  return cachedServePassword;
}

/** serve API 的 Basic auth 头（用户名恒为 opencode——2.1.0 官方约定）。 */
export function serveAuthHeaders(): Record<string, string> {
  return { Authorization: 'Basic ' + Buffer.from(`opencode:${resolveServePassword()}`).toString('base64') };
}

/** opencode 可执行文件解析（2026-10-23 事故：desktop dev 启动的 gateway PATH 首位是
 *  仓库 node_modules/.bin，cross-spawn('opencode') 解析到旧版 1.17.9，拒绝 2.1.0 配置
 *  键 websearch/permissions → serve 启动失败）。规则：
 *  ① MAFW_OPENCODE_BIN / OPENCODE_BIN 显式覆盖；② PATH 中跳过 node_modules/.bin
 *  （dev shim 不是用户安装的 opencode）；③ 取第一个存在的候选；④ 全缺省回退裸名。 */
export function resolveOpencodeBin(deps?: {
  env?: Record<string, string | undefined>;
  platform?: NodeJS.Platform;
  exists?: (p: string) => boolean;
}): string {
  const env = deps?.env ?? (process.env as Record<string, string | undefined>);
  const platform = deps?.platform ?? process.platform;
  const exists = deps?.exists ?? ((p: string) => require('fs').existsSync(p));
  const explicit = env.MAFW_OPENCODE_BIN || env.OPENCODE_BIN;
  if (explicit) return explicit;

  const pathKey = Object.keys(env).find((k) => k.toLowerCase() === 'path');
  const dirs = pathKey ? (env[pathKey] ?? '').split(platform === 'win32' ? ';' : ':') : [];
  const sep = platform === 'win32' ? '\\' : '/';
  const names = platform === 'win32'
    ? ['opencode.exe', 'opencode.cmd', 'opencode.bat', 'opencode']
    : ['opencode'];

  for (const dir of dirs) {
    if (!dir) continue;
    if (/[\\/]node_modules[\\/]\.bin[\\/]?$/i.test(dir)) continue;
    for (const name of names) {
      const candidate = `${dir.replace(/[\\/]+$/, '')}${sep}${name}`;
      if (exists(candidate)) return candidate;
    }
  }
  return 'opencode';
}

// cross-spawn resolves npm .cmd shims on Windows (plain child_process.spawn
// throws EINVAL for .cmd targets on Node >= 18.20). Shipped as an
// @opencode-ai/sdk dependency (hoisted); no direct type declarations needed.
const crossSpawn = require('cross-spawn') as (
  cmd: string,
  args: string[],
  opts: Record<string, unknown>,
) => any;

const isWindows = process.platform === 'win32';

/** Kill the whole process tree (cmd shim wrapper + opencode.exe). */
function treeKill(pid: number | undefined, child: any): void {
  try {
    if (isWindows && pid) {
      childProcess.execSync(`taskkill /F /T /PID ${pid}`, { windowsHide: true, stdio: 'ignore' });
    } else {
      child.kill('SIGKILL');
    }
  } catch { /* already gone */ }
}

export function startServeSidecar(opts: ServeSidecarOptions): Promise<ServeSidecar> {
  return new Promise((resolve, reject) => {
    const bin = resolveOpencodeBin();
    // 规范：server 固定从 runtime root 启动，不继承 gateway/Electron cwd。
    const cwd = ensureRuntimeRoot(opts.cwd ?? resolveRuntimeRoot());
    const child = crossSpawn(bin, ['serve', `--hostname=${opts.host}`, `--port=${opts.port}`], {
      cwd,
      env: {
        ...process.env,
        OPENCODE_CONFIG_CONTENT: '{}',
        // 2.1.0：显式密码 = gateway 与 serve 双方已知（不设则 serve 随机生成，API 不可达）
        ...(opts.password ? { OPENCODE_SERVER_PASSWORD: opts.password } : {}),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    let settled = false;
    let output = '';
    let url: string | null = null;

    const finish = (err: Error | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) {
        treeKill(child.pid, child);
        reject(err);
      } else {
        resolve({
          url: url!,
          close: () => {
            treeKill(child.pid, child);
            try { child.kill(); } catch { /* already gone */ }
          },
          ...(opts.password ? { password: opts.password } : {}),
        });
      }
    };

    const timer = setTimeout(() => {
      finish(new Error(`Timeout waiting for opencode serve to start after ${opts.timeoutMs ?? 30_000}ms`));
    }, opts.timeoutMs ?? 30_000);
    (timer as any).unref?.();

    child.stdout?.on('data', (chunk: Buffer | string) => {
      const text = chunk.toString();
      output += text;
      opts.onOutput?.(text);
      if (settled) return;
      for (const line of output.split('\n')) {
        // opencode ≤2.0 横幅 "opencode server listening on <url>"；2.1.0 起丢前缀
        // "server listening on <url>"（2026-10-22 生产事故：旧匹配 30s 超时 treeKill
        // 健康 serve）。endsWith 匹配两种格式，前缀噪声行不命中。
        if (/(?:^|\s)server listening on\s+https?:\/\//.test(line)) {
          const match = line.match(/on\s+(https?:\/\/[^\s]+)/);
          if (match) {
            url = match[1];
            finish(null);
            return;
          }
        }
      }
    });

    child.stderr?.on('data', (chunk: Buffer | string) => {
      const text = chunk.toString();
      output += text;
      opts.onOutput?.(text);
    });

    child.on('exit', (code: number | null) => {
      if (!settled) {
        finish(new Error(
          `opencode serve exited with code ${code} before becoming ready`
          + (output.trim() ? `\nServer output: ${output}` : ''),
        ));
      }
      opts.onExit?.(code);
    });

    child.on('error', (err: Error) => {
      finish(err);
    });
  });
}
