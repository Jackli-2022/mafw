/**
 * Process-local check host for `mafw plugin check`.
 *
 * The check must work with the gateway stopped and without a human token, so it
 * never talks HTTP: it builds one real `PluginHost` lazily and runs
 * `checkPackage()` (a dry-run activation through the same judgement function a
 * real install uses). Nothing is scanned, watched or published.
 *
 * Untrusted packages are dry-run through the *same* worker path the gateway
 * uses (`WorkerHost` + the Node permission model), so `kind: "untrusted"` is a
 * manifest property here too, never a CLI choice: there is no `--allow-worker`
 * and worker checks are always on. The host options below mirror
 * `gateway/src/boot.ts` minus kernel/safety/persistence — same `workerAvailable`
 * probe (`permissionFlagFor`), same worker factory shape. The permission model
 * is therefore identical, not weaker (no in-process fallback) and not stronger
 * (no extra flags): it is the boundary, and `checkPackage` is still not a
 * sandbox for a `trusted` package.
 *
 * The host is reused across calls in one process (the CLI checks one package per
 * invocation, but keeping the factory lazy makes repeated checks cheap and lets
 * tests exercise it if needed). `checkPackage` disposes its own bag — including
 * the worker's `stop()` — so a worker never outlives a completed check. The
 * `exit` hook below is a best-effort last resort for a check that is interrupted
 * before that bag is reached: it only runs on the `exit` event (a SIGKILLed
 * CLI runs no handler at all) and it kills the worker's live child handle with
 * SIGKILL, not its reported `health()`.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { log } from '../core/utils/logger';
import { PluginHost, type PluginCheckResult } from '../plugins/package-host';
import { createPluginPackageContext } from '../plugins/package-context';
import { WorkerHost } from '../plugins/worker/worker-host';
import { permissionFlagFor } from '../plugins/worker/node-flags';

/**
 * The live child surface the exit hook needs. A real `ChildProcess` satisfies it
 * structurally; `exitCode` / `signalCode` are the OS truth about liveness.
 */
export interface WorkerChild {
  pid?: number;
  exitCode: number | null;
  signalCode: NodeJS.Signals | null;
  kill(signal?: NodeJS.Signals | number): boolean;
}

/**
 * The part of `WorkerHost` the exit hook needs. Structural on purpose: tests
 * assert the kill rules with a fake instead of spawning a process.
 *
 * `'starting'` is part of the union because the host maps it to `'stopped'`:
 * during the ready handshake (`require`d, `activate()` awaited, child already
 * forked) `health()` says `'stopped'` while a pid is alive. A type that cannot
 * express that state lets a `health()`-based rule look correct.
 */
export interface LiveWorker {
  health(): 'starting' | 'healthy' | 'failed' | 'stopped';
  /** The host's own pid view (what tests assert on); never the kill source. */
  getPid(): number | undefined;
  /** Live child handle; hosts that expose only a pid have nothing to kill. */
  getChild?(): WorkerChild | undefined;
}

export interface WorkerTracker {
  /** Registers one worker and returns it unchanged (factory-friendly). */
  track<T extends LiveWorker>(worker: T): T;
  /**
   * Synchronously kills every worker that still owns a live child handle.
   *
   * Safe to call from a `process.on('exit')` callback: it only signals and never
   * awaits (the worker's own `stop()` is async and would be cut off by the
   * exiting process). The signal is SIGKILL because a single SIGTERM can be
   * swallowed by package code (`process.on('SIGTERM', () => {})`). Entries whose
   * worker has no live child and reports `stopped` are dropped. `kill` is
   * injectable so the rule is testable without a real child.
   */
  killRunning(): void;
}

/**
 * The worker's live child handle, or `undefined` when it owns none.
 *
 * The kill rule is the handle, never `health()` and never a bare pid:
 * - during the ready handshake the host reports `stopped` with a live child;
 * - after a crash the host may keep the reaped handle until `stop()`, so the pid
 *   may already be recycled during the restart backoff;
 * - `child.kill()` on an exited child is a no-op, while `process.kill(pid)` is
 *   not. `exitCode` / `signalCode` make the liveness check explicit.
 *
 * `getChild()` is optional on the structural type: a host that exposes only a
 * pid has no handle this hook can safely signal, so it contributes nothing.
 */
function liveChild(worker: LiveWorker): WorkerChild | undefined {
  const child = worker.getChild?.();
  if (!child) return undefined;
  if (child.exitCode !== null || child.signalCode !== null) return undefined;
  return child;
}

/**
 * Ledger of the workers this CLI process started.
 *
 * A completed check needs none of this (its bag calls `worker.stop()`), but a
 * check interrupted between `fork()` and bag disposal — a hung `activate()` or
 * an abrupt exit — would otherwise leave the child running until the OS reaps
 * it. Nothing per child is retained here: the handle is read from the worker at
 * kill time and its own exit state decides, so a crashed-and-reaped worker is
 * skipped without needing a "forget" call.
 */
export function createWorkerTracker(
  kill: (child: WorkerChild) => void = (child) => { child.kill('SIGKILL'); },
): WorkerTracker {
  const workers: LiveWorker[] = [];
  return {
    track: (worker) => {
      workers.push(worker);
      return worker;
    },
    killRunning: () => {
      for (const worker of workers) {
        const child = liveChild(worker);
        if (!child) continue;
        try {
          kill(child);
        } catch { /* already gone: an exiting CLI must not throw */ }
      }
      // Drop only entries the host is done with. A `failed` / `starting` worker
      // may re-fork during its backoff, and that restarted child must stay
      // covered by this hook.
      for (let index = workers.length - 1; index >= 0; index -= 1) {
        if (!liveChild(workers[index]) && workers[index].health() === 'stopped') {
          workers.splice(index, 1);
        }
      }
    },
  };
}

export interface LocalCheckHooks {
  /**
   * Called with every worker the check host creates, right before it starts.
   *
   * Diagnostics/test seam only: the CLI passes nothing. It exists so a test can
   * assert the worker is really gone after `checkPackage()` resolves (the bag's
   * `worker.stop()` is the only teardown a completed check relies on).
   */
  onWorker?: (worker: WorkerHost) => void;
}

export function createLocalCheck(
  hooks: LocalCheckHooks = {},
): (absolutePath: string) => Promise<PluginCheckResult> {
  let host: PluginHost | undefined;
  const workers = createWorkerTracker();
  return async (absolutePath) => {
    if (!host) {
      // `checkPackage` works on the given directory; this root is never scanned
      // or watched (init() is never called), it only satisfies the constructor.
      const scratchRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-check-'));
      process.once('exit', () => {
        try {
          fs.rmSync(scratchRoot, { recursive: true, force: true });
        } catch { /* best effort: a leftover temp dir must not fail the CLI */ }
        workers.killRunning();
      });
      host = new PluginHost(
        scratchRoot,
        (pkg, bag) => createPluginPackageContext(pkg, {
          projectDir: process.cwd(),
          gatewayPort: 3000,
          bag,
        }),
        {
          // Same probe as `boot.ts`: on a Node without the permission model the
          // answer is a clean `worker_unavailable`, never an in-process load.
          workerAvailable: () => permissionFlagFor(process.execPath) !== null,
          // Mirrors `boot.ts` minus kernel/safety/persistence. The check host has
          // no persisted plugin config, so `config.get()` is empty and
          // `config.update()` fails loudly instead of pretending to write.
          workerHostFactory: (desc, manifest, workerHooks) => {
            const worker = workers.track(new WorkerHost({
              name: desc.name,
              packageDir: desc.pkgDir ?? path.dirname(desc.mainFile),
              entryFile: desc.mainFile,
              manifest,
              onEmit: workerHooks.emit,
              onCrash: () => { /* a dry-run has no safety/ledger to report to */ },
              getConfig: () => ({}),
              updateConfig: () => {
                throw new Error('config.update is not available in this host');
              },
              logger: log,
            }));
            // Observe the worker before `checkPackage` starts it, so a test can
            // watch the pid while it is alive.
            hooks.onWorker?.(worker);
            return worker;
          },
        },
      );
    }
    return host.checkPackage(absolutePath);
  };
}
