import { spawn, execFile, type ChildProcess } from 'child_process';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';

export interface Qwen3AsrSidecarOptions {
  python?: string;
  scriptPath?: string;
  model?: string;
  port?: number;
  gpuMemoryUtilization?: number;
  modelsDir?: string;
  startupTimeoutMs?: number;
  spawnImpl?: typeof spawn;
  fetchImpl?: typeof fetch;
  sleepImpl?: (ms: number) => Promise<void>;
  /** Test seam; defaults to taskkill on Windows, no-op elsewhere. */
  killTreeImpl?: (pid: number) => Promise<void>;
  /** Test seam for the pre-spawn port probe. */
  probePortImpl?: (port: number) => Promise<boolean>;
  /** Test seam for the synchronous shutdown path. */
  killTreeSyncImpl?: (pid: number) => void;
}

const DEFAULT_MODELS_DIR = path.join(os.homedir(), '.mafw', 'models', 'voice');

function defaultScriptPath(): string {
  return path.resolve(__dirname, '../../../voice_sidecars/qwen3_asr_server.py');
}

function defaultKillTree(pid: number): Promise<void> {
  if (process.platform !== 'win32') return Promise.resolve();
  return new Promise((resolve) => {
    execFile('taskkill', ['/PID', String(pid), '/T', '/F'], () => resolve());
  });
}

function defaultKillTreeSync(pid: number): void {
  if (process.platform !== 'win32') return;
  try {
    spawn('taskkill', ['/PID', String(pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
    });
  } catch { /* best effort on shutdown */ }
}

function defaultProbePort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    let done = false;
    const finish = (open: boolean) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(open);
    };
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.setTimeout(500, () => finish(false));
  });
}

/**
 * Owns one Qwen3-ASR Python sidecar. Lazy by design: the gateway calls start()
 * on the first voice connection, not at boot.
 */
export class Qwen3AsrSidecar {
  private readonly opts: Required<Pick<Qwen3AsrSidecarOptions,
    'python' | 'scriptPath' | 'model' | 'port' | 'gpuMemoryUtilization' |
    'modelsDir' | 'startupTimeoutMs'>> & Qwen3AsrSidecarOptions;
  private child: ChildProcess | null = null;
  private exitCode: number | null = null;
  private stderrLines: string[] = [];
  private readonly fetchImpl: typeof fetch;
  private readonly sleepImpl: (ms: number) => Promise<void>;
  private readonly killTree: (pid: number) => Promise<void>;
  private readonly killTreeSync: (pid: number) => void;
  private readonly probePort: (port: number) => Promise<boolean>;
  private readonly injectedSpawn: boolean;

  constructor(options: Qwen3AsrSidecarOptions = {}) {
    this.opts = {
      python: options.python ?? process.env.MAFW_VOICE_PYTHON ?? 'python',
      scriptPath: options.scriptPath ?? defaultScriptPath(),
      model: options.model ?? 'Qwen/Qwen3-ASR-1.7B',
      port: options.port ?? 3911,
      gpuMemoryUtilization: options.gpuMemoryUtilization ?? 0.6,
      modelsDir: options.modelsDir ?? DEFAULT_MODELS_DIR,
      startupTimeoutMs: options.startupTimeoutMs ?? 180_000,
      ...options,
    } as any;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleepImpl = options.sleepImpl ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.injectedSpawn = !!options.spawnImpl;
    // In tests `spawnImpl` is injected; never run taskkill against the fake PID.
    this.killTree = options.killTreeImpl
      ?? (options.spawnImpl ? async () => {} : defaultKillTree);
    this.killTreeSync = options.killTreeSyncImpl
      ?? (options.spawnImpl ? () => {} : defaultKillTreeSync);
    this.probePort = options.probePortImpl
      ?? (options.spawnImpl ? async () => false : defaultProbePort);
  }

  get baseUrl(): string {
    return `http://127.0.0.1:${this.opts.port}`;
  }

  get wsUrl(): string {
    return `ws://127.0.0.1:${this.opts.port}/stream`;
  }

  get pid(): number | undefined {
    return this.child?.pid;
  }

  private noteStderr(chunk: Buffer | string): void {
    const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      this.stderrLines.push(line.trim());
    }
    if (this.stderrLines.length > 20) {
      this.stderrLines.splice(0, this.stderrLines.length - 20);
    }
  }

  private tail(): string {
    return this.stderrLines.length ? `: ${this.stderrLines.join(' | ')}` : '';
  }

  private async ping(): Promise<boolean> {
    try {
      const res = await this.fetchImpl(`${this.baseUrl}/health`, {
        signal: AbortSignal.timeout(1000),
      } as any);
      return !!res.ok;
    } catch {
      return false;
    }
  }

  async isReady(): Promise<boolean> {
    return this.ping();
  }

  async start(): Promise<void> {
    if (this.child && this.exitCode === null) return;

    if (await this.probePort(this.opts.port)) {
      throw new Error(
        `sidecar_port_in_use: 127.0.0.1:${this.opts.port} is already in use`,
      );
    }

    const spawnImpl = (this.opts.spawnImpl ?? spawn) as typeof spawn;
    const args = [
      this.opts.scriptPath,
      '--model', this.opts.model,
      '--port', String(this.opts.port),
      '--gpu-memory-utilization', String(this.opts.gpuMemoryUtilization),
      '--cache-dir', this.opts.modelsDir,
    ];
    let child: ChildProcess;
    try {
      child = spawnImpl(this.opts.python, args, {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, HF_HOME: path.join(this.opts.modelsDir, 'hf') },
      });
    } catch (err: any) {
      throw new Error(
        `sidecar_unavailable: failed to spawn ${this.opts.python} (${err?.code || err?.message || String(err)})`,
      );
    }

    this.child = child;
    this.exitCode = null;
    this.stderrLines = [];
    let spawnError: Error | undefined;
    child.on('error', (err: Error) => { spawnError = err; });
    child.stderr?.on('data', (chunk: Buffer | string) => this.noteStderr(chunk));
    child.on('exit', (code: number | null) => {
      this.exitCode = code ?? -1;
      if (this.child === child) this.child = null;
    });

    try {
      const deadline = Date.now() + this.opts.startupTimeoutMs;
      while (Date.now() < deadline) {
        if (spawnError) {
          throw new Error(
            `sidecar_unavailable: failed to spawn ${this.opts.python} (${(spawnError as any)?.code || spawnError.message})`,
          );
        }
        if (this.exitCode !== null) {
          const message = `Qwen3-ASR sidecar exited (code ${this.exitCode}) during startup${this.tail()}`;
          throw new Error(
            /address already in use/i.test(this.stderrLines.join('\n'))
              ? `sidecar_port_in_use: ${message}`
              : message,
          );
        }
        if (await this.ping()) return;
        await this.sleepImpl(500);
      }

      const timeout = `Qwen3-ASR sidecar health check timed out after ${this.opts.startupTimeoutMs}ms${this.tail()}`;
      throw new Error(
        /address already in use/i.test(this.stderrLines.join('\n'))
          ? `sidecar_port_in_use: ${timeout}`
          : `sidecar_health_timeout: ${timeout}`,
      );
    } catch (err) {
      // Failed startup must not leave an orphan child.
      await this.stop().catch(() => {});
      throw err;
    }
  }

  async stop(): Promise<void> {
    const child = this.child;
    if (!child) return;
    const pid = child.pid;
    // Kill the tree first: once the parent is gone, Windows taskkill /T can no
    // longer enumerate vLLM's worker children.
    if (pid) await this.killTree(pid);
    try {
      child.kill();
    } catch { /* already gone */ }
    if (pid && !this.injectedSpawn) {
      const deadline = Date.now() + 5000;
      while (this.exitCode === null && Date.now() < deadline) {
        await this.sleepImpl(50);
      }
    }
    if (this.child === child) this.child = null;
    this.exitCode = null;
  }

  /** Synchronous best-effort shutdown for process signal handlers. */
  stopSync(): void {
    const child = this.child;
    if (!child) return;
    const pid = child.pid;
    if (pid) this.killTreeSync(pid);
    try { child.kill(); } catch { /* already gone */ }
    this.child = null;
    this.exitCode = null;
  }
}
