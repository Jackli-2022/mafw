/**
 * Host side of one untrusted package worker.
 *
 * Owns the child process, the JSON RPC queue and the subprocess ledger record.
 * It never imports the package entry into the gateway process.
 */
import { fork, type ChildProcess } from 'child_process';
import * as path from 'path';
import { permissionFlagFor, type PermissionFlag } from './node-flags';
import { decodeWorkerMessage, encodeWorkerMessage } from './worker-protocol';
import type { NormalizedPackageManifest } from '../package-manifest';

/** Structural subset of the kernel-v2 ledger used by the live worker host. */
export interface WorkerSubprocessLedger {
  track(id: string, handle: { pid?: number; stop(): Promise<void> }, ownership?: 'provider' | 'external'): void;
  markRunning(id: string): void;
  markFailed(id: string, reason: string): void;
  markStopped(id: string, reason?: string): void;
  snapshot(): Array<{ id: string; state: string }>;
}
import type { PluginEmitEvent } from '../package-types';

export interface WorkerLogger {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

export interface WorkerReady {
  name: string;
  version?: string;
  apiVersion: number;
  contributions: Record<string, unknown>;
  pid?: number;
}

export interface WorkerHostOptions {
  name: string;
  packageDir: string;
  entryFile: string;
  manifest: NormalizedPackageManifest;
  nodePath?: string;
  bootstrapPath?: string;
  permissionFlag?: PermissionFlag | null;
  timeoutMs?: number;
  maxOldSpaceMb?: number;
  ledger?: WorkerSubprocessLedger;
  onEmit: (event: PluginEmitEvent) => void;
  getConfig: () => Record<string, unknown>;
  updateConfig: (patch: Record<string, unknown>) => void;
  logger: WorkerLogger;
  backoffMs?: number[];
  onCrash?: (info: { code?: number; signal?: string; restarts: number }) => void;
}

interface PendingInvoke {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

const MAX_INFLIGHT = 4;
const MAX_QUEUE = 64;
const READY_TIMEOUT_MS = 5000;
const DEFAULT_ACTION_TIMEOUT_MS = 10_000;
const MAX_ACTION_TIMEOUT_MS = 30_000;

function workerBootstrapPath(): string {
  return path.join(__dirname, 'worker-bootstrap.cjs');
}

export class WorkerHost {
  private child?: ChildProcess;
  private ready?: WorkerReady;
  private state: 'stopped' | 'starting' | 'healthy' | 'failed' = 'stopped';
  private stopping = false;
  private sequence = 0;
  private inflight = new Map<string, PendingInvoke>();
  private queue: Array<{ resolve: () => void; reject: (error: Error) => void }> = [];
  private restarts = 0;
  private lastStderr = '';
  private restartTimer?: NodeJS.Timeout;
  private ledgerId: string;

  constructor(private readonly options: WorkerHostOptions) {
    this.ledgerId = `plugin:${options.name}`;
  }

  /**
   * The live child handle, or `undefined` when there is none to tear down.
   *
   * A crashed child keeps its handle until `stop()`; a reaped pid may already
   * belong to another process, so only a child that has not exited is returned.
   * This is the handle the process `exit` hook kills: `child.kill()` on an
   * exited child is a no-op, while `process.kill(pid)` is not.
   */
  getChild(): ChildProcess | undefined {
    const child = this.child;
    if (!child || child.exitCode !== null || child.signalCode !== null) return undefined;
    return child;
  }

  getPid(): number | undefined {
    return this.getChild()?.pid;
  }

  getRestarts(): number {
    return this.restarts;
  }

  health(): 'healthy' | 'failed' | 'stopped' {
    return this.state === 'healthy' ? 'healthy' : this.state === 'failed' ? 'failed' : 'stopped';
  }

  async start(): Promise<WorkerReady> {
    if (this.state === 'healthy' && this.ready) return this.ready;
    if (this.state === 'starting') throw new Error('worker is already starting');
    this.state = 'starting';
    this.stopping = false;

    const nodePath = this.options.nodePath ?? process.execPath;
    const flag = this.options.permissionFlag === undefined
      ? permissionFlagFor(nodePath)
      : this.options.permissionFlag;
    if (!flag) {
      this.state = 'failed';
      throw new Error('worker_unavailable: Node permission flag not supported');
    }

    const bootstrapPath = this.options.bootstrapPath ?? workerBootstrapPath();
    const maxOldSpace = this.options.maxOldSpaceMb ?? 256;
    const execArgv = [
      flag,
      `--allow-fs-read=${path.resolve(this.options.packageDir)}`,
      `--allow-fs-read=${path.resolve(path.dirname(bootstrapPath))}`,
      `--max-old-space-size=${maxOldSpace}`,
    ];

    const child = fork(bootstrapPath, [path.resolve(this.options.entryFile)], {
      cwd: path.resolve(this.options.packageDir),
      env: {
        NODE_ENV: process.env.NODE_ENV ?? 'production',
        LANG: process.env.LANG ?? '',
        TZ: process.env.TZ ?? '',
        MAFW_WORKER_PERMISSIONS: JSON.stringify(this.options.manifest.permissions ?? []),
      },
      execArgv,
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    this.child = child;
    this.attach(child);

    const tracked = this.options.ledger?.snapshot().some((record) => record.id === this.ledgerId);
    if (!tracked) {
      this.options.ledger?.track(this.ledgerId, {
        pid: child.pid,
        stop: () => this.stop('ledger'),
      }, 'provider');
    }

    return await new Promise<WorkerReady>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.kill('ready-timeout');
        reject(new Error('worker_timeout: ready handshake'));
      }, READY_TIMEOUT_MS);
      timer.unref?.();
      this.readyResolve = (value) => {
        clearTimeout(timer);
        resolve(value);
      };
      this.readyReject = (error) => {
        clearTimeout(timer);
        reject(error);
      };
    });
  }

  async invoke(action: string, input: unknown, timeoutMs?: number): Promise<unknown> {
    if (this.state !== 'healthy' || !this.child?.connected) {
      throw new Error('worker not running');
    }
    if (this.inflight.size >= MAX_INFLIGHT) {
      if (this.queue.length >= MAX_QUEUE) throw new Error('worker_busy');
      await new Promise<void>((resolve, reject) => this.queue.push({ resolve, reject }));
    }
    if (this.state !== 'healthy' || !this.child?.connected) {
      throw new Error('worker not running');
    }

    const id = `act_${++this.sequence}`;
    const timeout = Math.max(1, Math.min(
      MAX_ACTION_TIMEOUT_MS,
      Math.floor(timeoutMs ?? this.options.timeoutMs ?? DEFAULT_ACTION_TIMEOUT_MS),
    ));

    return await new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.inflight.delete(id);
        this.releaseQueue();
        this.kill('action-timeout');
        reject(new Error('worker_timeout: action exceeded its timeout'));
      }, timeout);
      timer.unref?.();
      this.inflight.set(id, { resolve, reject, timer });
      try {
        this.send({ t: 'invoke', id, action, input, timeoutMs: timeout });
      } catch (err) {
        clearTimeout(timer);
        this.inflight.delete(id);
        this.releaseQueue();
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  async stop(reason = 'dispose'): Promise<void> {
    if (this.state === 'stopped' || !this.child) {
      this.state = 'stopped';
      return;
    }
    this.stopping = true;
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = undefined;
    }
    const child = this.child;
    this.rejectAll(new Error('worker_stopped'));

    try {
      this.send({ t: 'shutdown' });
    } catch { /* already gone */ }

    await this.waitForExit(child, 2000);
    if (child.exitCode === null && child.signalCode === null) {
      try { child.kill('SIGTERM'); } catch { /* best effort */ }
      await this.waitForExit(child, 2000);
    }
    if (child.exitCode === null && child.signalCode === null) {
      try { child.kill('SIGKILL'); } catch { /* best effort */ }
      await this.waitForExit(child, 1000);
    }

    this.state = 'stopped';
    this.ready = undefined;
    this.inflight.clear();
    this.queue = [];
    this.child = undefined;
    this.options.ledger?.markStopped(this.ledgerId, reason);
  }

  private readyResolve?: (value: WorkerReady) => void;
  private readyReject?: (error: Error) => void;

  private attach(child: ChildProcess): void {
    child.on('message', (message) => this.handleMessage(message));
    child.on('error', (error) => this.fail(error.message));
    child.on('exit', (code, signal) => {
      if (this.stopping) return;
      this.fail(`worker exited (code=${code ?? 'null'}, signal=${signal ?? 'null'})`);
    });
    child.stdout?.on('data', (chunk) => {
      this.options.logger.info(`[plugin:${this.options.name}] ${String(chunk).trimEnd()}`);
    });
    child.stderr?.on('data', (chunk) => {
      const text = String(chunk).trimEnd();
      this.lastStderr = `${this.lastStderr}\n${text}`.trim().slice(-2000);
      this.options.logger.warn(`[plugin:${this.options.name}] ${text}`);
    });
  }

  private handleMessage(raw: unknown): void {
    try {
      this.handleMessageUnsafe(raw);
    } catch (err: any) {
      // A worker-triggered host-side error must never escape into the process
      // uncaughtException handler and take down the gateway.
      this.options.logger.warn(
        `[plugin:${this.options.name}] worker message handler failed: ${err?.message ?? String(err)}`,
      );
    }
  }

  private handleMessageUnsafe(raw: unknown): void {
    const text = typeof raw === 'string' ? raw : JSON.stringify(raw);
    const message = decodeWorkerMessage(text);
    if (!message) {
      this.options.logger.warn(`[plugin:${this.options.name}] ignored invalid worker message`);
      return;
    }

    switch (message.t) {
      case 'ready':
        this.ready = {
          name: message.name,
          ...(message.version !== undefined ? { version: message.version } : {}),
          apiVersion: message.apiVersion,
          contributions: message.contributions,
          pid: this.child?.pid,
        };
        this.state = 'healthy';
        try { this.options.ledger?.markRunning(this.ledgerId); } catch { /* restarted child keeps the prior record */ }
        this.readyResolve?.(this.ready);
        this.readyResolve = undefined;
        this.readyReject = undefined;
        break;
      case 'result': {
        const pending = this.inflight.get(message.id);
        if (!pending) break;
        clearTimeout(pending.timer);
        this.inflight.delete(message.id);
        if (message.ok) pending.resolve(message.output);
        else pending.reject(new Error(message.error.message));
        this.releaseQueue();
        break;
      }
      case 'emit':
        this.options.onEmit({ type: message.type, properties: message.payload as any });
        break;
      case 'log':
        this.options.logger[message.level](`[plugin:${this.options.name}] ${message.message}`);
        break;
      case 'config.get':
        try {
          this.send({ t: 'result', id: message.id, ok: true, output: this.options.getConfig() });
        } catch (err: any) {
          this.send({
            t: 'result', id: message.id, ok: false,
            error: { message: err?.message ?? String(err) },
          });
        }
        break;
      case 'config.update':
        try {
          this.options.updateConfig(message.patch);
          this.send({ t: 'result', id: message.id, ok: true, output: true });
        } catch (err: any) {
          this.send({
            t: 'result', id: message.id, ok: false,
            error: { message: err?.message ?? String(err) },
          });
        }
        break;
    }
  }

  private send(message: Parameters<typeof encodeWorkerMessage>[0]): void {
    if (!this.child?.connected) throw new Error('worker not running');
    const text = encodeWorkerMessage(message);
    if (!text) throw new Error('worker message is invalid or too large');
    this.child.send(JSON.parse(text));
  }

  private fail(reason: string): void {
    if (this.state === 'failed') return;
    this.state = 'failed';
    const detail = this.lastStderr ? `${reason}: ${this.lastStderr}` : reason;
    this.options.ledger?.markFailed(this.ledgerId, reason);
    this.rejectAll(new Error(`worker_crashed: ${detail}`));
    this.readyReject?.(new Error(`worker_crashed: ${detail}`));
    this.readyResolve = undefined;
    this.readyReject = undefined;
    this.options.onCrash?.({
      code: this.child?.exitCode ?? undefined,
      signal: this.child?.signalCode ?? undefined,
      restarts: this.restarts,
    });
    this.scheduleRestart();
  }

  private scheduleRestart(): void {
    if (this.stopping || this.restartTimer) return;
    const backoff = this.options.backoffMs ?? [500, 1000, 2000];
    if (this.restarts >= backoff.length) return;
    const delay = backoff[this.restarts] ?? 2000;
    this.restarts += 1;
    this.restartTimer = setTimeout(() => {
      this.restartTimer = undefined;
      this.state = 'stopped';
      this.ready = undefined;
      this.lastStderr = '';
      void this.start().catch(() => { /* exit/error path schedules the next attempt */ });
    }, delay);
    this.restartTimer.unref?.();
  }

  private kill(reason: string): void {
    const child = this.child;
    if (!child) return;
    // Leave the healthy state immediately so callers cannot observe a live
    // worker while the kill is in flight; the exit handler owns the restart.
    this.state = 'starting';
    this.options.ledger?.markFailed(this.ledgerId, reason);
    try { child.kill('SIGKILL'); } catch { /* best effort */ }
  }

  private rejectAll(error: Error): void {
    for (const pending of this.inflight.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.inflight.clear();
    const queued = this.queue;
    this.queue = [];
    for (const waiter of queued) waiter.reject(error);
  }

  private releaseQueue(): void {
    while (this.inflight.size < MAX_INFLIGHT && this.queue.length > 0) {
      this.queue.shift()?.resolve();
    }
  }

  private waitForExit(child: ChildProcess, ms: number): Promise<void> {
    if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      timer.unref?.();
      child.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
}
