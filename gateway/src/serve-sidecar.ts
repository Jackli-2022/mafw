/**
 * Runs `opencode serve` as a supervised sidecar. The actual spawn / readiness
 * detection / process-tree teardown is delegated to the opencode SDK's
 * `createOpencodeServer` (official, cross-platform verified) instead of a
 * hand-rolled spawn — our previous custom spawn (cross-spawn + windowsHide)
 * was flaky under the detached daemon environment.
 *
 * The gateway's `startServeWatchdog` performs periodic health polling and
 * recovery regardless of whether the serve was spawned by us or adopted. The
 * SDK does not expose the child process or an exit callback; all crash
 * detection therefore goes through the health-poll path.
 */

export interface ServeSidecarOptions {
  host: string;
  port: number;
  /** How long to wait for the `opencode server listening` line. */
  timeoutMs?: number;
  /** Forwarded serve stdout/stderr chunks (kept for interface compat). */
  onOutput?: (chunk: string) => void;
  /** Fired when the serve process exits after startup completed (kept for interface compat). */
  onExit?: (code: number | null) => void;
}

export interface ServeSidecar {
  url: string;
  close: () => void;
}

// Runtime dynamic import: this gateway compiles to CJS while the SDK ships ESM
// (exports.import only), and tsc rewrites a plain import() into require().
const loadSdk = new Function('spec', 'return import(spec)') as (s: string) => Promise<any>;

export function startServeSidecar(opts: ServeSidecarOptions): Promise<ServeSidecar> {
  return loadSdk('@opencode-ai/sdk/server')
    .then(({ createOpencodeServer }) =>
      createOpencodeServer({
        hostname: opts.host,
        port: opts.port,
        timeout: opts.timeoutMs ?? 30_000,
      }),
    )
    .then(({ url, close }: { url: string; close: () => void }) => ({ url, close }));
}
