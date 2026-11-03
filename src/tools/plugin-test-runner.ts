/**
 * Fixed local test runner for Creator drafts (Task 4).
 *
 * `check` activates a candidate through the host; `test` is deliberately
 * narrower and fully local: `node --test` with the draft as cwd. There is no
 * package script, no shell, no npm install and no inherited environment beyond
 * what Node itself needs to start — a generated draft must not be able to read
 * host secrets through `process.env`.
 *
 * The runner can never hang the tool pipeline: the timeout kills the process
 * tree (Windows `taskkill /F /T`, otherwise `SIGKILL`) and resolves with
 * `timedOut: true`, and output is capped while being read so a chatty test
 * cannot flood the model context.
 */
import { spawn, type ChildProcess } from 'child_process';

/** Hard default wall-clock limit for one draft test run. */
export const DRAFT_TEST_TIMEOUT_MS = 60_000;
/** Default cap on returned stdout+stderr (UTF-8 bytes). */
export const DRAFT_TEST_MAX_OUTPUT_BYTES = 64 * 1024;

/** Environment keys the child may inherit (platform + locale only). */
const ENV_ALLOWLIST = [
  'PATH', 'Path',
  'SystemRoot', 'WINDIR',
  'HOME', 'USERPROFILE',
  'TMP', 'TEMP',
  'LANG', 'LC_ALL', 'LC_CTYPE', 'LC_MESSAGES', 'LANGUAGE',
] as const;

export interface DraftTestDeps {
  /** Child factory override (tests); defaults to `child_process.spawn`. */
  spawn?: typeof spawn;
  timeoutMs?: number;
  maxBytes?: number;
  /**
   * Receives every chunk before capping. The manager uses this to write the
   * full log while the model only ever sees the capped `output`.
   */
  onChunk?: (chunk: string) => void;
  /**
   * POSIX process-group kill seam: defaults to `process.kill(-pid, 'SIGKILL')`.
   * Tests inject it so a fake child never signals a real process group.
   */
  killGroup?: (pid: number) => void;
  /**
   * Platform override for tests: selects the tree-kill strategy
   * (`taskkill /F /T` on win32, negative-PID group kill otherwise).
   */
  platform?: NodeJS.Platform;
}

export interface DraftTestResult {
  /** Capped combined stdout+stderr, never longer than `maxBytes` characters. */
  output: string;
  truncated: boolean;
  exitCode: number | null;
  timedOut: boolean;
}

/** UTF-8 safe prefix of at most `maxBytes` bytes. */
function sliceUtf8(value: string, maxBytes: number): string {
  if (maxBytes <= 0) return '';
  if (Buffer.byteLength(value, 'utf8') <= maxBytes) return value;
  let low = 0;
  let high = value.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (Buffer.byteLength(value.slice(0, mid), 'utf8') <= maxBytes) low = mid;
    else high = mid - 1;
  }
  return value.slice(0, low);
}

/** Sanitized child environment: platform basics + locale + `NODE_ENV=test`. */
export function draftTestEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of ENV_ALLOWLIST) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  env.NODE_ENV = 'test';
  return env;
}

function chunkText(chunk: unknown): string {
  if (typeof chunk === 'string') return chunk;
  if (chunk instanceof Uint8Array) return Buffer.from(chunk).toString('utf8');
  return String(chunk ?? '');
}

/** Kills the whole tree; a nested npm/node test process must not survive. */
function killTree(
  child: ChildProcess | undefined,
  spawnFn: typeof spawn,
  killGroup: (pid: number) => void,
  platform: NodeJS.Platform,
): void {
  if (!child) return;
  const pid = typeof child.pid === 'number' ? child.pid : undefined;

  if (platform === 'win32') {
    try { child.kill('SIGKILL'); } catch { /* already gone */ }
    if (pid !== undefined) {
      try {
        spawnFn('taskkill', ['/pid', String(pid), '/F', '/T'], {
          windowsHide: true,
          stdio: 'ignore',
        });
      } catch { /* best effort */ }
    }
    return;
  }

  // POSIX: the child was spawned `detached`, so it leads its own process
  // group. `node --test` runs each test file in a grandchild; killing only the
  // direct child would leave that draft code (and anything it spawned) running.
  if (pid !== undefined) {
    try { killGroup(pid); } catch { /* group already gone */ }
  }
  try { child.kill('SIGKILL'); } catch { /* already gone */ }
}

/**
 * Runs `node --test` in the draft directory.
 *
 * Resolves (never rejects) with the capped output and how the run ended; a
 * timeout resolves immediately after the kill so the caller cannot hang.
 */
export function runDraftTests(
  directory: string,
  deps: DraftTestDeps = {},
): Promise<DraftTestResult> {
  const spawnFn = deps.spawn ?? spawn;
  const timeoutMs = deps.timeoutMs ?? DRAFT_TEST_TIMEOUT_MS;
  const maxBytes = deps.maxBytes ?? DRAFT_TEST_MAX_OUTPUT_BYTES;
  const platform = deps.platform ?? process.platform;
  const killGroup = deps.killGroup ?? ((pid: number) => { process.kill(-pid, 'SIGKILL'); });

  return new Promise<DraftTestResult>((resolve) => {
    let settled = false;
    let timedOut = false;
    let truncated = false;
    let bytes = 0;
    let output = '';
    let child: ChildProcess | undefined;

    const finish = (exitCode: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ output, truncated, exitCode, timedOut });
    };

    const append = (raw: unknown) => {
      if (settled) return;
      const text = chunkText(raw);
      if (text.length === 0) return;
      deps.onChunk?.(text);

      const size = Buffer.byteLength(text, 'utf8');
      if (bytes + size > maxBytes) {
        // Cap partial chunks too: keep the UTF-8 safe prefix that still fits.
        const piece = maxBytes > bytes ? sliceUtf8(text, maxBytes - bytes) : '';
        output += piece;
        bytes += Buffer.byteLength(piece, 'utf8');
        truncated = true;
        return;
      }
      output += text;
      bytes += size;
    };

    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child, spawnFn, killGroup, platform);
      finish(null);
    }, timeoutMs);
    (timer as any)?.unref?.();

    try {
      child = spawnFn(process.execPath, ['--test'], {
        cwd: directory,
        shell: false,
        windowsHide: true,
        // POSIX: own process group so a timeout can kill the per-file
        // `node --test` grandchildren too. Windows uses `taskkill /T` instead.
        detached: platform !== 'win32',
        env: draftTestEnv(),
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err: any) {
      output = `spawn failed: ${err?.message ?? String(err)}`;
      finish(null);
      return;
    }

    child.stdout?.on('data', append);
    child.stderr?.on('data', append);
    child.on('error', (err: any) => {
      append(`spawn error: ${err?.message ?? String(err)}`);
      finish(null);
    });
    child.on('close', (code: number | null) => {
      finish(typeof code === 'number' ? code : null);
    });
  });
}
