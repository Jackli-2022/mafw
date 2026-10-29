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
import { ensureRuntimeRoot, resolveRuntimeRoot } from './runtime-root';

// Kill whatever is listening on the serve port. windowsHide is mandatory:
// execSync defaults to a visible console window, so every call here would
// flash a cmd popup (notably during serve crash-recovery). SIGTERM is NOT
// used: on Windows libuv maps SIGTERM to a console CTRL_C broadcast, which
// makes a process exit with 0xC000013A and can trigger recovery loops;
// hard-kill instead. Lives here (not gateway core) because the serve port is
// an opencode-runtime implementation detail.
export function killServePort(port: number): void {
  try {
    if (process.platform === 'win32') {
      const out = childProcess.execSync(`netstat -ano | findstr :${port}`, { windowsHide: true }).toString();
      // findstr ":4096" also matches ":40960" etc. — require the exact local
      // port followed by whitespace on a LISTENING line before trusting the PID.
      const line = out.split(/\r?\n/).find((l) => new RegExp(`:${port}\\s`).test(l) && /LISTENING/i.test(l));
      const match = line ? line.match(/LISTENING\s+(\d+)/) : null;
      const pid = match ? Number(match[1]) : null;
      if (pid) process.kill(pid);
    } else {
      const out = childProcess.execSync(`lsof -ti:${port}`, { windowsHide: true }).toString().trim();
      const pid = Number(out) || null;
      if (pid) process.kill(pid);
    }
  } catch { /* port is free */ }
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

/** 密码单源（2026-10-22 修复）：env 显式优先（MAFW_RUNTIME_PASSWORD / MAFW_OPENCODE_PASSWORD /
 *  OPENCODE_SERVER_PASSWORD——外部 serve 模式用户自管），全缺省时进程内生成稳定随机值
 *  （owned sidecar 与 gateway 同生命周期，spawn 注入 + adapter 认证同源）。 */
let cachedServePassword: string | null = null;
export function resolveServePassword(): string {
  if (cachedServePassword) return cachedServePassword;
  cachedServePassword =
    process.env.MAFW_RUNTIME_PASSWORD ??
    process.env.MAFW_OPENCODE_PASSWORD ??
    process.env.OPENCODE_SERVER_PASSWORD ??
    `mafw-${require('crypto').randomUUID()}`;
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
