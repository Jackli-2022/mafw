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
 * build: the bundle is rebuilt only when an output is missing (including
 * `dist/package.json`, which pins the CJS entry type), a required build input is
 * missing, or an input is at least as new as the oldest output (`src/**\/*.ts`,
 * `build.mjs`, `tsconfig.json`, `tsconfig.build.json`, `package.json`). A single
 * build is capped by `BUILD_TIMEOUT_MS` so a hung `esbuild`/`tsc` cannot stall
 * a Jest worker.
 *
 * Concurrency: a plain `npx jest` runs suites in worker processes, and two of
 * them (unit package contract + integration staging) can reach this helper at
 * the same time. Both would otherwise build into the same `dist/` with
 * `esbuild` + `tsc` and corrupt each other's output. The build therefore runs
 * under an atomic directory lock (`<adapterDir>/.build-lock`, created with
 * `mkdirSync` so the winner is decided by the filesystem):
 *
 *  - the winner records `.build-lock/owner.json` (`{ token, pid, startedAt }`)
 *    so the lock knows *who* holds it, not just how old it is;
 *  - the loser waits (blocking poll) until the winner releases the lock, then
 *    re-checks freshness — double-checked locking, so the second caller is a
 *    no-op instead of a duplicate build;
 *  - a lock is stale when its recorded PID is provably gone (only `ESRCH`
 *    proves that; `EPERM` still means alive), or when the owner file is
 *    unreadable and the lock is older than `LOCK_STALE_MS` (60s). A **live**
 *    owner is never stolen by age — a legitimate 60–150s build must not be
 *    double-run; only the wait budget may give up on it. A stale lock is
 *    removed after re-reading the token, so a lock that was taken over
 *    meanwhile survives;
 *  - waiting is bounded by `LOCK_TIMEOUT_MS` (150s, so the helper fails with a
 *    lock message before Jest's suite timeout); a timeout throws instead of
 *    silently producing an unbuilt `dist`;
 *  - release only deletes the lock when the owner token still matches, so a
 *    holder that lost the lock to a stale steal cannot delete the new holder's
 *    lock from its `finally`. Release is idempotent and never throws.
 */
import { spawnSync } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

export const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
export const ADAPTER_DIR = path.join(REPO_ROOT, 'adapters', 'opencode');

/** Outputs the packaging suites require (`build.mjs` writes all three). */
export const BUILD_OUTPUTS = ['dist/index.js', 'dist/index.d.ts', 'dist/package.json'] as const;

/**
 * Non-source build inputs at the adapter root. Missing any of these is stale.
 *
 * `tsconfig.json` and `package.json` are inputs even though `build.mjs` never
 * reads them directly: `tsc -p tsconfig.build.json` extends `tsconfig.json`, so
 * the compiler options shape `dist/index.d.ts`, and `package.json` governs the
 * package identity/exports that the staged `dist` must satisfy. Both affect the
 * build/package contract, so editing either has to invalidate `dist` even when
 * no source file changed.
 */
const BUILD_INPUT_FILES = ['build.mjs', 'tsconfig.json', 'tsconfig.build.json', 'package.json'] as const;

/** Lock directory: `mkdir` is atomic, so it doubles as the mutex. */
export const BUILD_LOCK_NAME = '.build-lock';
/** Ownership record written into the lock directory by the winning process. */
export const BUILD_LOCK_OWNER_FILE = 'owner.json';
/**
 * Jest timeout for the packaging suites that call `ensureAdapterBuilt`: lock
 * wait + build must finish inside this budget, or the worker is killed with an
 * opaque timeout instead of the helper's own diagnostic.
 */
export const PACKAGING_SUITE_TIMEOUT_MS = 300_000;
/** Give up waiting for another worker's build after this long. */
export const LOCK_TIMEOUT_MS = 150_000;
/**
 * Age after which a lock **with an unreadable owner file** is assumed abandoned
 * and stolen. A live owner is never stolen by age — it is only bounded by
 * `LOCK_TIMEOUT_MS` — so this must stay below the timeout to keep a crashed
 * holder's legacy/corrupt lock self-healing within the wait budget.
 */
export const LOCK_STALE_MS = 60_000;
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

  // A missing build input (`build.mjs`, the adapter `tsconfig.json` /
  // `tsconfig.build.json`, or `package.json`) means the tree cannot be built
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

/** What the lock holder records about itself. */
export interface BuildLockOwner {
  /** Random per-acquisition id; release/stale-removal must still match it. */
  token: string;
  /** PID of the holder, used as the liveness signal. */
  pid: number;
  /** Wall-clock acquisition time (diagnostics only, not the age rule). */
  startedAt: number;
}

function ownerFilePath(lockDir: string): string {
  return path.join(lockDir, BUILD_LOCK_OWNER_FILE);
}

/**
 * Read and validate `.build-lock/owner.json`. Returns `undefined` when it is
 * missing, half-written or corrupt — callers then fall back to the age rule
 * instead of guessing that the holder is dead.
 */
export function readBuildLockOwner(lockDir: string): BuildLockOwner | undefined {
  try {
    const raw = JSON.parse(fs.readFileSync(ownerFilePath(lockDir), 'utf8')) as Partial<BuildLockOwner>;
    if (typeof raw?.token !== 'string' || raw.token.length === 0) return undefined;
    if (typeof raw.pid !== 'number' || !Number.isInteger(raw.pid) || raw.pid <= 0) return undefined;
    return {
      token: raw.token,
      pid: raw.pid,
      startedAt: typeof raw.startedAt === 'number' ? raw.startedAt : 0,
    };
  } catch {
    return undefined;
  }
}

/** `true` = alive, `false` = provably gone, `undefined` = cannot tell. */
export type LivenessProbe = (pid: number) => boolean | undefined;

/**
 * `process.kill(pid, 0)` liveness probe. Only `ESRCH` proves the process is
 * gone; `EPERM` (a live process owned by someone else, common on Windows) must
 * count as alive — treating it as dead would steal a healthy holder's lock.
 */
export function isProcessAlive(
  pid: number,
  kill?: (pid: number, signal: number) => void,
): boolean | undefined {
  if (!Number.isInteger(pid) || pid <= 0) return undefined;
  const probe = kill ?? ((target: number, signal: number) => { process.kill(target, signal); });
  try {
    probe(pid, 0);
    return true;
  } catch (err: any) {
    return err?.code === 'ESRCH' ? false : true;
  }
}

export interface BuildLockDecisionInput {
  /** Does the lock directory exist right now? */
  exists: boolean;
  /** mtime of the lock directory (when it exists). */
  lockMtimeMs?: number;
  /**
   * Liveness of the recorded owner PID; `false` makes the lock stale
   * immediately and `undefined` (unreadable owner file) falls back to the age
   * rule. `true` is never stolen by age, only bounded by the wait budget.
   */
  ownerAlive?: boolean;
  now: number;
  /** When this process started waiting. */
  waitStartedAt: number;
  /** Max time to wait for the holder; defaults to `LOCK_TIMEOUT_MS`. */
  waitMs?: number;
  /** Age after which a lock without a readable owner is abandoned. */
  staleMs?: number;
}

/**
 * Pure lock state machine, extracted so the wait/stale/timeout rules are
 * unit-testable without touching a real build. Rule order matters:
 *
 *  1. a provably dead owner is stale regardless of age — stealing a crashed
 *     build's lock is always better than timing out;
 *  2. the age rule only applies when liveness is unknown (unreadable owner
 *     file); a live owner is never stolen by age, because a slow but healthy
 *     build would otherwise be started twice;
 *  3. a live (or unknown-and-young) owner is waited on until the budget ends.
 */
export function decideBuildLock(input: BuildLockDecisionInput): BuildLockDecision {
  if (!input.exists) return 'acquire';
  const staleMs = input.staleMs ?? LOCK_STALE_MS;
  const waitMs = input.waitMs ?? LOCK_TIMEOUT_MS;
  if (input.ownerAlive === false) return 'remove-stale';
  if (
    input.ownerAlive === undefined
    && typeof input.lockMtimeMs === 'number'
    && input.now - input.lockMtimeMs > staleMs
  ) return 'remove-stale';
  if (input.now - input.waitStartedAt >= waitMs) return 'timeout';
  return 'wait';
}

export interface StaleLockDeps {
  /** Injection point for tests: `readBuildLockOwner` by default. */
  readOwner?: (lockDir: string) => BuildLockOwner | undefined;
}

/**
 * Remove a lock that was decided stale, but only if its owner token is still
 * the one the decision was based on: between "stale" and `rm`, the abandoned
 * lock may have been taken over by a healthy holder. Returns whether the lock
 * was removed (a mismatch aborts and leaves it alone).
 *
 * The re-read narrows the race but cannot close it — there is no atomic
 * compare-and-delete — so the residual window stays a few syscalls wide.
 */
export function removeStaleBuildLock(
  lockDir: string,
  expectedToken: string | null,
  deps: StaleLockDeps = {},
): boolean {
  const readOwner = deps.readOwner ?? readBuildLockOwner;
  const token = readOwner(lockDir)?.token ?? null;
  if (token !== expectedToken) return false;
  try {
    fs.rmSync(lockDir, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
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
  /** Injection point for tests: defaults to `isProcessAlive`. */
  probe?: LivenessProbe;
}

/**
 * Write the ownership record for a lock directory we just created and return
 * its token-checked release.
 */
function claimBuildLock(lockDir: string, now: () => number): () => void {
  const owner: BuildLockOwner = {
    token: crypto.randomUUID(),
    pid: process.pid,
    startedAt: now(),
  };
  try {
    fs.writeFileSync(ownerFilePath(lockDir), JSON.stringify(owner));
  } catch (err: any) {
    // Without an ownership record the release could not prove the lock is ours,
    // so do not leave a lock nobody may remove: drop what we created and fail.
    try { fs.rmSync(lockDir, { recursive: true, force: true }); } catch { /* best effort */ }
    throw new Error(
      `could not record the build lock owner in ${lockDir}: ${err?.message ?? err}`,
    );
  }

  let released = false;
  return () => {
    if (released) return; // idempotent: `finally` plus an explicit call is fine
    released = true;
    try {
      // A stale steal may have handed the lock to another worker while this
      // build was still finishing; only the current owner may delete it. An
      // unreadable owner file therefore deletes nothing on purpose: this holder
      // waits for the age steal instead of risking another holder's lock.
      if (readBuildLockOwner(lockDir)?.token !== owner.token) return;
      fs.rmSync(lockDir, { recursive: true, force: true });
    } catch { /* releasing must never mask the build outcome */ }
  };
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
  const probe = options.probe ?? isProcessAlive;
  const waitStartedAt = now();

  for (;;) {
    const stat = statOrUndefined(lockDir);
    const owner = stat ? readBuildLockOwner(lockDir) : undefined;
    const decision = decideBuildLock({
      exists: !!stat,
      lockMtimeMs: stat?.mtimeMs,
      ownerAlive: owner ? probe(owner.pid) : undefined,
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
      // Removal aborts when the token changed, i.e. someone else already owns a
      // healthy lock: treat that like any other live holder and keep waiting.
      if (!removeStaleBuildLock(lockDir, owner?.token ?? null)) {
        sleep(pollMs);
        continue;
      }
      // Retry immediately: the stale holder is gone, no reason to wait a poll.
      continue;
    }
    if (decision === 'acquire') {
      try {
        fs.mkdirSync(lockDir);
        return claimBuildLock(lockDir, now);
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
  /** Set by `spawnSync` when the process could not be started or timed out. */
  error?: { message?: string; code?: string } | null;
  signal?: string | null;
};

/**
 * Backstop against a hung `esbuild`/`tsc`; normal builds take a few seconds.
 * It must stay *below* `LOCK_TIMEOUT_MS`: a waiter's wait budget has to outlive
 * a healthy but slow build, otherwise the waiter gives up on a build that is
 * still going to succeed. `LOCK_TIMEOUT_MS + BUILD_TIMEOUT_MS` must stay below
 * `PACKAGING_SUITE_TIMEOUT_MS`, so the helper's own diagnostics win over a
 * Jest worker timeout.
 */
export const BUILD_TIMEOUT_MS = 120_000;

function defaultRunner(adapterDir: string, timeoutMs: number): ReturnType<BuildRunner> {
  return spawnSync(process.execPath, [path.join(adapterDir, 'build.mjs')], {
    cwd: adapterDir,
    encoding: 'utf8',
    env: process.env,
    timeout: timeoutMs,
  });
}

function describeBuildFailure(
  status: AdapterBuildStatus,
  result: ReturnType<BuildRunner>,
  timeoutMs: number,
): string {
  const timedOut = result.error?.code === 'ETIMEDOUT';
  const cause = timedOut
    ? `timed out after ${timeoutMs}ms${result.signal ? ` (killed by ${result.signal})` : ''}`
    : result.status === null
      ? `no exit status${result.error?.message ? ` (spawn failed: ${result.error.message})` : ' (spawn failed)'}`
      : `exit ${result.status}`;
  const signal = !timedOut && result.signal ? `; signal ${result.signal}` : '';
  const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
  return `@mafw/adapter-opencode build failed (${status.reason ?? 'stale dist'}; ${cause}${signal}):\n${output}`;
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
  /** Hard cap on the build process; defaults to `BUILD_TIMEOUT_MS`. */
  timeoutMs?: number;
}

/**
 * Build `adapters/opencode/dist` when it is missing or stale. Fresh trees return
 * immediately (no lock, no spawn). Otherwise the build runs under
 * `acquireBuildLock` with a double-checked freshness test, is capped by
 * `BUILD_TIMEOUT_MS`, and failures throw with the build's stdout/stderr, spawn
 * error, timeout and signal.
 */
export function ensureAdapterBuilt(options: EnsureAdapterBuiltOptions = {}): void {
  const adapterDir = options.adapterDir ?? ADAPTER_DIR;
  const timeoutMs = options.timeoutMs ?? BUILD_TIMEOUT_MS;
  if (adapterBuildStatus(adapterDir).fresh) return;

  const release = acquireBuildLock(adapterDir, options.lock);
  try {
    // Double-checked: a concurrent worker may have finished while we waited.
    const status = adapterBuildStatus(adapterDir);
    if (status.fresh) return;

    const run = options.run ?? ((dir: string) => defaultRunner(dir, timeoutMs));
    const result = run(adapterDir);
    if (result.status !== 0) throw new Error(describeBuildFailure(status, result, timeoutMs));
    assertBuildOutputs(adapterDir);
  } finally {
    // The lock must drop on success and on throw, and also on the
    // double-check early return.
    release();
  }
}
