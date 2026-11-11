/**
 * Global crash handlers（E1-11 / A14）。
 *
 * gateway 是常驻进程：任何遗漏的 `uncaughtException` / `unhandledRejection` 都
 * 必须**受控退出**（supervisor 才能拉起），而不是按 Node 默认方式静默终止。
 *
 * 契约：
 *  - `[FATAL] uncaughtException|unhandledRejection` 写 `log.error`（含堆栈）；
 *  - 同一行同步写 fd 2（`fs.writeSync`：Windows 管道上 process.exit 前不会丢）；
 *  - `process.exitCode = 1` 后 `process.exit(1)` —— 不吞、不继续运行；
 *  - 退出码 1 与 desktop managed 的自更新约定 75 严格区分。
 *
 * 注意：这是最后一道防线，不是恢复机制；业务错误仍应各自捕获并上报。
 */
import * as fs from 'fs';
import { log as defaultLog } from '../core/utils/logger';

export interface CrashHandlerDeps {
  /** 事件源（默认 process；测试可注入 EventEmitter）。 */
  emitter?: NodeJS.EventEmitter;
  /** 结构化日志（默认 core/utils/logger）。 */
  log?: { error(message: string, ...args: unknown[]): void };
  /** 同步 stderr 写入（默认 `fs.writeSync(2, …)`）。 */
  stderr?: (line: string) => void;
  /** 受控退出（默认 `process.exit`）。 */
  exit?: (code: number) => void;
}

function detailOf(err: unknown): string {
  const anyErr = err as any;
  if (anyErr && typeof anyErr === 'object') {
    if (typeof anyErr.stack === 'string' && anyErr.stack) return anyErr.stack;
    if (typeof anyErr.message === 'string') return anyErr.message;
  }
  return String(err);
}

const installed = new WeakSet<object>();

/**
 * Register the two process-level handlers. Idempotent per emitter (calling twice
 * never double-logs / double-exits).
 */
export function registerCrashHandlers(deps: CrashHandlerDeps = {}): void {
  const emitter = deps.emitter ?? process;
  if (installed.has(emitter)) return;
  installed.add(emitter);

  const logger = deps.log ?? defaultLog;
  const stderr = deps.stderr ?? ((line: string) => {
    try { fs.writeSync(2, `${line}\n`); } catch { /* stderr gone — nothing to do */ }
  });
  const exit = deps.exit ?? ((code: number) => process.exit(code));

  const fatal = (kind: 'uncaughtException' | 'unhandledRejection', err: unknown): void => {
    const detail = detailOf(err);
    const line = `[FATAL] ${kind}: ${detail}`;
    try { logger.error(line); } catch { /* logging must never block the exit */ }
    stderr(line);
    // Controlled exit — do NOT swallow: the process must not keep serving in an
    // unknown state. (Exit code 1, never 75: 75 is reserved for self-update.)
    process.exitCode = 1;
    exit(1);
  };

  emitter.on('uncaughtException', (err: unknown) => fatal('uncaughtException', err));
  emitter.on('unhandledRejection', (reason: unknown) => fatal('unhandledRejection', reason));
}
