/**
 * Task 3 — freshness predicate and build-lock rules for the adapter helper.
 *
 * These cases run on temp directories only: the real `adapters/opencode/dist`
 * is never touched, so the suite stays fast and does not race the packaging
 * tests that share the helper.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  BUILD_LOCK_NAME,
  LOCK_STALE_MS,
  LOCK_TIMEOUT_MS,
  acquireBuildLock,
  adapterBuildFresh,
  adapterBuildStatus,
  decideBuildLock,
  ensureAdapterBuilt,
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
  write('tsconfig.build.json', 0);
  write('src/index.ts', 0);
  write('src/nested/deep.ts', 0);
  write('dist/index.js', MINUTE);
  write('dist/index.d.ts', MINUTE);
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

  it('rebuilds when tsconfig.build.json changes', () => {
    seedFreshLayout();
    write('tsconfig.build.json', MINUTE * 2);
    expect(adapterBuildFresh(adapterDir)).toBe(false);
  });

  it('reports stale when a required build input is missing', () => {
    seedFreshLayout();
    fs.rmSync(path.join(adapterDir, 'tsconfig.build.json'));
    expect(adapterBuildStatus(adapterDir).reason).toContain('tsconfig.build.json');

    seedFreshLayout();
    fs.rmSync(path.join(adapterDir, 'build.mjs'));
    expect(adapterBuildStatus(adapterDir).reason).toContain('build.mjs');
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

  it('rebuilds when either output is missing', () => {
    seedFreshLayout();
    fs.rmSync(path.join(adapterDir, 'dist', 'index.d.ts'));
    expect(adapterBuildStatus(adapterDir).reason).toContain('dist/index.d.ts');

    seedFreshLayout();
    fs.rmSync(path.join(adapterDir, 'dist', 'index.js'));
    expect(adapterBuildStatus(adapterDir).reason).toContain('dist/index.js');
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
    write('tsconfig.build.json', 0);
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

  it('fails loudly when a successful build left outputs behind', () => {
    seedFreshLayout();
    write('src/index.ts', MINUTE * 2);
    fs.rmSync(path.join(adapterDir, 'dist', 'index.d.ts'));

    const liar: BuildRunner = () => ({ status: 0 });
    expect(() => ensureAdapterBuilt({ adapterDir, run: liar })).toThrow(
      /exited 0 but dist\/index\.d\.ts is missing/,
    );
    expect(fs.existsSync(lockDir)).toBe(false);
  });
});
