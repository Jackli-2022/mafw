export type PipelineRunStatus = 'ran' | 'skipped' | 'timeout' | 'error';

export interface PipelineGuardOptions {
  /** Watchdog: force-release a guard key after this many ms (default 30 min). */
  timeoutMs?: number;
  log?: (msg: string) => void;
}

/**
 * Action-level in-flight guard, keyed by action name.
 *
 * Two properties matter (both were bugs when this was a single global boolean):
 * - **Per-key isolation**: a long/hung compaction flush must not block the hourly
 *   cron (or another session's flush). Each distinct name runs independently.
 * - **Watchdog**: a run that never settles must not hold its key forever. On
 *   timeout the key is released and a loud warning is logged, so the next trigger
 *   can proceed (the abandoned run's effects are bounded by its own IO timeouts).
 */
export class PipelineGuard {
  private running = new Set<string>();

  constructor(private opts: PipelineGuardOptions = {}) {}

  get size(): number {
    return this.running.size;
  }

  isRunning(name: string): boolean {
    return this.running.has(name);
  }

  async run(name: string, fn: () => Promise<void>): Promise<PipelineRunStatus> {
    if (this.running.has(name)) {
      this.opts.log?.(`[Scheduler] ${name} skipped: previous run still in flight`);
      return 'skipped';
    }
    this.running.add(name);
    const timeoutMs = this.opts.timeoutMs ?? 30 * 60_000;
    let timedOut = false;
    try {
      await Promise.race([
        fn(),
        new Promise<void>((_resolve, reject) => {
          const t = setTimeout(() => {
            timedOut = true;
            reject(new Error(`exceeded ${timeoutMs}ms`));
          }, timeoutMs);
          (t as any).unref?.();
        }),
      ]);
      return 'ran';
    } catch (err: any) {
      this.opts.log?.(`[Scheduler] ${name} ${timedOut ? 'watchdog timeout' : 'run error'}: ${err.message}`);
      return timedOut ? 'timeout' : 'error';
    } finally {
      this.running.delete(name);
    }
  }
}
