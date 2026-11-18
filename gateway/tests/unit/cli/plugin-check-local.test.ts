/**
 * `mafw plugin check` on an `untrusted` package.
 *
 * `untrusted` is the one package kind that exists *because* it is not trusted,
 * so it is exactly the kind that needs a local self-check loop. The CLI host now
 * wires the same worker path the gateway uses (`WorkerHost` + the Node
 * permission model), which means:
 *
 * - a real `untrusted` package is dry-run in a child process, never `require`d
 *   into the CLI process (the fixture throws if it ever is);
 * - the declaration bound still applies to what the worker delivers;
 * - the worker never outlives the check — neither on success, nor on a rejected
 *   contribution set, nor when the worker crashes mid-activation.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  createLocalCheck,
  createWorkerTracker,
  type LiveWorker,
  type WorkerChild,
} from '../../../src/cli/plugin-check-local';
import { permissionFlagFor } from '../../../src/plugins/worker/node-flags';
import { WorkerHost } from '../../../src/plugins/worker/worker-host';

// One check = one `fork()` + ready handshake; above the 5 s default on a cold
// Windows filesystem, so give the real-worker cases room without slowing them.
jest.setTimeout(20_000);

/**
 * The real worker can only start on a Node with the permission model. The whole
 * feature is fail-closed without it (`worker_unavailable`), so on such a Node
 * the worker-path cases cannot be exercised meaningfully — the fail-closed
 * answer is covered by `package-check-inventory.test.ts`.
 */
const hasPermissionModel = permissionFlagFor(process.execPath) !== null;
const itWorker = hasPermissionModel ? it : it.skip;

function tempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

interface UntrustedOptions {
  /** Extra/overriding `contributes` plane declaration. */
  contributes?: Record<string, unknown>;
  /** Entry source; defaults to a package that only works inside the worker. */
  body?: string;
}

/**
 * Writes a real directory package with `kind: "untrusted"`.
 *
 * The default entry asserts its own transport: `MAFW_WORKER_PERMISSIONS` is set
 * by `WorkerHost` in the child's env only, so a check that ever fell back to
 * `require()` in the CLI process fails with a self-describing message instead of
 * silently passing.
 */
function writeUntrusted(
  dir: string,
  name: string,
  options: UntrustedOptions = {},
): string {
  const root = path.join(dir, name);
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, 'plugin.json'), JSON.stringify({
    name,
    version: '1.0.0',
    main: 'index.js',
    apiVersion: 2,
    kind: 'untrusted',
    permissions: ['actions'],
    ...(options.contributes !== undefined ? { contributes: options.contributes } : {}),
  }));
  fs.writeFileSync(path.join(root, 'index.js'), options.body ?? `
if (!process.env.MAFW_WORKER_PERMISSIONS) {
  throw new Error('untrusted entry must never be required in the CLI process');
}
module.exports = {
  name: '${name}',
  async activate() {
    return { actions: { echo: { title: 'Echo', handler: (input) => input } } };
  },
};
`);
  return root;
}

/** Liveness probe: signal 0 only asks the OS whether the pid still exists. */
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Records every pid a worker had while the check was running. */
function watchPids(workers: WorkerHost[]): {
  seen: number[];
  stop(): void;
} {
  const seen: number[] = [];
  const timer = setInterval(() => {
    for (const worker of workers) {
      const pid = worker.getPid();
      if (typeof pid === 'number' && pid > 0 && !seen.includes(pid)) seen.push(pid);
    }
  }, 5);
  timer.unref?.();
  return { seen, stop: () => clearInterval(timer) };
}

/** Polls until `ready()` is true; the worker handshake and the kill are async. */
async function waitUntil(ready: () => boolean, what: string, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (ready()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`timed out waiting for ${what}`);
}

interface FakeChild extends WorkerChild {
  signals: Array<string | number | undefined>;
}

/** A stand-in for the `ChildProcess` handle a tracked worker owns. */
function fakeChild(
  pid: number,
  exit: { code?: number; signal?: NodeJS.Signals } = {},
): FakeChild {
  const signals: Array<string | number | undefined> = [];
  return {
    pid,
    exitCode: exit.code ?? null,
    signalCode: exit.signal ?? null,
    signals,
    kill(signal) {
      signals.push(signal);
      return true;
    },
  };
}

/**
 * A worker whose `health()` is fixed and whose child handle is optional.
 *
 * `'starting'` is representable on purpose: the real host maps its `starting`
 * state to `'stopped'`, so a fake that cannot say `'starting'` would green-light
 * the very bug these cases exist to pin.
 */
function fake(
  health: 'starting' | 'healthy' | 'failed' | 'stopped',
  child?: FakeChild,
): LiveWorker {
  return { health: () => health, getPid: () => child?.pid, getChild: () => child };
}

describe('mafw plugin check — untrusted worker path', () => {
  itWorker('dry-runs a real untrusted package in a worker and stops it', async () => {
    const base = tempDir('mafw-check-untrusted-');
    const root = writeUntrusted(base, 'sentinel', {
      contributes: { gateway: { actions: ['echo'] } },
    });
    const workers: WorkerHost[] = [];
    const check = createLocalCheck({ onWorker: (worker) => workers.push(worker) });
    const pids = watchPids(workers);
    try {
      const result = await check(root);

      expect(result.ok).toBe(true);
      expect(result.name).toBe('sentinel');
      // The manifest property travels through the check unchanged: `untrusted`
      // is not a CLI choice, it is what `plugin.json` says.
      expect(result.kind).toBe('untrusted');
      expect(result.apiVersion).toBe(2);
      expect(result.permissions).toEqual(['actions']);
      expect(result.contributions).toContain('actions');
      expect(result.declared?.actions).toEqual(['echo']);
      expect(result.registered?.actions).toEqual(['echo']);
      expect(result.evaluated).toBe(true);
      // The entry only activates when `MAFW_WORKER_PERMISSIONS` is in its env,
      // which only the forked worker sets; a `require()` in this process fails.
      expect(Object.keys(require.cache).some((key) => key.includes('sentinel/index.js'))).toBe(false);

      // Teardown: `checkPackage` disposes the candidate bag, whose effect stops
      // the worker. `stopped` is set only after the child is gone.
      expect(workers).toHaveLength(1);
      expect(workers[0].health()).toBe('stopped');
      expect(workers[0].getPid()).toBeUndefined();
      expect(pids.seen.length).toBeGreaterThan(0);
      for (const pid of pids.seen) expect(isAlive(pid)).toBe(false);
    } finally {
      pids.stop();
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

  itWorker('fails an undeclared worker action as contribution_bound and still stops the worker', async () => {
    const base = tempDir('mafw-check-untrusted-bound-');
    const root = writeUntrusted(base, 'wider', {
      contributes: { gateway: { actions: ['echo'] } },
      body: `
module.exports = {
  name: 'wider',
  async activate() {
    return { actions: {
      echo: { title: 'Echo', handler: (input) => input },
      nope: { title: 'Nope', handler: () => null },
    } };
  },
};
`,
    });
    const workers: WorkerHost[] = [];
    const check = createLocalCheck({ onWorker: (worker) => workers.push(worker) });
    try {
      const result = await check(root);

      // The static bound is enforced on the worker's delivered set exactly like
      // an in-process activation: `nope` is not declared, so the check fails —
      // and it is still `contribution_bound`, not `activation_failed`.
      expect(result.ok).toBe(false);
      expect(result.code).toBe('contribution_bound');
      expect(result.evaluated).toBe(true);
      expect(result.error).toContain('action "nope" is not declared');
      expect(result.declared?.actions).toEqual(['echo']);
      expect([...(result.registered?.actions ?? [])].sort()).toEqual(['echo', 'nope']);

      // A rejected candidate is not committed, but its worker must still die
      // with the candidate (the activateWorker failure path stops it).
      expect(workers).toHaveLength(1);
      expect(workers[0].health()).toBe('stopped');
      expect(workers[0].getPid()).toBeUndefined();
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

  itWorker('does not leave a restarted worker behind when the worker crashes', async () => {
    const base = tempDir('mafw-check-untrusted-crash-');
    const root = writeUntrusted(base, 'crashy', {
      body: `
module.exports = {
  name: 'crashy',
  async activate() { throw new Error('kaput in worker'); },
};
`,
    });
    const workers: WorkerHost[] = [];
    const check = createLocalCheck({ onWorker: (worker) => workers.push(worker) });
    try {
      const result = await check(root);

      expect(result.ok).toBe(false);
      expect(result.code).toBe('activation_failed');
      expect(result.evaluated).toBe(false);
      expect(result.error).toContain('kaput in worker');
      expect(workers).toHaveLength(1);

      // `WorkerHost` schedules a restart (500 ms / 1 s / 2 s) on a crash. The
      // activation failure path stops the worker, which must cancel that timer:
      // after the first backoff window there is still no live child, otherwise
      // a failed check would keep re-forking the package behind the CLI's back.
      await new Promise((resolve) => setTimeout(resolve, 700));
      expect(workers).toHaveLength(1);
      expect(workers[0].health()).toBe('stopped');
      expect(workers[0].getPid()).toBeUndefined();
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });
});

/**
 * The `process.once('exit')` hook is the only teardown for a check interrupted
 * before its bag is disposed. It cannot await `WorkerHost.stop()`, so it kills
 * the live child handle itself — these cases pin "which workers count as
 * possibly alive" without spawning one, and the last case pins the real thing.
 */
describe('createWorkerTracker', () => {
  it('kills every worker that still owns a live child, whatever health() says', () => {
    const killed: WorkerChild[] = [];
    const tracker = createWorkerTracker((child) => { killed.push(child); });
    // The hung ready handshake: the real host is in `starting` (live pid) while
    // `health()` reports `stopped` — the state that made the old rule a no-op.
    tracker.track(fake('starting', fakeChild(21)));
    tracker.track(fake('healthy', fakeChild(11)));
    tracker.track(fake('failed', fakeChild(12)));   // crashed, exit not observed yet
    // Crashed and reaped: the host keeps the handle until `stop()`, but the OS
    // truth is in `exitCode` / `signalCode`, so the restart backoff is skipped.
    tracker.track(fake('failed', fakeChild(13, { code: 0 })));
    tracker.track(fake('failed', fakeChild(14, { signal: 'SIGKILL' })));
    tracker.track(fake('stopped'));                 // stop() cleared the handle
    tracker.track(fake('healthy'));                 // never forked
    tracker.killRunning();
    expect(killed.map((child) => child.pid)).toEqual([21, 11, 12]);
  });

  it('sends SIGKILL, not SIGTERM (package code may ignore SIGTERM)', () => {
    const child = fakeChild(11);
    const tracker = createWorkerTracker();
    tracker.track(fake('starting', child));
    tracker.killRunning();
    expect(child.signals).toEqual(['SIGKILL']);
  });

  it('never throws when the child is already gone', () => {
    const tracker = createWorkerTracker(() => { throw new Error('ESRCH'); });
    tracker.track(fake('starting', fakeChild(11)));
    expect(() => tracker.killRunning()).not.toThrow();
  });

  itWorker('kills a real worker whose ready handshake never resolves', async () => {
    const base = tempDir('mafw-check-hung-');
    const root = path.join(base, 'hung');
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(path.join(root, 'index.js'), `
module.exports = {
  name: 'hung',
  // The ready handshake awaits activate(): this never resolves, so the child
  // stays in \`starting\` with a live pid while health() reports \`stopped\`.
  activate() { return new Promise(() => {}); },
};
`);
    const worker = new WorkerHost({
      name: 'hung',
      packageDir: root,
      entryFile: path.join(root, 'index.js'),
      manifest: {
        name: 'hung',
        main: 'index.js',
        apiVersion: 2,
        kind: 'untrusted',
        permissions: ['actions'],
        legacy: false,
      },
      // Keep the post-crash backoff out of the assertion window: the point here
      // is the kill, and `stop()` in `finally` is what cancels this timer.
      backoffMs: [60_000],
      onEmit: () => {},
      getConfig: () => ({}),
      updateConfig: () => {},
      logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    });
    const tracker = createWorkerTracker();
    tracker.track(worker);
    const starting = worker.start();       // deliberately not awaited
    starting.catch(() => { /* the SIGKILL rejects the handshake */ });
    try {
      await waitUntil(() => typeof worker.getPid() === 'number', 'worker pid');
      const pid = worker.getPid()!;

      // The predicate that used to skip the kill: `health()` says stopped while
      // the forked child is provably alive.
      expect(worker.health()).toBe('stopped');
      expect(isAlive(pid)).toBe(true);

      tracker.killRunning();

      await waitUntil(() => !isAlive(pid), 'worker exit');
      expect(isAlive(pid)).toBe(false);
      // The host reports only a *live* child: the reaped handle is not reported
      // (and therefore cannot be signalled by a later exit hook either).
      await waitUntil(() => worker.getPid() === undefined, 'reaped handle');
      expect(worker.getPid()).toBeUndefined();
    } finally {
      await worker.stop('test');           // cancels the backoff scheduled above
      await starting.catch(() => { /* already asserted through the pid */ });
      fs.rmSync(base, { recursive: true, force: true });
    }
  });
});
