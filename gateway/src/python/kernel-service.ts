import { spawn, spawnSync, type ChildProcess } from 'child_process';
import { createHmac, randomBytes } from 'crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Dealer, Subscriber } from 'zeromq';
import { log } from '../core/utils/logger';

/**
 * Persistent Python kernel service (Prime Agent / Jupyter kernel architecture).
 *
 * Each session gets its own ipykernel process speaking the standard Jupyter
 * wire protocol (ZeroMQ, PROTOCOL 5.3). Variables/imports/data persist across
 * execute() calls for the life of the kernel.
 *
 * Hardening (per design review):
 *  - Mutex queue: the kernel is single-threaded; concurrent calls queue
 *    (never "busy"-error) and are released on timeout/interrupt.
 *  - allow_stdin: false on every execute_request — `input()` fails fast with
 *    StdinNotImplementedError instead of hanging forever.
 *  - Connection file: unique mkdtemp + all ports 0 (kernel picks free ports),
 *    mode 0600, removed on dispose and on crash.
 *  - Output cap 65536 chars per stream with explicit `truncated` flag.
 *  - Crash detection: process exit marks the kernel dead; the next call
 *    auto-restarts and reports "state lost".
 */

export interface PythonExecuteResult {
  stdout: string;
  stderr: string;
  result?: string;
  error?: { ename: string; evalue: string; traceback: string[] };
  status: 'ok' | 'error' | 'aborted';
  durationMs: number;
  truncated: boolean;
  /** display_data attachments (matplotlib figures etc.), base64. */
  attachments: Array<{ mimeType: string; data: string }>;
  /** True when the kernel had to be restarted before this call. */
  kernelRestarted?: boolean;
}

export interface PythonExecuteOptions {
  signal?: AbortSignal;
  maxOutputChars?: number;
  timeoutMs?: number;
}

interface ConnectionInfo {
  ip: string;
  transport: string;
  shell_port: number;
  iopub_port: number;
  stdin_port: number;
  control_port: number;
  hb_port: number;
  signature_scheme: string;
  key: string;
  kernel_name: string;
}

const DELIM = Buffer.from('<IDS|MSG>');
const PROTOCOL_VERSION = '5.3';
const DEFAULT_MAX_OUTPUT_CHARS = 65536;
const DEFAULT_TIMEOUT_MS = 120_000;
const PORTS_RESOLVE_TIMEOUT_MS = 5000;
const READY_TIMEOUT_MS = 5000;
const ABORT_GRACE_MS = 1000;
const KERNEL_BUSY_AFTER_INTERRUPT_MS = 5000;

const CONNECTION_PORT_KEYS = ['shell_port', 'iopub_port', 'stdin_port', 'control_port', 'hb_port'] as const;

interface Pending {
  msgId: string;
  resolve: (r: PythonExecuteResult) => void;
  reject: (e: Error) => void;
  settled: boolean;
  startedAt: number;
  stdout: string;
  stderr: string;
  result?: string;
  error?: { ename: string; evalue: string; traceback: string[] };
  truncated: boolean;
  attachments: Array<{ mimeType: string; data: string }>;
  kernelRestarted?: boolean;
  maxChars: number;
}

function textOf(data: any): string | undefined {
  return typeof data?.['text/plain'] === 'string' ? data['text/plain'] : undefined;
}

/**
 * Serialize a value the way Python's json.dumps does (separators ", " / ": ",
 * ensure_ascii=False) so Jupyter HMAC signatures match the ipykernel side.
 */
function pyJsonStringify(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return pyJsonString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return '[' + value.map(pyJsonStringify).join(', ') + ']';
  const obj = value as Record<string, unknown>;
  const entries = Object.keys(obj).map((k) => pyJsonString(k) + ': ' + pyJsonStringify(obj[k]));
  return '{' + entries.join(', ') + '}';
}

function pyJsonString(value: string): string {
  let out = '"';
  for (const ch of value) {
    const code = ch.codePointAt(0)!;
    if (ch === '"') out += '\\"';
    else if (ch === '\\') out += '\\\\';
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (ch === '\t') out += '\\t';
    else if (ch === '\b') out += '\\b';
    else if (ch === '\f') out += '\\f';
    else if (code < 0x20) out += '\\u' + code.toString(16).padStart(4, '0');
    else out += ch;
  }
  return out + '"';
}

function makeConnection(): { info: ConnectionInfo; path: string; tempDir: string } {
  const info: ConnectionInfo = {
    ip: '127.0.0.1',
    transport: 'tcp',
    shell_port: 0,
    iopub_port: 0,
    stdin_port: 0,
    control_port: 0,
    hb_port: 0,
    signature_scheme: 'hmac-sha256',
    key: randomBytes(16).toString('hex'),
    kernel_name: 'python3',
  };
  const tempDir = mkdtempSync(join(tmpdir(), 'mafw-pykernel-'));
  const path = join(tempDir, 'connection.json');
  writeFileSync(path, JSON.stringify(info, null, 2), { mode: 0o600 });
  return { info, path, tempDir };
}

export class KernelBusyAfterInterruptError extends Error {
  constructor() {
    super('内核仍在运行上一个被中断的单元，请稍后重试或重启内核');
    this.name = 'KernelBusyAfterInterruptError';
  }
}

export class KernelManager {
  private info: ConnectionInfo;
  private connectionPath: string;
  private tempDir: string;
  private shell?: Dealer;
  private control?: Dealer;
  private iopub?: Subscriber;
  private kernel?: ChildProcess;
  private kernelStderr = '';
  private dead = false;
  private started?: Promise<void>;
  private pending = new Map<string, Pending>();
  private queue: Array<() => Promise<void>> = [];
  private draining = false;
  private iopubActive = false;
  private shellActive = false;
  private sessionId: string;
  private restartNotice = false;

  constructor(
    sessionId: string,
    private readonly pythonBin: string,
    private readonly username = 'mafw',
  ) {
    this.sessionId = sessionId;
    const c = makeConnection();
    this.info = c.info;
    this.connectionPath = c.path;
    this.tempDir = c.tempDir;
  }

  /** Lazily start the kernel; concurrent callers share the same startup. */
  ensureStarted(): Promise<void> {
    if (!this.started) this.started = this.start();
    return this.started;
  }

  private async start(): Promise<void> {
    if (this.kernel && !this.dead) return;
    // Fresh connection file per start: dead kernels may still hold old ports.
    try {
      rmSync(this.tempDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    const c = makeConnection();
    this.info = c.info;
    this.connectionPath = c.path;
    this.tempDir = c.tempDir;
    this.kernelStderr = '';
    this.dead = false;
    this.kernelInfoReceived = false;
    this.kernel = spawn(this.pythonBin, ['-m', 'ipykernel_launcher', '-f', this.connectionPath], {
      // stdout is unused (kernel output arrives over iopub); stderr carries
      // startup diagnostics. Ignoring stdout avoids a dangling pipe handle.
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    this.kernel.stderr?.on('data', (buf: Buffer) => {
      this.kernelStderr += buf.toString();
    });
    this.kernel.on('exit', (code, signal) => {
      if (!this.dead) {
        this.dead = true;
        this.restartNotice = true;
        log.warn(`[PyKernel] session ${this.sessionId} kernel exited code=${code} signal=${signal} stderr=${this.kernelStderr.slice(0, 400)}`);
        this.closeSockets();
        this.failPending(new Error('内核进程已退出'));
        this.started = undefined;
      }
    });
    this.kernel.on('error', (err) => {
      this.dead = true;
      this.started = undefined;
      log.error(`[PyKernel] spawn error: ${err.message}`);
    });

    // The kernel rewrites the connection file with the actual ports.
    await this.waitForPorts();
    await this.connectSockets();
    await this.handshake();
    log.info(`[PyKernel] session ${this.sessionId} kernel ready`);
  }

  private async waitForPorts(): Promise<void> {
    const deadline = Date.now() + PORTS_RESOLVE_TIMEOUT_MS;
    while (Date.now() < deadline) {
      try {
        const raw = await import('fs').then((fs) => fs.promises.readFile(this.connectionPath, 'utf8'));
        const info = JSON.parse(raw) as ConnectionInfo;
        if (CONNECTION_PORT_KEYS.every((k) => Number.isInteger(info[k]) && info[k] > 0)) {
          this.info = info;
          return;
        }
      } catch {
        /* file may be mid-write */
      }
      await sleep(50);
    }
    throw new Error('内核端口解析超时');
  }

  private async connectSockets(): Promise<void> {
    this.shell = new Dealer();
    await this.shell.connect(`tcp://${this.info.ip}:${this.info.shell_port}`);
    (this.shell as any).unref?.(); // never keep the process alive (tests / daemon exit)
    this.control = new Dealer();
    await this.control.connect(`tcp://${this.info.ip}:${this.info.control_port}`);
    (this.control as any).unref?.();
    this.iopub = new Subscriber();
    await this.iopub.connect(`tcp://${this.info.ip}:${this.info.iopub_port}`);
    this.iopub.subscribe();
    (this.iopub as any).unref?.();
    this.iopubActive = true;
    this.shellActive = true;
    void this.readIopubLoop();
    void this.readShellLoop();
  }

  private async handshake(): Promise<void> {
    await this.shellExecute('kernel_info_request', {});
    const deadline = Date.now() + READY_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await sleep(20);
      if (this.kernelInfoReceived) return;
    }
    throw new Error('内核握手超时');
  }

  private async shellExecute(msgType: string, content: Record<string, unknown>): Promise<{ ready: boolean }> {
    if (!this.shell) throw new Error('shell 未连接');
    const msg = this.buildMessage(msgType, content);
    await this.shell.send(this.encode(msg));
    // handshake readiness is observed on iopub; tracked via kernel_info_reply
    return { ready: this.kernelInfoReceived };
  }

  private kernelInfoReceived = false;

  private buildMessage(msgType: string, content: Record<string, unknown>): any {
    return {
      header: {
        // Key order must match jupyter_client.msg_header: msg_id, msg_type,
        // username, session, date, version — JSON key order is part of the HMAC.
        msg_id: randomBytes(16).toString('hex'),
        msg_type: msgType,
        username: this.username,
        session: this.sessionId,
        date: new Date().toISOString(),
        version: PROTOCOL_VERSION,
      },
      parent_header: {},
      metadata: {},
      content,
    };
  }

  private encode(msg: any): Buffer[] {
    const frames: Buffer[] = [];
    frames.push(DELIM);
    const sig = this.sign([msg.header, msg.parent_header, msg.metadata, msg.content]);
    // The signature frame is the hex digest encoded as UTF-8 bytes
    // (jupyter_client: h.hexdigest().encode()).
    frames.push(Buffer.from(sig));
    for (const part of [msg.header, msg.parent_header, msg.metadata, msg.content]) {
      frames.push(Buffer.from(pyJsonStringify(part)));
    }
    return frames;
  }

  private sign(parts: unknown[]): string {
    const hmac = createHmac('sha256', this.info.key);
    for (const p of parts) hmac.update(pyJsonStringify(p));
    return hmac.digest('hex');
  }

  private decode(frames: Buffer[]): { header: any; parentHeader: any; metadata: any; content: any } | null {
    const delimIdx = frames.findIndex((f) => f.equals(DELIM));
    if (delimIdx < 0 || frames.length < delimIdx + 6) return null;
    try {
      return {
        header: JSON.parse(frames[delimIdx + 2].toString()),
        parentHeader: JSON.parse(frames[delimIdx + 3].toString()),
        metadata: JSON.parse(frames[delimIdx + 4].toString()),
        content: JSON.parse(frames[delimIdx + 5].toString()),
      };
    } catch {
      return null;
    }
  }

  private async readIopubLoop(): Promise<void> {
    const socket = this.iopub;
    if (!socket) return;
    let failures = 0;
    let recvPromise: Promise<Buffer[]> | null = null;
    while (socket === this.iopub && this.iopubActive) {
      try {
        if (!recvPromise) recvPromise = socket.receive().finally(() => { recvPromise = null; });
        const pollMs = this.pending.size > 0 ? 2000 : 10000;
        const frames = await Promise.race([recvPromise, sleep(pollMs).then(() => 'timeout' as const)]);
        failures = 0;
        if (frames === 'timeout') {
          // No message during the poll window. Only treat as dead while
          // executions are outstanding; the receive promise stays pending
          // (no "ghost receive" that would swallow later messages).
          failures = this.pending.size > 0 ? failures + 1 : 0;
          if (failures >= 3) {
            this.markKernelDead('iopub 通道无响应');
            return;
          }
          continue;
        }
        const topic = frames[0]?.toString() || '';
        const msg = this.decode(frames);
        if (msg) this.handleIopubMessage(topic, msg);
      } catch (err) {
        if (!this.iopubActive || socket !== this.iopub) return; // closing or replaced
        failures++;
        if (failures >= 3 || socket.closed) {
          this.markKernelDead('iopub 通道无响应');
          return;
        }
      }
    }
  }

  private async readShellLoop(): Promise<void> {
    const socket = this.shell;
    if (!socket) return;
    let failures = 0;
    let recvPromise: Promise<Buffer[]> | null = null;
    while (socket === this.shell && this.shellActive) {
      try {
        if (!recvPromise) recvPromise = socket.receive().finally(() => { recvPromise = null; });
        const pollMs = this.pending.size > 0 ? 2000 : 10000;
        const frames = await Promise.race([recvPromise, sleep(pollMs).then(() => 'timeout' as const)]);
        failures = 0;
        if (frames === 'timeout') {
          failures = this.pending.size > 0 ? failures + 1 : 0;
          if (failures >= 3) {
            this.markKernelDead('shell 通道无响应');
            return;
          }
          continue;
        }
        const msg = this.decode(frames);
        if (!msg) continue;
        const type = msg.header?.msg_type;
        if (type === 'kernel_info_reply') {
          this.kernelInfoReceived = true;
          continue;
        }
        if (type === 'execute_reply') {
          const parentId = msg.parentHeader?.msg_id;
          const pending = this.pending.get(parentId);
          if (!pending) continue;
          const c = msg.content || {};
          if (c.status === 'error' && !pending.error) {
            pending.error = {
              ename: c.ename || 'Error',
              evalue: c.evalue || '',
              traceback: Array.isArray(c.traceback) ? c.traceback.map(String) : [],
            };
          }
          if (c.status === 'aborted' && !pending.settled) {
            // 内核侧中止（interrupt 后）——显式收尾，等待 iopub idle 的兜底由超时覆盖
            pending.settled = true;
            this.pending.delete(parentId);
            pending.resolve({
              stdout: pending.stdout,
              stderr: pending.stderr,
              result: pending.result,
              error: pending.error,
              status: 'aborted',
              durationMs: Date.now() - pending.startedAt,
              truncated: pending.truncated,
              attachments: pending.attachments,
            });
          }
        }
      } catch (err) {
        if (!this.shellActive || socket !== this.shell) return; // closing or replaced
        failures++;
        if (failures >= 3 || socket.closed) {
          this.markKernelDead('shell 通道无响应');
          return;
        }
      }
    }
  }

  /** Kill the kernel process and clear state so the next execute() restarts it. */
  private markKernelDead(reason: string): void {
    if (this.dead) return;
    this.dead = true;
    this.restartNotice = true;
    log.warn(`[PyKernel] session ${this.sessionId} kernel dead: ${reason}`);
    this.failPending(new Error(`内核通道故障：${reason}`));
    this.started = undefined;
    const proc = this.kernel;
    this.kernel = undefined;
    if (proc) {
      proc.kill('SIGKILL');
      if (process.platform === 'win32' && proc.pid) {
        const killer = spawn('taskkill', ['/F', '/T', '/PID', String(proc.pid)], {
          stdio: 'ignore',
          windowsHide: true,
        });
        killer.unref?.();
      }
      proc.on('exit', () => undefined);
    }
  }

  private handleIopubMessage(topic: string, msg: any): void {
    if (msg.header?.msg_type === 'kernel_info_reply') {
      this.kernelInfoReceived = true;
      return;
    }
    const parentId = msg.parentHeader?.msg_id;
    if (!parentId) return;
    const pending = this.pending.get(parentId);
    if (!pending) return;
    const c = msg.content || {};
    switch (msg.header?.msg_type) {
      case 'stream':
        if (c.name === 'stderr') this.appendStream(pending, 'stderr', c.text ?? '');
        else this.appendStream(pending, 'stdout', c.text ?? '');
        break;
      case 'execute_result':
        pending.result = textOf(c.data) ?? pending.result;
        break;
      case 'display_data':
        this.handleDisplayData(pending, c);
        break;
      case 'error':
        pending.error = { ename: c.ename || 'Error', evalue: c.evalue || '', traceback: Array.isArray(c.traceback) ? c.traceback.map(String) : [] };
        break;
      case 'status':
        if (c.execution_state === 'idle') this.settle(pending);
        break;
      default:
        break;
    }
  }

  private appendStream(pending: Pending, name: 'stdout' | 'stderr', text: string): void {
    const max = pending.maxChars;
    const field = name as 'stdout' | 'stderr';
    if (!pending[field]) pending[field] = '';
    if (pending[field].length >= max) {
      pending.truncated = true;
      return;
    }
    const remaining = max - pending[field].length;
    pending[field] += text.slice(0, remaining);
    if (text.length > remaining) pending.truncated = true;
  }

  private handleDisplayData(pending: Pending, content: any): void {
    const data = content.data || {};
    if (typeof data['text/plain'] === 'string') {
      pending.result = data['text/plain'];
    }
    if (typeof data['image/png'] === 'string') {
      pending.attachments.push({ mimeType: 'image/png', data: data['image/png'] });
    } else if (typeof data['image/jpeg'] === 'string') {
      pending.attachments.push({ mimeType: 'image/jpeg', data: data['image/jpeg'] });
    }
  }

  private settle(pending: Pending): void {
    if (pending.settled) return;
    pending.settled = true;
    this.pending.delete(pending.msgId);
    const elapsed = Date.now() - pending.startedAt;
    const result: PythonExecuteResult = {
      stdout: pending.stdout ?? '',
      stderr: pending.stderr ?? '',
      result: pending.result,
      error: pending.error,
      status: pending.error ? 'error' : 'ok',
      durationMs: elapsed,
      truncated: pending.truncated || false,
      attachments: pending.attachments,
      kernelRestarted: pending.kernelRestarted,
    };
    pending.resolve(result);
  }

  private failPending(err: Error): void {
    for (const [id, p] of this.pending) {
      if (p.settled) continue;
      p.settled = true;
      this.pending.delete(id);
      p.reject(err);
    }
  }

  /** Serialized execution: the kernel is single-threaded. */
  execute(code: string, opts: PythonExecuteOptions = {}): Promise<PythonExecuteResult> {
    return this.enqueue(() => this.executeInner(code, opts));
  }

  private async executeInner(code: string, opts: PythonExecuteOptions): Promise<PythonExecuteResult> {
    const started = Date.now();
    const maxChars = opts.maxOutputChars ?? DEFAULT_MAX_OUTPUT_CHARS;
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      const kernelRestarted = this.restartNotice;
      this.restartNotice = false;
      log.info(`[PyKernel] read restartNotice=${kernelRestarted} for: ${code.slice(0, 40)}`);

    await this.ensureStarted();

    const pending: Pending = {
      msgId: '',
      resolve: () => undefined,
      reject: () => undefined,
      settled: false,
      startedAt: started,
      stdout: '',
      stderr: '',
      truncated: false,
      attachments: [],
      maxChars,
    };
    const resultPromise = new Promise<PythonExecuteResult>((resolve, reject) => {
      pending.resolve = resolve;
      pending.reject = reject;
    });

    const msg = this.buildMessage('execute_request', {
      code,
      silent: false,
      store_history: true,
      user_expressions: {},
      allow_stdin: false,
      stop_on_error: true,
    });
    pending.msgId = msg.header.msg_id;
    this.pending.set(pending.msgId, pending);

    let abortTimer: ReturnType<typeof setTimeout> | undefined;
    const clearAbortTimer = () => {
      if (abortTimer) {
        clearTimeout(abortTimer);
        abortTimer = undefined;
      }
    };
    const forceAbort = () => {
      if (pending.settled) return;
      pending.settled = true;
      this.pending.delete(pending.msgId);
      log.warn(`[PyKernel] execute force-abort (timeout) for ${pending.msgId}`);
      pending.reject(new Error('执行超时（已中断内核）'));
    };
    const onAbort = () => {
      void this.interrupt().catch(() => undefined);
      clearAbortTimer();
      abortTimer = setTimeout(forceAbort, ABORT_GRACE_MS);
      if (typeof abortTimer === 'object' && 'unref' in abortTimer) abortTimer.unref();
    };

    try {
      if (opts.signal?.aborted) {
        return { stdout: '', stderr: '', status: 'aborted', durationMs: Date.now() - started, truncated: false, attachments: [] };
      }
      opts.signal?.addEventListener('abort', onAbort, { once: true });
      abortTimer = setTimeout(forceAbort, timeoutMs);
      if (typeof abortTimer === 'object' && 'unref' in abortTimer) abortTimer.unref();

      log.info(`[PyKernel] sending execute, pending=${this.pending.size}`);
      await this.shell!.send(this.encode(msg));
      log.info(`[PyKernel] execute started: ${code.slice(0, 60).replace(/\n/g, ' ')}`);
      const result = await resultPromise;
      log.info(`[PyKernel] execute done: status=${result.status} dur=${Date.now() - started}ms`);
      if (kernelRestarted) result.kernelRestarted = true;
      if (result.status === 'ok' && result.error) result.status = 'error';
      return result;
    } catch (err) {
      if (err instanceof Error && err.message === '执行超时（已中断内核）') {
        // Wait briefly to see whether the kernel drains back to idle.
        await sleep(Math.min(KERNEL_BUSY_AFTER_INTERRUPT_MS, 1000));
        throw new KernelBusyAfterInterruptError();
      }
      throw err;
    } finally {
      clearAbortTimer();
      opts.signal?.removeEventListener('abort', onAbort);
      if (!pending.settled) {
        pending.settled = true;
        this.pending.delete(pending.msgId);
      }
    }
  }

  async interrupt(): Promise<void> {
    if (!this.control) return;
    const msg = this.buildMessage('interrupt_request', {});
    await this.control.send(this.encode(msg));
  }

  async restart(): Promise<void> {
    this.restartNotice = true;
    this.dead = true;
    this.failPending(new Error('内核重启中'));
    this.iopubActive = false;
    this.shellActive = false;
    await this.closeSockets().catch(() => undefined);
    this.killProc();
    this.started = undefined;
    await this.ensureStarted();
  }

  dispose(): void {
    this.dead = true;
    this.failPending(new Error('内核已关闭'));
    this.iopubActive = false;
    this.shellActive = false;
    void this.closeSockets();
    this.killProc();
    this.cleanupTempDir();
  }

  /**
   * Awaitable variant of dispose() for teardown paths that must not leave
   * zeromq handles behind (tests, daemon shutdown). zeromq sockets hold
   * native handles until close() resolves, so a fire-and-forget dispose can
   * keep the process alive.
   */
  async disposeAsync(): Promise<void> {
    this.dead = true;
    this.failPending(new Error('内核已关闭'));
    this.iopubActive = false;
    this.shellActive = false;
    await this.closeSockets().catch(() => undefined);
    this.killProc();
    this.cleanupTempDir();
  }

  private killProc(): void {
    const proc = this.kernel;
    this.kernel = undefined;
    if (proc) {
      // Windows: child.kill('SIGKILL') claims success but often leaves the
      // process alive (venv python launcher) — force-kill via taskkill.
      // Use spawnSync so the process is dead before the caller continues; a
      // still-alive child keeps its piped stderr open and blocks process
      // exit (tests / daemon shutdown).
      proc.kill('SIGKILL');
      if (process.platform === 'win32' && proc.pid) {
        try {
          spawnSync('taskkill', ['/F', '/T', '/PID', String(proc.pid)], {
            stdio: 'ignore',
            windowsHide: true,
          });
        } catch { /* already dead */ }
      }
      proc.on('exit', () => undefined);
    }
  }

  private cleanupTempDir(): void {
    try {
      rmSync(this.tempDir, { recursive: true, force: true });
    } catch {
      /* OS tmp cleanup */
    }
  }

  private closeSockets(): Promise<void> {
    const sockets = [this.shell, this.control, this.iopub].filter(Boolean) as Array<Dealer | Subscriber>;
    this.shell = undefined;
    this.control = undefined;
    this.iopub = undefined;
    return Promise.all(sockets.map((s) => Promise.resolve(s.close()))).then(() => undefined);
  }

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push(() => fn().then(resolve, reject));
      void this.drain();
    });
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    while (this.queue.length > 0) {
      const next = this.queue.shift()!;
      await next();
    }
    this.draining = false;
  }
}

// ---------------------------------------------------------------------------
// Session-scoped kernel pool

const TTL_MS = 60 * 60 * 1000;

export class SessionKernels {
  private kernels = new Map<string, { kernel: KernelManager; lastUsed: number }>();
  private cleanupTimer?: ReturnType<typeof setInterval>;

  constructor(private readonly pythonBin: string) {
    this.cleanupTimer = setInterval(() => this.sweep(), 5 * 60 * 1000);
    if (this.cleanupTimer && typeof this.cleanupTimer === 'object' && 'unref' in this.cleanupTimer) this.cleanupTimer.unref();
  }

  get(sessionId: string): KernelManager {
    const entry = this.kernels.get(sessionId);
    if (entry) {
      entry.lastUsed = Date.now();
      return entry.kernel;
    }
    const kernel = new KernelManager(sessionId, this.pythonBin);
    this.kernels.set(sessionId, { kernel, lastUsed: Date.now() });
    return kernel;
  }

  async restart(sessionId: string): Promise<void> {
    const entry = this.kernels.get(sessionId);
    if (!entry) return;
    entry.lastUsed = Date.now();
    await entry.kernel.restart();
  }

  status(sessionId: string): { running: boolean } {
    const entry = this.kernels.get(sessionId);
    return { running: !!entry && !!entry.kernel && !(entry.kernel as any).dead && !!(entry.kernel as any).kernel };
  }

  disposeAll(): void {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    for (const { kernel } of this.kernels.values()) kernel.dispose();
    this.kernels.clear();
  }

  private sweep(): void {
    const now = Date.now();
    for (const [id, entry] of this.kernels) {
      if (now - entry.lastUsed > TTL_MS) {
        entry.kernel.dispose();
        this.kernels.delete(id);
      }
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Receive with a poll window so close() always lets loops exit promptly. */
async function receiveWithTimeout(socket: Dealer | Subscriber, ms: number): Promise<Buffer[]> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      socket.receive(),
      new Promise<Buffer[]>((_, reject) => {
        timer = setTimeout(() => reject(new Error('receive timeout')), ms);
        if (typeof timer === 'object' && 'unref' in timer) timer.unref();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
