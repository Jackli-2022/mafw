import type { ServeSupervisor } from './serve-supervisor';

export interface ServeEnsureHooks {
  startWatchdog(): void;
}

interface EnsureLogger {
  info(message: string): void;
  warn(message: string): void;
}

/**
 * Make sure the opencode serve sidecar exists before handing out a builtin
 * opencode runtime. A gateway started under an external runtime (pi) never
 * spawns serve; switching back to opencode without this step yields a client
 * pointing at a dead port. Idempotent: ensureStarted() adopts an already
 * running serve or spawns a fresh one.
 */
export async function ensureServeForBuiltinRuntime(
  supervisor: ServeSupervisor,
  hooks: ServeEnsureHooks,
  log: EnsureLogger,
): Promise<void> {
  try {
    const url = await supervisor.ensureStarted();
    hooks.startWatchdog();
    log.info(`[Runtime] opencode serve ready at ${url}`);
  } catch (err: any) {
    // external serve mode (user-managed) or spawn failure: surface but do not
    // block the switch — the runtime will surface connection errors on use.
    log.warn(`[Runtime] serve ensureStarted failed (non-fatal): ${err.message}`);
  }
}
