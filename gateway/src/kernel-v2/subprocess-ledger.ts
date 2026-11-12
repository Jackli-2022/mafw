/**
 * Subprocess ownership ledger (kernel-v2 Phase 2, S3).
 *
 * Providers that own a child process register it here. The ledger is the
 * single place that knows whether the gateway may kill a process:
 *
 * - `provider` processes were spawned by this gateway and are stopped on
 *   dispose.
 * - `external` processes were adopted (already running, health-compatible);
 *   they are observed and recorded but never killed.
 *
 * `dispose()` is LIFO and isolates stop failures so one bad child cannot
 * prevent the rest from shutting down. Records stay in the snapshot after
 * stop/failure for diagnostics.
 */

export type SubprocessOwnership = 'provider' | 'external';
export type SubprocessState = 'starting' | 'running' | 'stopped' | 'failed';

export interface SubprocessHandle {
  pid?: number;
  stop(): Promise<void>;
  stopSync?(): void;
}

export interface SubprocessRecord {
  id: string;
  pid?: number;
  ownership: SubprocessOwnership;
  state: SubprocessState;
  startedAt: number;
  stoppedAt?: number;
  reason?: string;
}

interface TrackedSubprocess {
  record: SubprocessRecord;
  handle: SubprocessHandle;
}

export class SubprocessLedger {
  private readonly tracked = new Map<string, TrackedSubprocess>();
  private disposed = false;

  track(
    id: string,
    handle: SubprocessHandle,
    ownership: SubprocessOwnership = 'provider',
  ): void {
    this.assertOpen();
    this.assertNew(id);
    this.tracked.set(id, {
      record: {
        id,
        pid: handle.pid,
        ownership,
        state: 'starting',
        startedAt: Date.now(),
      },
      handle,
    });
  }

  adopt(id: string, handle: SubprocessHandle): void {
    this.assertOpen();
    this.assertNew(id);
    this.tracked.set(id, {
      record: {
        id,
        pid: handle.pid,
        ownership: 'external',
        state: 'running',
        startedAt: Date.now(),
      },
      handle,
    });
  }

  markRunning(id: string): void {
    const item = this.require(id);
    if (item.record.state !== 'starting') {
      throw new Error(`subprocess ${id} cannot transition from ${item.record.state} to running`);
    }
    item.record.state = 'running';
  }

  markFailed(id: string, reason: string): void {
    const item = this.require(id);
    item.record.state = 'failed';
    item.record.reason = reason;
  }

  markStopped(id: string, reason?: string): void {
    const item = this.require(id);
    item.record.state = 'stopped';
    item.record.stoppedAt = Date.now();
    if (reason !== undefined) item.record.reason = reason;
  }

  snapshot(): SubprocessRecord[] {
    return [...this.tracked.values()].map((item) => ({ ...item.record }));
  }

  active(): SubprocessRecord[] {
    return this.snapshot().filter(
      (item) => item.state === 'starting' || item.state === 'running',
    );
  }

  /**
   * Stops all owned processes in reverse registration order. Adopted
   * processes are marked stopped but never killed. Idempotent.
   */
  async dispose(): Promise<Array<{ id: string; error: string }>> {
    if (this.disposed) return [];
    this.disposed = true;
    const errors: Array<{ id: string; error: string }> = [];

    for (const item of [...this.tracked.values()].reverse()) {
      if (item.record.ownership === 'external') {
        this.markStopped(item.record.id);
        continue;
      }
      if (item.record.state === 'stopped') continue;
      try {
        await item.handle.stop();
        this.markStopped(item.record.id);
      } catch (err) {
        errors.push({
          id: item.record.id,
          error: err instanceof Error ? err.message : String(err),
        });
        this.markFailed(
          item.record.id,
          `stop failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    return errors;
  }

  private require(id: string): TrackedSubprocess {
    const item = this.tracked.get(id);
    if (!item) throw new Error(`unknown subprocess: ${id}`);
    return item;
  }

  private assertNew(id: string): void {
    if (this.tracked.has(id)) throw new Error(`subprocess already tracked: ${id}`);
  }

  private assertOpen(): void {
    if (this.disposed) throw new Error('subprocess ledger is disposed');
  }
}
