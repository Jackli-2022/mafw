/**
 * Minimal git runner abstraction (runtime-neutral).
 *
 * Moved verbatim from `gateway/src/core/diff/turn-diff.ts`: the gateway keeps
 * turn-diff logic, while drivers/gateway both use this injectable process
 * runner. Spawn errors reject; normal non-zero git exits resolve so callers can
 * map them deliberately.
 */
import { execFile } from 'child_process';

export interface GitRunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface GitRunner {
  run(
    args: string[],
    opts?: { timeoutMs?: number; maxBuffer?: number; env?: Record<string, string> },
  ): Promise<GitRunResult>;
}

const GIT_TIMEOUT_MS = 30_000;
const GIT_MAX_BUFFER = 32 * 1024 * 1024;

export const defaultGit: GitRunner = {
  run(args, opts) {
    return new Promise((resolve, reject) => {
      execFile(
        'git',
        args,
        {
          encoding: 'utf8',
          windowsHide: true,
          timeout: opts?.timeoutMs ?? GIT_TIMEOUT_MS,
          maxBuffer: opts?.maxBuffer ?? GIT_MAX_BUFFER,
          ...(opts?.env ? { env: { ...process.env, ...opts.env } } : {}),
        },
        (error: any, stdout, stderr) => {
          // Spawn errors (git missing, timeout with killed=true) reject; normal
          // non-zero git exits resolve so the caller can map them deliberately.
          if (error && (error.code === 'ENOENT' || error.killed)) {
            reject(error);
            return;
          }
          const code = error
            ? (typeof error.code === 'number' ? error.code : 1)
            : 0;
          resolve({
            code,
            stdout: String(stdout ?? ''),
            stderr: String(stderr ?? ''),
          });
        },
      );
    });
  },
};
