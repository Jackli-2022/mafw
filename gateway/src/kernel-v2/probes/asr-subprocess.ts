/**
 * S3 probe: an ASR provider that owns a subprocess sidecar.
 *
 * This is deliberately standalone: it consumes a small `SidecarLike` seam and
 * an `AsrEngine`, so the subprocess lifecycle can be proven without spawning
 * Python. The real Qwen3 sidecar/engine fit the seam structurally.
 *
 * Invariants proven here:
 * - load never spawns; activate is lazy and single-flight
 * - a failed start is recorded in the ledger and leaves no active child
 * - adopted (external) sidecars are observed but never stopped
 * - health reflects the sidecar readiness probe
 * - deactivate/dispose are idempotent and stop an owned child once
 */

import { assertAsrCapabilities, type AsrEngine } from '../../voice/types';
import type { ProviderHandle, ProviderHealth } from '../provider-lifecycle';
import { SubprocessLedger, type SubprocessHandle } from '../subprocess-ledger';

export interface SidecarLike {
  start(): Promise<void>;
  stop(): Promise<void>;
  stopSync?(): void;
  isReady(): Promise<boolean>;
  isExternal?(): boolean;
  readonly pid?: number;
}

export interface AsrSidecarProviderOptions {
  id: string;
  sidecar: SidecarLike;
  engine: AsrEngine;
  ledger: SubprocessLedger;
  startupTimeoutMs?: number;
}

export interface AsrSidecarProvider extends ProviderHandle {
  readonly engine: AsrEngine;
  readonly sidecar: SidecarLike;
  /** Last health observed by activate()/health(); safe for sync registry callbacks. */
  readonly cachedHealth: ProviderHealth | undefined;
  startOnce(): Promise<void>;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export function createAsrSidecarProvider(
  options: AsrSidecarProviderOptions,
): AsrSidecarProvider {
  const { id, sidecar, engine, ledger } = options;
  const startupTimeoutMs = options.startupTimeoutMs ?? 180_000;

  let startPromise: Promise<void> | undefined;
  let ledgerRecorded = false;
  let owned = false;
  let active = false;
  let stopped = false;
  let stopSyncCalled = false;
  let lastHealth: ProviderHealth | undefined;
  let deactivateError: string | undefined;

  const handle: SubprocessHandle = {
    get pid() {
      return sidecar.pid;
    },
    stop: () => sidecar.stop(),
    ...(sidecar.stopSync ? { stopSync: () => sidecar.stopSync?.() } : {}),
  };

  function startOnce(): Promise<void> {
    if (startPromise) return startPromise;
    startPromise = (async () => {
      try {
        await withTimeout(sidecar.start(), startupTimeoutMs, `start ${id}`);
      } catch (error) {
        if (!ledgerRecorded) {
          ledger.track(id, handle);
          ledgerRecorded = true;
        }
        ledger.markFailed(id, messageOf(error));
        lastHealth = 'failed';
        throw error;
      }

      if (!ledgerRecorded) {
        if (sidecar.isExternal?.()) {
          ledger.adopt(id, handle);
          owned = false;
        } else {
          ledger.track(id, handle);
          ledger.markRunning(id);
          owned = true;
        }
        ledgerRecorded = true;
      }

      active = true;
      stopped = false;
      try {
        lastHealth = (await sidecar.isReady()) ? 'healthy' : 'failed';
      } catch {
        lastHealth = 'failed';
      }
    })();
    return startPromise;
  }

  async function deactivate(): Promise<void> {
    if (!ledgerRecorded || stopped) return;
    const record = ledger.snapshot().find((item) => item.id === id);
    if (!record) return;

    if (record.ownership === 'external') {
      ledger.markStopped(id);
      stopped = true;
      active = false;
      return;
    }

    try {
      if (owned) await sidecar.stop();
    } catch (error) {
      deactivateError = messageOf(error);
      lastHealth = 'failed';
    } finally {
      ledger.markStopped(id);
      stopped = true;
      active = false;
    }
  }

  return {
    id,
    engine,
    sidecar,
    get cachedHealth() {
      return lastHealth;
    },
    startOnce,
    async load(): Promise<void> {
      if (!engine.name) throw new Error(`ASR engine for ${id} has no name`);
      assertAsrCapabilities(engine.capabilities);
    },
    async activate(): Promise<void> {
      await startOnce();
    },
    deactivate,
    async health(): Promise<ProviderHealth> {
      if (!active || stopped) return 'failed';
      try {
        lastHealth = (await sidecar.isReady()) ? 'healthy' : 'failed';
      } catch {
        lastHealth = 'failed';
      }
      return lastHealth;
    },
    async dispose(): Promise<void> {
      await deactivate();
      if (owned && startPromise && !stopSyncCalled) {
        stopSyncCalled = true;
        try {
          sidecar.stopSync?.();
        } catch {
          deactivateError ??= `stopSync failed for ${id}`;
        }
      }
      void deactivateError;
    },
  };
}
