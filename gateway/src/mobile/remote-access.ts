/**
 * Remote access tunnel for mobile pairing (P0: Cloudflare Quick Tunnel).
 *
 * Contract:
 * - starts an outbound `cloudflared` child; no inbound port / domain / VPN.
 * - parses the first `https://<random>.trycloudflare.com` URL and publishes it
 *   through `onUrl` (the gateway uses it as a temporary pairing base URL).
 * - `stop()` kills the child tree and calls `onStop` so pairing links fall back
 *   to the configured LAN/Tailscale base URL.
 * - the URL is runtime-only; a gateway restart starts with remote access off.
 *
 * Quick Tunnel is deliberately a P0 provider: random URL per start, no SSE,
 * 200 in-flight request cap, no uptime guarantee. Production should swap the
 * provider behind the same service (named tunnel / Relay) later.
 */
import { spawn, spawnSync } from 'child_process';

export type RemoteAccessProvider = 'cloudflare-quick';

export interface RemoteAccessStatus {
  enabled: boolean;
  provider?: RemoteAccessProvider;
  url?: string;
  startedAt?: number;
}

/** Minimal child-process surface, injectable for tests. */
export interface TunnelChild {
  pid?: number;
  stdout?: NodeJS.ReadableStream | null;
  stderr?: NodeJS.ReadableStream | null;
  on(event: string, listener: (...args: any[]) => void): unknown;
  kill(signal?: NodeJS.Signals | number): boolean;
}

export interface RemoteAccessOptions {
  /** @deprecated gateway port; kept for callers, the tunnel targets `tunnelPort`. */
  port: number;
  /** M0: loopback terminator port (default 3001). */
  tunnelPort?: number;
  /** Called whenever a tunnel URL becomes available. */
  onUrl: (url: string) => void;
  /** Called after the tunnel stops (including unexpected exit). */
  onStop?: () => void;
  /** Defaults to MAFW_CLOUDFLARED_PATH or `cloudflared` on PATH. */
  cloudflaredPath?: string;
  /** URL discovery budget (default 30s). */
  timeoutMs?: number;
  /** Test seams. */
  spawnImpl?: (command: string, args: readonly string[], options: Record<string, unknown>) => TunnelChild;
  killImpl?: (pid: number) => void;
}

const URL_PATTERN = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;

export class RemoteAccessService {
  private readonly tunnelPort: number;
  private readonly onUrl: (url: string) => void;
  private readonly onStop?: () => void;
  private readonly cloudflaredPath: string;
  private readonly timeoutMs: number;
  private readonly spawnImpl: NonNullable<RemoteAccessOptions['spawnImpl']>;
  private readonly killImpl?: (pid: number) => void;

  private child: TunnelChild | null = null;
  private url: string | undefined;
  private startedAt: number | undefined;
  private starting: Promise<void> | null = null;
  private stopWaiter: (() => void) | null = null;
  private stopping = false;

  constructor(opts: RemoteAccessOptions) {
    this.tunnelPort = opts.tunnelPort ?? 3001;
    this.onUrl = opts.onUrl;
    this.onStop = opts.onStop;
    this.cloudflaredPath = opts.cloudflaredPath
      || process.env.MAFW_CLOUDFLARED_PATH
      || 'cloudflared';
    this.timeoutMs = opts.timeoutMs ?? 30_000;
    this.spawnImpl = opts.spawnImpl ?? ((command, args, options) => spawn(command, args as string[], options as any) as unknown as TunnelChild);
    this.killImpl = opts.killImpl;
  }

  status(): RemoteAccessStatus {
    if (!this.url) return { enabled: false };
    return {
      enabled: true,
      provider: 'cloudflare-quick',
      url: this.url,
      startedAt: this.startedAt,
    };
  }

  /** Start once; concurrent callers share the in-flight attempt. */
  async start(): Promise<RemoteAccessStatus> {
    if (this.url) return this.status();
    if (this.starting) {
      await this.starting;
      return this.status();
    }
    this.starting = this.spawnTunnel();
    try {
      await this.starting;
    } finally {
      this.starting = null;
    }
    return this.status();
  }

  async stop(): Promise<RemoteAccessStatus> {
    const child = this.child;
    if (!child) {
      this.resetState();
      this.onStop?.();
      return this.status();
    }

    this.stopping = true;
    await new Promise<void>((resolve) => {
      const finish = () => {
        if (this.stopWaiter === finish) this.stopWaiter = null;
        resolve();
      };
      this.stopWaiter = finish;
      this.kill(child);
      // cloudflared should exit promptly; don't hang gateway shutdown forever.
      setTimeout(finish, 1_500);
    });

    this.resetState();
    this.onStop?.();
    return this.status();
  }

  /** Gateway shutdown hook; best-effort and never throws. */
  destroy(): void {
    void this.stop().catch(() => undefined);
  }

  private spawnTunnel(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const args = [
        'tunnel',
        '--url',
        `http://127.0.0.1:${this.tunnelPort}`,
        '--no-autoupdate',
        '--protocol',
        'http2',
      ];

      let settled = false;
      let logs = '';
      let child: TunnelChild;
      try {
        child = this.spawnImpl(this.cloudflaredPath, args, {
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true,
        });
      } catch (err: any) {
        reject(new Error(this.failureMessage(err?.message || String(err), logs)));
        return;
      }
      this.child = child;

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        this.kill(child);
        this.resetState();
        reject(new Error(this.failureMessage(
          `cloudflared did not print a tunnel URL within ${Math.round(this.timeoutMs / 1000)}s`,
          logs,
        )));
      }, this.timeoutMs);
      (timer as any).unref?.();

      const settleOk = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve();
      };
      const settleErr = (err: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try { this.kill(child); } catch { /* best effort */ }
        this.resetState();
        reject(err);
      };

      const onData = (chunk: unknown) => {
        logs = `${logs}${String(chunk)}`.slice(-8_000);
        if (this.url) return;
        const match = logs.match(URL_PATTERN);
        if (!match) return;
        this.url = match[0];
        this.startedAt = Date.now();
        this.onUrl(this.url);
        settleOk();
      };

      child.stdout?.on('data', onData);
      child.stderr?.on('data', onData);
      child.on('error', (err: Error) => {
        settleErr(new Error(this.failureMessage(err.message, logs)));
      });
      child.on('exit', (code: number | null, signal: string | null) => {
        if (this.child === child) {
          this.child = null;
          this.url = undefined;
          this.startedAt = undefined;
        }
        if (!settled) {
          settleErr(new Error(this.failureMessage(
            `cloudflared exited before a tunnel URL was available (code=${code ?? 'null'} signal=${signal ?? 'null'})`,
            logs,
          )));
          return;
        }
        if (this.stopping) {
          const waiter = this.stopWaiter;
          this.stopWaiter = null;
          this.stopping = false;
          waiter?.();
          return;
        }
        // Unexpected death after a good start: pairing must fall back.
        this.onStop?.();
      });
    });
  }

  private failureMessage(headline: string, logs: string): string {
    const tail = logs.trim().split('\n').slice(-4).join(' | ');
    const hint = /ENOENT|not found/i.test(headline)
      ? ' Install cloudflared or set MAFW_CLOUDFLARED_PATH.'
      : '';
    return `Remote access unavailable: ${headline}.${hint}${tail ? ` cloudflared: ${tail}` : ''}`;
  }

  private resetState(): void {
    this.child = null;
    this.url = undefined;
    this.startedAt = undefined;
    this.stopping = false;
  }

  private kill(child: TunnelChild): void {
    if (child.pid && this.killImpl) {
      this.killImpl(child.pid);
      return;
    }
    try { child.kill('SIGTERM'); } catch { /* best effort */ }
    if (process.platform === 'win32' && child.pid) {
      try {
        spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
      } catch { /* best effort */ }
    }
  }
}
