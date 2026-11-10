/**
 * Task 3 — freshness predicate and build-lock rules for the adapter helper.
 *
 * These cases run on temp directories only: the real `adapters/opencode/dist`
 * is never touched, so the suite stays fast and does not race the packaging
 * tests that share the helper.
 */
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  BUILD_LOCK_NAME,
  BUILD_LOCK_OWNER_FILE,
  BUILD_TIMEOUT_MS,
  LOCK_STALE_MS,
  LOCK_TIMEOUT_MS,
  PACKAGING_SUITE_TIMEOUT_MS,
  acquireBuildLock,
  adapterBuildFresh,
  adapterBuildStatus,
  buildInputFiles,
  decideBuildLock,
  ensureAdapterBuilt,
  isProcessAlive,
  readBuildLockOwner,
  removeStaleBuildLock,
  type BuildLockOwner,
  type BuildRunner,
} from '../../helpers/adapter-build';

const BASE_TIME = new Date('2026-01-01T00:00:00Z').getTime();
const MINUTE = 60_000;

let root: string;
let adapterDir: string;
let lockDir: string;

function write(rel: string, mtimeOffset: number): string {
  const file = path.join(adapterDir, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '// fixture\n');
  fs.utimesSync(file, new Date(BASE_TIME + mtimeOffset), new Date(BASE_TIME + mtimeOffset));
  return file;
}

/** Fresh layout: sources at T0, outputs at T0 + 1min. */
function seedFreshLayout(): void {
  write('build.mjs', 0);
  write('tsconfig.json', 0);
  write('tsconfig.build.json', 0);
  write('package.json', 0);
  write('src/index.ts', 0);
  write('src/nested/deep.ts', 0);
  write('dist/index.js', MINUTE);
  write('dist/index.d.ts', MINUTE);
  write('dist/package.json', MINUTE);
}

function ownerFile(): string {
  return path.join(lockDir, BUILD_LOCK_OWNER_FILE);
}

/** Create the lock dir with an owner file (optionally backdated lock mtime). */
function writeOwner(owner: BuildLockOwner, lockMtimeMs?: number): void {
  fs.mkdirSync(lockDir, { recursive: true });
  fs.writeFileSync(ownerFile(), JSON.stringify(owner));
  if (lockMtimeMs !== undefined) fs.utimesSync(lockDir, new Date(lockMtimeMs), new Date(lockMtimeMs));
}

function readOwner(): BuildLockOwner {
  return JSON.parse(fs.readFileSync(ownerFile(), 'utf8')) as BuildLockOwner;
}

/** PID of a child that already exited: `spawnSync` only returns after it did. */
function deadPid(): number {
  const child = spawnSync(process.execPath, ['-e', '']);
  if (!child.pid) throw new Error('could not spawn a probe process');
  return child.pid;
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-adapter-build-'));
  adapterDir = path.join(root, 'adapters', 'opencode');
  lockDir = path.join(adapterDir, BUILD_LOCK_NAME);
  fs.mkdirSync(adapterDir, { recursive: true });
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('freshness predicate', () => {
  it('treats a dist newer than every source as fresh', () => {
    seedFreshLayout();
    expect(adapterBuildFresh(adapterDir)).toBe(true);
    expect(adapterBuildStatus(adapterDir).reason).toBeUndefined();
  });

  it('rebuilds when a nested source is newer than dist', () => {
    seedFreshLayout();
    write('src/nested/deep.ts', MINUTE * 2);
    const status = adapterBuildStatus(adapterDir);
    expect(status.fresh).toBe(false);
    expect(status.reason).toContain(path.join('src', 'nested', 'deep.ts'));
  });

  it('treats equal mtimes as stale (coarse-resolution trees)', () => {
    seedFreshLayout();
    write('src/index.ts', MINUTE); // same instant as dist/index.js
    const status = adapterBuildStatus(adapterDir);
    expect(status.fresh).toBe(false);
    expect(status.reason).toContain('is as new as');
  });

  it('rebuilds when build.mjs changes', () => {
    seedFreshLayout();
    write('build.mjs', MINUTE * 2);
    expect(adapterBuildFresh(adapterDir)).toBe(false);
  });

  it('rebuilds when tsconfig.json changes', () => {
    // `tsconfig.build.json` extends it: a compiler-option edit must invalidate
    // the bundle even when no source file moved.
    seedFreshLayout();
    write('tsconfig.json', MINUTE * 2);
    expect(adapterBuildFresh(adapterDir)).toBe(false);
  });

  it('rebuilds when tsconfig.build.json changes', () => {
    seedFreshLayout();
    write('tsconfig.build.json', MINUTE * 2);
    expect(adapterBuildFresh(adapterDir)).toBe(false);
  });

  it('rebuilds when package.json changes', () => {
    // The package manifest decides the name/exports/type the bundle must
    // satisfy (`dist/package.json` mirrors its CJS type), so it is an input.
    seedFreshLayout();
    write('package.json', MINUTE * 2);
    expect(adapterBuildFresh(adapterDir)).toBe(false);
  });

  it('counts every adapter-root build input, not just the sources', () => {
    seedFreshLayout();
    const relative = buildInputFiles(adapterDir).map((file) => path.relative(adapterDir, file));
    expect(relative).toEqual(expect.arrayContaining([
      'build.mjs',
      'tsconfig.json',
      'tsconfig.build.json',
      'package.json',
      path.join('src', 'index.ts'),
      path.join('src', 'nested', 'deep.ts'),
    ]));
  });

  it('reports stale when a required build input is missing', () => {
    seedFreshLayout();
    fs.rmSync(path.join(adapterDir, 'tsconfig.build.json'));
    expect(adapterBuildStatus(adapterDir).reason).toContain('tsconfig.build.json');

    seedFreshLayout();
    fs.rmSync(path.join(adapterDir, 'build.mjs'));
    expect(adapterBuildStatus(adapterDir).reason).toContain('build.mjs');

    seedFreshLayout();
    fs.rmSync(path.join(adapterDir, 'tsconfig.json'));
    expect(adapterBuildStatus(adapterDir).reason).toContain('tsconfig.json');

    seedFreshLayout();
    fs.rmSync(path.join(adapterDir, 'package.json'));
    expect(adapterBuildStatus(adapterDir).reason).toContain('package.json');
  });

  it('reports a build input that disappears mid-check instead of throwing', () => {
    seedFreshLayout();
    const vanishing = path.join('src', 'index.ts');
    const status = adapterBuildStatus(adapterDir, {
      stat: (file) => {
        if (file.endsWith(vanishing)) return undefined; // vanished between walk and stat
        const stat = fs.statSync(file);
        return { file, mtimeMs: stat.mtimeMs };
      },
    });
    expect(status.fresh).toBe(false);
    expect(status.reason).toContain(vanishing);
    expect(status.reason).toContain('disappeared while checking freshness');
  });

  it('rebuilds when any output is missing, including dist/package.json', () => {
    seedFreshLayout();
    fs.rmSync(path.join(adapterDir, 'dist', 'index.d.ts'));
    expect(adapterBuildStatus(adapterDir).reason).toContain('dist/index.d.ts');

    seedFreshLayout();
    fs.rmSync(path.join(adapterDir, 'dist', 'index.js'));
    expect(adapterBuildStatus(adapterDir).reason).toContain('dist/index.js');

    // `opencode-package.test.ts` requires it; a bundle without the CJS type
    // marker would load as ESM, so a missing one must force a rebuild.
    seedFreshLayout();
    fs.rmSync(path.join(adapterDir, 'dist', 'package.json'));
    const status = adapterBuildStatus(adapterDir);
    expect(status.fresh).toBe(false);
    expect(status.reason).toContain('dist/package.json');
  });
});

describe('build lock decisions', () => {
  const base = { waitStartedAt: 0, staleMs: 60_000, waitMs: 30_000 };

  it('acquires when no lock exists', () => {
    expect(decideBuildLock({ ...base, exists: false, now: 0 })).toBe('acquire');
  });

  it('waits for a live holder', () => {
    expect(decideBuildLock({ ...base, exists: true, lockMtimeMs: 0, now: 20_000 })).toBe('wait');
  });

  it('removes a lock older than staleMs', () => {
    expect(decideBuildLock({ ...base, exists: true, lockMtimeMs: 0, now: 60_001 })).toBe('remove-stale');
  });

  it('prefers stealing a stale lock over timing out', () => {
    expect(decideBuildLock({
      ...base, exists: true, lockMtimeMs: 0, now: 10 * MINUTE, waitMs: 1_000,
    })).toBe('remove-stale');
  });

  it('times out once the wait budget is spent on a live lock', () => {
    expect(decideBuildLock({ ...base, exists: true, lockMtimeMs: 29_000, now: 30_000 })).toBe('timeout');
  });

  it('keeps the stale threshold below the wait timeout so a dead holder self-heals', () => {
    // If stale >= timeout, a crashed build's fresh lock makes every waiter time
    // out instead of stealing it; pin the relationship, not just the numbers.
    expect(LOCK_STALE_MS).toBeLessThan(LOCK_TIMEOUT_MS);
    // A lock that outlives the stale threshold is stolen before the budget ends.
    expect(decideBuildLock({
      exists: true,
      lockMtimeMs: 0,
      now: LOCK_STALE_MS + 1,
      waitStartedAt: 0,
      staleMs: LOCK_STALE_MS,
      waitMs: LOCK_TIMEOUT_MS,
    })).toBe('remove-stale');
  });

  it('pins the lock/build budget inside the packaging suite timeout', () => {
    expect(LOCK_STALE_MS).toBe(60_000);
    expect(LOCK_TIMEOUT_MS).toBe(150_000);
    expect(BUILD_TIMEOUT_MS).toBe(120_000);
    expect(PACKAGING_SUITE_TIMEOUT_MS).toBe(300_000);
    // A crashed holder is stolen at 60s; the winner still has its full build
    // budget, and even the worst-case waiter (full lock wait + its own build)
    // must fail with a helper message before Jest's suite timeout fires.
    expect(LOCK_STALE_MS).toBeLessThan(LOCK_TIMEOUT_MS);
    // The waiter must outlive a healthy but slow build: if a build could run
    // longer than the lock wait, a waiter would time out on a build that is
    // still going to finish and succeed.
    expect(BUILD_TIMEOUT_MS).toBeLessThan(LOCK_TIMEOUT_MS);
    expect(LOCK_TIMEOUT_MS + BUILD_TIMEOUT_MS).toBeLessThan(PACKAGING_SUITE_TIMEOUT_MS);
  });

  it('steals a lock whose recorded owner PID is dead, even when it is young', () => {
    const now = 10_000;
    expect(decideBuildLock({
      ...base,
      exists: true,
      lockMtimeMs: now, // brand new: only the dead PID can make it stale
      now,
      ownerAlive: false,
    })).toBe('remove-stale');
  });

  it('steals a dead owner even when the wait budget is already spent', () => {
    // Staleness wins over timeout: the holder is provably gone.
    expect(decideBuildLock({
      exists: true,
      lockMtimeMs: 10_000,
      now: 20_000,
      waitStartedAt: 0,
      waitMs: 0,
      staleMs: LOCK_STALE_MS,
      ownerAlive: false,
    })).toBe('remove-stale');
  });

  it('never steals a live owner by age, however old the lock is', () => {
    const old = { exists: true, lockMtimeMs: 0, now: 10 * MINUTE, staleMs: MINUTE };
    // Only the wait/timeout path may act on a live holder.
    expect(decideBuildLock({
      ...old, waitStartedAt: 9 * MINUTE, waitMs: 5 * MINUTE, ownerAlive: true,
    })).toBe('wait');
    expect(decideBuildLock({ ...old, waitStartedAt: 0, waitMs: MINUTE, ownerAlive: true })).toBe('timeout');
  });

  it('waits for a lock whose recorded owner PID is alive', () => {
    const now = 10_000;
    expect(decideBuildLock({
      ...base,
      exists: true,
      lockMtimeMs: now,
      now,
      ownerAlive: true,
    })).toBe('wait');
  });

  it('falls back to the age rule when the owner liveness is unknown', () => {
    // Fresh + unknown liveness must not be stolen (only age can make it stale).
    expect(decideBuildLock({
      ...base, exists: true, lockMtimeMs: 10_000, now: 10_000, ownerAlive: undefined,
    })).toBe('wait');
    // Old + unknown liveness is still healed by the age rule.
    expect(decideBuildLock({
      ...base, exists: true, lockMtimeMs: 0, now: 60_001, ownerAlive: undefined,
    })).toBe('remove-stale');
  });
});

describe('process liveness probe', () => {
  it('treats a live PID as alive', () => {
    expect(isProcessAlive(process.pid)).toBe(true);
  });

  it('treats an exited PID as dead (ESRCH)', () => {
    expect(isProcessAlive(deadPid())).toBe(false);
  });

  it('treats only ESRCH as dead: EPERM still means alive', () => {
    const throwing = (code: string) => () => {
      const err: NodeJS.ErrnoException = new Error(code);
      err.code = code;
      throw err;
    };
    expect(isProcessAlive(1234, throwing('EPERM'))).toBe(true);
    expect(isProcessAlive(1234, throwing('ESRCH'))).toBe(false);
  });

  it('reports an unusable PID as unknown instead of dead', () => {
    expect(isProcessAlive(0)).toBeUndefined();
    expect(isProcessAlive(Number.NaN)).toBeUndefined();
  });
});

describe('build lock', () => {
  it('acquires, then releases by removing the lock directory', () => {
    const release = acquireBuildLock(adapterDir);
    expect(fs.existsSync(lockDir)).toBe(true);
    release();
    expect(fs.existsSync(lockDir)).toBe(false);
    expect(() => release()).not.toThrow();
  });

  it('waits for a live holder instead of building twice', () => {
    fs.mkdirSync(lockDir);
    const waits: number[] = [];
    const release = acquireBuildLock(adapterDir, {
      now: () => Date.now(),
      pollMs: 100,
      waitMs: 10_000,
      sleep: (ms) => {
        waits.push(ms);
        // Simulate the other worker finishing its build and dropping the lock.
        fs.rmSync(lockDir, { recursive: true, force: true });
      },
    });

    expect(waits).toEqual([100]);
    expect(fs.existsSync(lockDir)).toBe(true);
    release();
    expect(fs.existsSync(lockDir)).toBe(false);
  });

  it('steals an abandoned lock without waiting', () => {
    fs.mkdirSync(lockDir);
    fs.utimesSync(lockDir, new Date(Date.now() - 10 * MINUTE), new Date(Date.now() - 10 * MINUTE));

    const release = acquireBuildLock(adapterDir, {
      now: () => Date.now(),
      staleMs: MINUTE,
      waitMs: 1_000,
      sleep: () => {
        throw new Error('a stale lock must not make the caller sleep');
      },
    });
    expect(fs.existsSync(lockDir)).toBe(true);
    release();
  });

  it('throws instead of building when a live lock outlives the wait budget', () => {
    fs.mkdirSync(lockDir);
    expect(() => acquireBuildLock(adapterDir, { waitMs: 0, sleep: () => {} })).toThrow(/timed out/);
    fs.rmSync(lockDir, { recursive: true, force: true });
  });
});

describe('build lock ownership', () => {
  it('records the owner token, PID and start time in the lock directory', () => {
    const before = Date.now();
    const release = acquireBuildLock(adapterDir);
    const owner = readOwner();
    expect(typeof owner.token).toBe('string');
    expect(owner.token.length).toBeGreaterThan(8);
    expect(owner.pid).toBe(process.pid);
    expect(owner.startedAt).toBeGreaterThanOrEqual(before);
    expect(owner.startedAt).toBeLessThanOrEqual(Date.now());
    expect(readBuildLockOwner(lockDir)?.token).toBe(owner.token);
    release();
  });

  it('does not release a lock another worker now owns (token mismatch)', () => {
    const release = acquireBuildLock(adapterDir);
    const stolen = { ...readOwner(), token: 'someone-else' };
    fs.writeFileSync(ownerFile(), JSON.stringify(stolen));

    release();
    expect(fs.existsSync(lockDir)).toBe(true);
    expect(readOwner().token).toBe('someone-else');
    // Releasing again is still a no-op, and never throws.
    expect(() => release()).not.toThrow();
    expect(fs.existsSync(lockDir)).toBe(true);
    fs.rmSync(lockDir, { recursive: true, force: true });
  });

  it('steals a fresh lock whose owner PID has exited', () => {
    writeOwner({ token: 'dead', pid: deadPid(), startedAt: Date.now() });

    const release = acquireBuildLock(adapterDir, {
      now: () => Date.now(),
      staleMs: 10 * MINUTE, // age rule cannot fire: only the dead PID can
      waitMs: 1_000,
      sleep: () => {
        throw new Error('a dead owner must not make the caller sleep');
      },
    });
    const owner = readOwner();
    expect(owner.token).not.toBe('dead');
    expect(owner.pid).toBe(process.pid);
    release();
    expect(fs.existsSync(lockDir)).toBe(false);
  });

  it('keeps waiting for a fresh lock whose owner PID is alive', () => {
    writeOwner({ token: 'alive', pid: process.pid, startedAt: Date.now() });

    expect(() => acquireBuildLock(adapterDir, {
      now: () => Date.now(),
      staleMs: 10 * MINUTE,
      waitMs: 0,
      sleep: () => {},
    })).toThrow(/timed out/);
    expect(readOwner().token).toBe('alive');
    fs.rmSync(lockDir, { recursive: true, force: true });
  });

  it('does not age-steal a live owner even when the lock looks old', () => {
    // A legitimate 60-150s build must not be double-run: only the wait budget
    // may give up on a live holder.
    writeOwner({ token: 'slow', pid: process.pid, startedAt: Date.now() }, Date.now() - 10 * MINUTE);

    expect(() => acquireBuildLock(adapterDir, {
      now: () => Date.now(),
      staleMs: MINUTE,
      waitMs: 0,
      sleep: () => {},
    })).toThrow(/timed out/);
    expect(readOwner().token).toBe('slow');
    fs.rmSync(lockDir, { recursive: true, force: true });
  });

  it('feeds the recorded PID into the lock decision', () => {
    const dead = deadPid();
    writeOwner({ token: 'dead', pid: dead, startedAt: Date.now() });
    const seen: number[] = [];
    const release = acquireBuildLock(adapterDir, {
      now: () => Date.now(),
      staleMs: 10 * MINUTE,
      waitMs: 0,
      probe: (pid) => {
        seen.push(pid);
        return false;
      },
      sleep: () => {},
    });
    expect(seen).toContain(dead);
    release();
  });

  it('does not let a stale steal delete the new holder lock on the old holder release', () => {
    const releaseOld = acquireBuildLock(adapterDir);
    // The old holder's process dies: its lock is young but its PID is gone.
    writeOwner({ token: 'old', pid: deadPid(), startedAt: Date.now() });
    expect(fs.existsSync(lockDir)).toBe(true);

    const releaseNew = acquireBuildLock(adapterDir, {
      staleMs: 10 * MINUTE, waitMs: 1_000, sleep: () => {},
    });
    expect(readOwner().token).not.toBe('old');

    releaseOld(); // old `finally` runs after the steal
    expect(fs.existsSync(lockDir)).toBe(true);
    expect(readOwner().pid).toBe(process.pid);
    releaseNew();
    expect(fs.existsSync(lockDir)).toBe(false);
  });

  it('removes a stale lock and aborts if the token changes meanwhile', () => {
    writeOwner({ token: 'stale', pid: process.pid, startedAt: 0 }, Date.now() - 10 * MINUTE);
    expect(removeStaleBuildLock(lockDir, 'stale')).toBe(true);
    expect(fs.existsSync(lockDir)).toBe(false);

    writeOwner({ token: 'stale', pid: process.pid, startedAt: 0 }, Date.now() - 10 * MINUTE);
    expect(removeStaleBuildLock(lockDir, 'stale', {
      readOwner: () => ({ token: 'fresh', pid: process.pid, startedAt: Date.now() }),
    })).toBe(false);
    expect(fs.existsSync(lockDir)).toBe(true);
    expect(readOwner().token).toBe('stale');
  });

  it('falls back to the age rule when the owner file is unreadable', () => {
    fs.mkdirSync(lockDir);
    fs.writeFileSync(ownerFile(), 'not json');
    // Fresh + corrupt: cannot prove the holder is dead, so wait (and time out).
    expect(() => acquireBuildLock(adapterDir, { waitMs: 0, sleep: () => {} })).toThrow(/timed out/);

    // Old + corrupt: the age rule still heals the lock.
    fs.utimesSync(lockDir, new Date(Date.now() - 10 * MINUTE), new Date(Date.now() - 10 * MINUTE));
    const release = acquireBuildLock(adapterDir, {
      staleMs: MINUTE, waitMs: 1_000, sleep: () => { throw new Error('must not sleep'); },
    });
    expect(readOwner().pid).toBe(process.pid);
    release();
    expect(fs.existsSync(lockDir)).toBe(false);
  });
});

describe('ensureAdapterBuilt', () => {
  it('does not invoke the build (or take the lock) when dist is fresh', () => {
    seedFreshLayout();
    const run: BuildRunner = jest.fn(() => ({ status: 0 }));
    ensureAdapterBuilt({ adapterDir, run });
    expect(run).not.toHaveBeenCalled();
    expect(fs.existsSync(lockDir)).toBe(false);
  });

  it('builds when stale, holds the lock while running, and releases it', () => {
    seedFreshLayout();
    write('src/index.ts', MINUTE * 2); // stale

    const run: BuildRunner = jest.fn((dir: string) => {
      expect(fs.existsSync(lockDir)).toBe(true);
      write('dist/index.js', MINUTE * 3);
      write('dist/index.d.ts', MINUTE * 3);
      write('dist/package.json', MINUTE * 3);
      return { status: 0 };
    });
    ensureAdapterBuilt({ adapterDir, run });

    expect(run).toHaveBeenCalledTimes(1);
    expect((run as jest.Mock).mock.calls[0][0]).toBe(adapterDir);
    expect(fs.existsSync(lockDir)).toBe(false);
    // The freshly written outputs make the next call a no-op.
    const again: BuildRunner = jest.fn(() => ({ status: 0 }));
    ensureAdapterBuilt({ adapterDir, run: again });
    expect(again).not.toHaveBeenCalled();
  });

  it('skips the build when another worker finished while we waited', () => {
    write('src/index.ts', 0);
    write('build.mjs', 0);
    write('tsconfig.json', 0);
    write('tsconfig.build.json', 0);
    write('package.json', 0);
    // No dist yet → stale; a live lock makes us wait, and the holder finishes
    // (writes dist + drops the lock) before the retry.
    fs.mkdirSync(lockDir);
    const run: BuildRunner = jest.fn(() => ({ status: 0 }));
    ensureAdapterBuilt({
      adapterDir,
      run,
      lock: {
        now: () => Date.now(),
        pollMs: 10,
        waitMs: 5_000,
        sleep: () => {
          write('dist/index.js', MINUTE);
          write('dist/index.d.ts', MINUTE);
          write('dist/package.json', MINUTE);
          fs.rmSync(lockDir, { recursive: true, force: true });
        },
      },
    });
    expect(run).not.toHaveBeenCalled();
    expect(fs.existsSync(lockDir)).toBe(false);
  });

  it('surfaces stdout/stderr and the exit code on failure', () => {
    seedFreshLayout();
    write('src/index.ts', MINUTE * 2);

    const failing: BuildRunner = () => ({ status: 1, stdout: 'esbuild out', stderr: 'boom: tsconfig' });
    expect(() => ensureAdapterBuilt({ adapterDir, run: failing })).toThrow(/boom: tsconfig/);
    expect(() => ensureAdapterBuilt({ adapterDir, run: failing })).toThrow(/esbuild out/);
    expect(() => ensureAdapterBuilt({ adapterDir, run: failing })).toThrow(/exit 1/);
    expect(fs.existsSync(lockDir)).toBe(false);
  });

  it('diagnoses a spawn failure with error message and signal', () => {
    seedFreshLayout();
    write('src/index.ts', MINUTE * 2);

    const spawnFailure: BuildRunner = () => ({
      status: null,
      error: { message: 'spawn node ENOENT' },
      signal: 'SIGTERM',
    });
    expect(() => ensureAdapterBuilt({ adapterDir, run: spawnFailure })).toThrow(/spawn node ENOENT/);
    expect(() => ensureAdapterBuilt({ adapterDir, run: spawnFailure })).toThrow(/SIGTERM/);
    expect(fs.existsSync(lockDir)).toBe(false);
  });

  it('diagnoses a build timeout by naming the limit and the kill signal', () => {
    seedFreshLayout();
    write('src/index.ts', MINUTE * 2);

    // `spawnSync` reports a timeout as status null + error.code ETIMEDOUT.
    const hung: BuildRunner = () => ({
      status: null,
      error: { message: 'spawnSync node ETIMEDOUT', code: 'ETIMEDOUT' },
      signal: 'SIGTERM',
    });
    expect(() => ensureAdapterBuilt({ adapterDir, run: hung, timeoutMs: 1_000 })).toThrow(
      /timed out after 1000ms \(killed by SIGTERM\)/,
    );
    expect(fs.existsSync(lockDir)).toBe(false);
  });

  it('fails loudly when a successful build left outputs behind', () => {
    seedFreshLayout();
    write('src/index.ts', MINUTE * 2);
    fs.rmSync(path.join(adapterDir, 'dist', 'index.d.ts'));

    const liar: BuildRunner = () => ({ status: 0 });
    expect(() => ensureAdapterBuilt({ adapterDir, run: liar })).toThrow(
      /exited 0 but dist\/index\.d\.ts is missing/,
    );

    // `dist/package.json` is part of the contract too (CJS entry type).
    seedFreshLayout();
    write('src/index.ts', MINUTE * 2);
    fs.rmSync(path.join(adapterDir, 'dist', 'package.json'));
    expect(() => ensureAdapterBuilt({ adapterDir, run: liar })).toThrow(
      /exited 0 but dist\/package\.json is missing/,
    );
    expect(fs.existsSync(lockDir)).toBe(false);
  });
});
