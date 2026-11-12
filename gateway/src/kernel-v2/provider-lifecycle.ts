/**
 * Provider lifecycle for kernel-v2.
 *
 * States: load → validate → resolve → activate → active/degraded → drain →
 * dispose. Load/activate failures are isolated; a failed required provider
 * enters safe mode. Untrusted providers are rejected until a worker host
 * exists — never silently fall back to in-process.
 */

import { createKernelDiagnostic, type KernelDiagnostic, type KernelPlane } from './diagnostics';
import type { ProviderKind } from './manifest';

export type ProviderLifecycleState =
  | 'loaded'
  | 'valid'
  | 'resolved'
  | 'active'
  | 'degraded'
  | 'draining'
  | 'disposed'
  | 'failed';

export type ProviderHealth = 'healthy' | 'degraded' | 'failed';

export interface ProviderHandle {
  id: string;
  /** Dependency ids; unknown ids fail the dependent. */
  requires?: string[];
  /** Default trusted. Untrusted requires a worker host. */
  kind?: ProviderKind;
  load(): Promise<void>;
  activate(): Promise<void>;
  deactivate(): Promise<void>;
  health(): Promise<ProviderHealth>;
  dispose(): Promise<void>;
}

export interface LifecycleResult {
  active: string[];
  degraded: string[];
  failed: string[];
  safeMode: boolean;
}

export interface ProviderLifecycleOptions {
  required: string[];
  untrustedSupported: boolean;
  timeoutMs?: number;
  capability?: string;
  version?: string;
  revision?: string;
  plane?: KernelPlane;
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

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class ProviderLifecycle {
  private readonly required: Set<string>;
  private readonly untrustedSupported: boolean;
  private readonly timeoutMs: number;
  private readonly meta: {
    capability: string;
    version: string;
    revision: string;
    plane: KernelPlane;
  };
  private loadedHandles: ProviderHandle[] = [];
  private started = false;
  private stopped = false;

  constructor(options: ProviderLifecycleOptions) {
    this.required = new Set(options.required);
    this.untrustedSupported = options.untrustedSupported;
    this.timeoutMs = options.timeoutMs ?? 5_000;
    this.meta = {
      capability: options.capability ?? 'unknown',
      version: options.version ?? '0.0.0',
      revision: options.revision ?? 'unversioned',
      plane: options.plane ?? 'gateway',
    };
  }

  async start(handles: ProviderHandle[]): Promise<LifecycleResult> {
    if (this.started) throw new Error('provider lifecycle already started');
    this.started = true;

    const byId = new Map<string, ProviderHandle>();
    for (const handle of handles) {
      if (byId.has(handle.id)) throw new Error(`duplicate provider id: ${handle.id}`);
      byId.set(handle.id, handle);
    }

    const failed = new Set<string>();
    const ordered: ProviderHandle[] = [];
    const resolved = new Set<string>();
    const pending = new Map(byId);

    while (pending.size > 0) {
      let progressed = false;
      for (const [id, handle] of [...pending.entries()]) {
        const requires = handle.requires ?? [];
        const missing = requires.filter((dep) => !byId.has(dep));
        if (missing.length > 0) {
          failed.add(id);
          pending.delete(id);
          progressed = true;
          continue;
        }
        const blocked = requires.some((dep) => failed.has(dep));
        if (blocked) {
          failed.add(id);
          pending.delete(id);
          progressed = true;
          continue;
        }
        if (requires.every((dep) => resolved.has(dep))) {
          ordered.push(handle);
          resolved.add(id);
          pending.delete(id);
          progressed = true;
        }
      }
      if (!progressed) {
        for (const id of pending.keys()) failed.add(id);
        break;
      }
    }

    const loaded = new Set<string>();
    for (const handle of ordered) {
      if (failed.has(handle.id)) continue;
      if ((handle.requires ?? []).some((dep) => failed.has(dep))) {
        failed.add(handle.id);
        continue;
      }
      if (handle.kind === 'untrusted' && !this.untrustedSupported) {
        failed.add(handle.id);
        continue;
      }
      try {
        await handle.load();
        loaded.add(handle.id);
        this.loadedHandles.push(handle);
      } catch {
        failed.add(handle.id);
      }
    }

    const active: string[] = [];
    const degraded: string[] = [];
    for (const handle of ordered) {
      if (!loaded.has(handle.id) || failed.has(handle.id)) continue;
      if ((handle.requires ?? []).some((dep) => failed.has(dep))) {
        failed.add(handle.id);
        continue;
      }
      try {
        await withTimeout(handle.activate(), this.timeoutMs, `activate ${handle.id}`);
        const health = await handle.health();
        if (health === 'failed') {
          failed.add(handle.id);
        } else if (health === 'degraded') {
          degraded.push(handle.id);
        } else {
          active.push(handle.id);
        }
      } catch (error) {
        const timedOut = error instanceof Error && /timed out/i.test(error.message);
        if (timedOut || this.required.has(handle.id)) {
          failed.add(handle.id);
        } else {
          degraded.push(handle.id);
        }
      }
    }

    const safeMode = [...failed].some((id) => this.required.has(id));
    return {
      active,
      degraded,
      failed: [...failed].sort(),
      safeMode,
    };
  }

  async stop(): Promise<KernelDiagnostic[]> {
    if (this.stopped) return [];
    this.stopped = true;
    const diagnostics: KernelDiagnostic[] = [];

    for (const handle of [...this.loadedHandles].reverse()) {
      try {
        await handle.deactivate();
      } catch (error) {
        diagnostics.push(this.diagnostic(handle.id, 'failed', describeError(error)));
      }
      try {
        await handle.dispose();
      } catch (error) {
        diagnostics.push(this.diagnostic(handle.id, 'failed', describeError(error)));
      }
    }

    return diagnostics;
  }

  private diagnostic(
    providerId: string,
    state: 'failed' | 'disposed',
    reason?: string,
  ): KernelDiagnostic {
    return createKernelDiagnostic({
      providerId,
      capability: this.meta.capability,
      version: this.meta.version,
      plane: this.meta.plane,
      state,
      ...(reason !== undefined ? { reason } : {}),
      revision: this.meta.revision,
    });
  }
}
