/**
 * Build helper for the extracted `@mafw/adapter-opencode` package.
 *
 * The packaging suites (`opencode-package.test.ts`, the staging test in
 * `plugin-package-e2e.test.ts`) assert against the *built* bundle, while Jest
 * resolves the package to its TypeScript source (see `jest.config.js`). A clean
 * checkout therefore has no `adapters/opencode/dist` and those suites fail for a
 * reason that has nothing to do with what they pin.
 *
 * `ensureAdapterBuilt()` closes that gap without turning every test run into a
 * build: the bundle is rebuilt only when an output is missing, a required build
 * input is missing, or an input is at least as new as the oldest output
 * (`src/**\/*.ts`, `build.mjs`, `tsconfig.build.json`).
 *
 * Concurrency: a plain `npx jest` runs suites in worker processes, and two of
 * them (unit package contract + integration staging) can reach this helper at
 * the same time. Both would otherwise build into the same `dist/` with
 * `esbuild` + `tsc` and corrupt each other's output. The build therefore runs
 * under an atomic directory lock (`<adapterDir>/.build-lock`, created with
 * `mkdirSync` so the winner is decided by the filesystem):
 *
 *  - the loser waits (blocking poll) until the winner releases the lock, then
 *    re-checks freshness — double-checked locking, so the second caller is a
 *    no-op instead of a duplicate build;
 *  - a lock older than `LOCK_STALE_MS` (90s, deliberately below the wait
 *    timeout) is treated as abandoned (a crashed/killed build) and removed, so
 *    the next waiter heals itself instead of timing out;
 *  - waiting is bounded by `LOCK_TIMEOUT_MS` (2 min, so the helper fails with a
 *    lock message before Jest's 240s suite timeout); a timeout throws instead of
 *    silently producing an unbuilt `dist`;
 *  - the lock is always removed in `finally`.
 */
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

export const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
export const ADAPTER_DIR = path.join(REPO_ROOT, 'adapters', 'opencode');

/** Outputs the packaging suites require. */
export const BUILD_OUTPUTS = ['dist/index.js', 'dist/index.d.ts'] as const;

/** Non-source build inputs at the adapter root. Missing any of these is stale. */
const BUILD_INPUT_FILES = ['build.mjs', 'tsconfig.build.json'] as const;

/** Lock directory: `mkdir` is atomic, so it doubles as the mutex. */
export const BUILD_LOCK_NAME = '.build-lock';
/** Give up waiting for another worker's build after this long. */
export const LOCK_TIMEOUT_MS = 2 * 60_000;
/**
 * A lock older than this is assumed abandoned (crashed build) and stolen.
 * Must stay **below** `LOCK_TIMEOUT_MS`: otherwise a crashed holder's fresh
 * lock would make every waiter time out instead of healing itself.
 */
export const LOCK_STALE_MS = 90_000;
/** Poll interval while another worker builds. */
export const LOCK_POLL_MS = 250;

export interface BuildInput {
  file: string;
  mtimeMs: number;
}

export interface AdapterBuildStatus {
  fresh: boolean;
  /** Why the build is stale (human readable, used in failure messages). */
  reason?: string;
  /** Newest source/input file that invalidated (or still permits) the build. */
  newestInput?: BuildInput;
  /** Oldest output, absent when an output is missing. */
  oldestOutput?: BuildInput;
}

function walkTypeScript(dir: string, out: string[]): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) walkTypeScript(file, out);
    else if (entry.isFile() && entry.name.endsWith('.ts')) out.push(file);
  }
  return out;
}

/** Existing files whose change must invalidate the bundle. */
export function buildInputFiles(adapterDir: string = ADAPTER_DIR): string[] {
  const files = BUILD_INPUT_FILES.map((name) => path.join(adapterDir, name))
    .filter((file) => fs.existsSync(file));
  return [...files, ...walkTypeScript(path.join(adapterDir, 'src'), [])];
}

function statOrUndefined(file: string): BuildInput | undefined {
  try {
    return { file, mtimeMs: fs.statSync(file).mtimeMs };
  } catch {
    return undefined;
  }
}

export interface BuildStatusDeps {
  /** Injection point for tests: `statOrUndefined` by default. */
  stat?: (file: string) => BuildInput | undefined;
}

/**
 * Pure freshness predicate: no build side effects, safe to unit-test with temp
 * directories. Fresh means every output exists, every required build input
 * exists, and no input is newer *or as new as* the oldest output — equal mtimes
 * count as stale because coarse resolutions (zip/tar extraction, some CI
 * checkouts) would otherwise hide a source edit behind a same-second dist.
 */
export function adapterBuildStatus(
  adapterDir: string = ADAPTER_DIR,
  deps: BuildStatusDeps = {},
): AdapterBuildStatus {
  const statFile = deps.stat ?? statOrUndefined;
  const outputs = BUILD_OUTPUTS.map((rel) => statFile(path.join(adapterDir, rel)));
  const missingOutput = BUILD_OUTPUTS.find((_, index) => !outputs[index]);
  if (missingOutput) return { fresh: false, reason: `${missingOutput} is missing` };

  // A missing `build.mjs`/`tsconfig.build.json` means the tree cannot be built
  // correctly: report stale instead of silently shrinking the input set.
  const missingInput = BUILD_INPUT_FILES
    .map((name) => path.join(adapterDir, name))
    .find((file) => !fs.existsSync(file));
  if (missingInput) {
    return { fresh: false, reason: `${path.relative(adapterDir, missingInput)} is missing` };
  }

  const inputs: BuildInput[] = [];
  for (const file of buildInputFiles(adapterDir)) {
    const stat = statFile(file);
    // A source can vanish between the directory walk and the stat (concurrent
    // checkout/clean). Report it as stale with the file name instead of
    // dereferencing `undefined` and throwing an opaque TypeError.
    if (!stat) {
      return { fresh: false, reason: `${path.relative(adapterDir, file)} disappeared while checking freshness` };
    }
    inputs.push(stat);
  }
  const present = outputs as BuildInput[];
  const newestInput = inputs.reduce((a, b) => (b.mtimeMs > a.mtimeMs ? b : a));
  const oldestOutput = present.reduce((a, b) => (b.mtimeMs < a.mtimeMs ? b : a));
  if (newestInput.mtimeMs >= oldestOutput.mtimeMs) {
    const relation = newestInput.mtimeMs === oldestOutput.mtimeMs ? 'is as new as' : 'is newer than';
    return {
      fresh: false,
      reason: `${path.relative(adapterDir, newestInput.file)} ${relation} ${path.relative(adapterDir, oldestOutput.file)}`,
      newestInput,
      oldestOutput,
    };
  }
  return { fresh: true, newestInput, oldestOutput };
}

export function adapterBuildFresh(adapterDir: string = ADAPTER_DIR): boolean {
  return adapterBuildStatus(adapterDir).fresh;
}

export type BuildLockDecision = 'acquire' | 'remove-stale' | 'wait' | 'timeout';

export interface BuildLockDecisionInput {
  /** Does the lock directory exist right now? */
  exists: boolean;
  /** mtime of the lock directory (when it exists). */
  lockMtimeMs?: number;
  now: number;
  /** When this process started waiting. */
  waitStartedAt: number;
  /** Max time to wait for the holder; defaults to `LOCK_TIMEOUT_MS`. */
  waitMs?: number;
  /** Age after which a lock is abandoned; defaults to `LOCK_STALE_MS`. */
  staleMs?: number;
}

/**
 * Pure lock state machine, extracted so the wait/stale/timeout rules are
 * unit-testable without touching a real build. Staleness wins over timeout: if
 * the holder is gone, taking the lock over is better than failing.
 */
export function decideBuildLock(input: BuildLockDecisionInput): BuildLockDecision {
  if (!input.exists) return 'acquire';
  const staleMs = input.staleMs ?? LOCK_STALE_MS;
  const waitMs = input.waitMs ?? LOCK_TIMEOUT_MS;
  if (typeof input.lockMtimeMs === 'number' && input.now - input.lockMtimeMs > staleMs) return 'remove-stale';
  if (input.now - input.waitStartedAt >= waitMs) return 'timeout';
  return 'wait';
}

/** Blocking sleep without a busy loop (Node main thread may use Atomics.wait). */
function blockingSleep(ms: number): void {
  if (ms <= 0) return;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export interface BuildLockOptions {
  waitMs?: number;
  staleMs?: number;
  pollMs?: number;
  now?: () => number;
  /** Injection point for tests: defaults to a blocking `Atomics.wait` sleep. */
  sleep?: (ms: number) => void;
}

/**
 * Acquire the build lock and return its release function. Callers must release
 * in `finally`; the release is idempotent and tolerates an already-removed lock.
 */
export function acquireBuildLock(adapterDir: string = ADAPTER_DIR, options: BuildLockOptions = {}): () => void {
  const lockDir = path.join(adapterDir, BUILD_LOCK_NAME);
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? blockingSleep;
  const pollMs = options.pollMs ?? LOCK_POLL_MS;
  const waitStartedAt = now();
  const release = () => {
    try {
      fs.rmSync(lockDir, { recursive: true, force: true });
    } catch { /* releasing must never mask the build outcome */ }
  };

  for (;;) {
    const stat = statOrUndefined(lockDir);
    const decision = decideBuildLock({
      exists: !!stat,
      lockMtimeMs: stat?.mtimeMs,
      now: now(),
      waitStartedAt,
      waitMs: options.waitMs,
      staleMs: options.staleMs,
    });

    if (decision === 'timeout') {
      throw new Error(
        `timed out after ${now() - waitStartedAt}ms waiting for ${lockDir} `
        + '(another worker is building @mafw/adapter-opencode; remove the lock if that build is dead)',
      );
    }
    if (decision === 'remove-stale') {
      release();
      // Retry immediately: the stale holder is gone, no reason to wait a poll.
      continue;
    }
    if (decision === 'acquire') {
      try {
        fs.mkdirSync(lockDir);
        return release;
      } catch (err: any) {
        // Lost the mkdir race — keep waiting instead of building twice.
        if (err?.code !== 'EEXIST') throw err;
      }
    }
    sleep(pollMs);
  }
}

export type BuildRunner = (adapterDir: string) => {
  status: number | null;
  stdout?: string | null;
  stderr?: string | null;
  /** Set by `spawnSync` when the process could not be started at all. */
  error?: { message?: string } | null;
  signal?: string | null;
};

function defaultRunner(adapterDir: string): ReturnType<BuildRunner> {
  return spawnSync(process.execPath, [path.join(adapterDir, 'build.mjs')], {
    cwd: adapterDir,
    encoding: 'utf8',
    env: process.env,
  });
}

function describeBuildFailure(status: AdapterBuildStatus, result: ReturnType<BuildRunner>): string {
  const outcome = result.status === null
    ? `no exit status${result.error?.message ? ` (spawn failed: ${result.error.message})` : ' (spawn failed)'}`
    : `exit ${result.status}`;
  const signal = result.signal ? `; signal ${result.signal}` : '';
  const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
  return `@mafw/adapter-opencode build failed (${status.reason ?? 'stale dist'}; ${outcome}${signal}):\n${output}`;
}

function assertBuildOutputs(adapterDir: string): void {
  const missing = BUILD_OUTPUTS.filter((rel) => !fs.existsSync(path.join(adapterDir, rel)));
  if (missing.length === 0) return;
  throw new Error(
    `@mafw/adapter-opencode build exited 0 but ${missing.join(' and ')} `
    + `${missing.length === 1 ? 'is' : 'are'} missing under ${adapterDir}`,
  );
}

export interface EnsureAdapterBuiltOptions {
  adapterDir?: string;
  /** Injection point for tests: defaults to `node build.mjs` in the adapter dir. */
  run?: BuildRunner;
  /** Lock timing/clock injection for tests. */
  lock?: BuildLockOptions;
}

/**
 * Build `adapters/opencode/dist` when it is missing or stale. Fresh trees return
 * immediately (no lock, no spawn). Otherwise the build runs under
 * `acquireBuildLock` with a double-checked freshness test, and failures throw
 * with the build's stdout/stderr, spawn error and signal.
 */
export function ensureAdapterBuilt(options: EnsureAdapterBuiltOptions = {}): void {
  const adapterDir = options.adapterDir ?? ADAPTER_DIR;
  if (adapterBuildStatus(adapterDir).fresh) return;

  const release = acquireBuildLock(adapterDir, options.lock);
  try {
    // Double-checked: a concurrent worker may have finished while we waited.
    const status = adapterBuildStatus(adapterDir);
    if (status.fresh) return;

    const result = (options.run ?? defaultRunner)(adapterDir);
    if (result.status !== 0) throw new Error(describeBuildFailure(status, result));
    assertBuildOutputs(adapterDir);
  } finally {
    // The lock must drop on success and on throw, and also on the
    // double-check early return.
    release();
  }
}
