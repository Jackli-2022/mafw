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
      const match = out.match(/LISTENING\s+(\d+)/);
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
  /** How long to wait for the `opencode server listening` line. */
  timeoutMs?: number;
  /** Forwarded serve stdout/stderr chunks (restores [Serve] diagnostics). */
  onOutput?: (chunk: string) => void;
  /** Fired when the serve process exits after startup completed. */
  onExit?: (code: number | null) => void;
}

export interface ServeSidecar {
  url: string;
  close: () => void;
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
    const child = crossSpawn('opencode', ['serve', `--hostname=${opts.host}`, `--port=${opts.port}`], {
      env: { ...process.env, OPENCODE_CONFIG_CONTENT: '{}' },
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
        if (line.startsWith('opencode server listening')) {
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
