/**
 * Scoped capability registry (kernel-v2 Phase 1).
 *
 * Providers are arranged by scope (global → project → session) and precedence
 * tiers (builtin → legacy → package). Consumers resolve a value by id without
 * seeing the bookkeeping. Resolution is cached; register/replace/invalidate
 * clears the cache.
 *
 * This is still an in-process registry: no filesystem, no boot wiring, no
 * provider imports. Scopes are logical address spaces, not OS isolation.
 */

import { createKernelDiagnostic, type KernelDiagnostic, type KernelPlane } from './diagnostics';

export type CapabilityTier = 'builtin' | 'legacy' | 'package';

export type CapabilityScope =
  | { kind: 'global' }
  | { kind: 'project'; projectId: string }
  | { kind: 'session'; projectId: string; sessionId: string };

export type CapabilityHealth = 'healthy' | 'degraded' | 'failed';

export interface CapabilityEntry<T> {
  id: string;
  value: T;
  /** Registry-owned teardown; called once by dispose(). */
  dispose?: () => void | Promise<void>;
  /** Higher wins among the same scope + tier. */
  priority?: number;
  /** Checked on resolve; failed entries are skipped. */
  health?: () => CapabilityHealth;
}

export interface CapabilityRegistryOptions {
  defaultId: string;
  /** Ascending precedence. Default: builtin -> legacy -> package. */
  tiers?: readonly CapabilityTier[];
  /** Called when an explicit id is missing and the default is used instead. */
  onFallback?: (wanted: string, usedDefault: string) => void;
  /** Caller-shaped error when neither the id nor the default exists. */
  missingMessage?: (wanted: string) => string;
  /** Diagnostic metadata for this capability family. */
  capability?: string;
  version?: string;
  revision?: string;
  plane?: KernelPlane;
}

export interface CapabilityDiagnostic {
  id: string;
  message: string;
}

interface SequencedEntry<T> {
  scope: CapabilityScope;
  scopeKey: string;
  tier: CapabilityTier;
  entry: CapabilityEntry<T>;
  order: number;
}

interface Candidate<T> {
  scope: CapabilityScope;
  tier: CapabilityTier;
  entry: CapabilityEntry<T>;
  order: number;
}

const GLOBAL_SCOPE: CapabilityScope = { kind: 'global' };

function healthOf<T>(entry: CapabilityEntry<T>): CapabilityHealth {
  try {
    return entry.health?.() ?? 'healthy';
  } catch {
    return 'failed';
  }
}

function scopeKey(scope: CapabilityScope): string {
  switch (scope.kind) {
    case 'global':
      return 'global';
    case 'project':
      return `project:${scope.projectId}`;
    case 'session':
      return `session:${scope.projectId}:${scope.sessionId}`;
  }
}

function scopeRank(scope: CapabilityScope): number {
  switch (scope.kind) {
    case 'session':
      return 2;
    case 'project':
      return 1;
    case 'global':
      return 0;
  }
}

export class CapabilityRegistry<T> {
  private readonly defaultId: string;
  private readonly tierOrder: readonly CapabilityTier[];
  private readonly onFallback?: CapabilityRegistryOptions['onFallback'];
  private readonly missingMessage?: CapabilityRegistryOptions['missingMessage'];
  private readonly diagnosticMeta: {
    capability: string;
    version: string;
    revision: string;
    plane: KernelPlane;
  };
  private readonly scopes = new Map<string, Map<CapabilityTier, Map<string, CapabilityEntry<T>>>>();
  private sequence: SequencedEntry<T>[] = [];
  private readonly cache = new Map<string, T>();
  private readonly lastGood = new Map<string, T>();
  private nextOrder = 0;
  private disposed = false;
  private disposing: Promise<CapabilityDiagnostic[]> | null = null;

  constructor(options: CapabilityRegistryOptions) {
    this.defaultId = options.defaultId;
    this.tierOrder = options.tiers ?? ['builtin', 'legacy', 'package'];
    this.onFallback = options.onFallback;
    this.missingMessage = options.missingMessage;
    this.diagnosticMeta = {
      capability: options.capability ?? 'unknown',
      version: options.version ?? '0.0.0',
      revision: options.revision ?? 'unversioned',
      plane: options.plane ?? 'gateway',
    };
    for (const tier of this.tierOrder) {
      this.bucket(GLOBAL_SCOPE, tier, true);
    }
  }

  get size(): number {
    return this.sequence.length;
  }

  get isDisposed(): boolean {
    return this.disposed;
  }

  register(
    tier: CapabilityTier,
    entry: CapabilityEntry<T>,
    scope: CapabilityScope = GLOBAL_SCOPE,
  ): void {
    this.assertOpen();
    const bucket = this.bucket(scope, tier, true);
    bucket.set(entry.id, entry);
    const key = scopeKey(scope);
    // The displaced provider is no longer tracked; its owner must dispose it.
    this.sequence = this.sequence.filter(
      (item) => !(item.scopeKey === key && item.tier === tier && item.entry.id === entry.id),
    );
    this.sequence.push({ scope, scopeKey: key, tier, entry, order: this.nextOrder++ });
    this.invalidate();
  }

  /**
   * Replaces a whole tier synchronously. Replaced providers are not disposed
   * here: the caller owns them until the next explicit dispose()/shutdown.
   */
  replaceTier(
    tier: CapabilityTier,
    entries: readonly CapabilityEntry<T>[],
    scope: CapabilityScope = GLOBAL_SCOPE,
  ): void {
    this.assertOpen();
    if (!this.tierOrder.includes(tier)) throw new Error(`unknown capability tier: ${tier}`);
    const key = scopeKey(scope);
    this.scopes.set(key, this.scopes.get(key) ?? new Map());
    this.scopes.get(key)!.set(tier, new Map(entries.map((entry) => [entry.id, entry])));
    this.sequence = [
      ...this.sequence.filter((item) => !(item.scopeKey === key && item.tier === tier)),
      ...entries.map((entry) => ({
        scope,
        scopeKey: key,
        tier,
        entry,
        order: this.nextOrder++,
      })),
    ];
    this.invalidate();
  }

  resolve(id?: string, scope: CapabilityScope = GLOBAL_SCOPE): T {
    this.assertOpen();
    const explicit = typeof id === 'string' && id.length > 0;
    const wanted = explicit ? id : this.defaultId;
    const key = `${scopeKey(scope)}|${wanted}`;
    if (this.cache.has(key)) return this.cache.get(key) as T;

    const candidates = this.candidates(wanted, scope);
    const healthy = candidates.find((item) => healthOf(item.entry) !== 'failed');
    if (healthy) return this.remember(key, healthy.entry.value);

    const previous = this.lastGood.get(key);
    if (previous !== undefined) return previous;

    const fallbackKey = `${scopeKey(scope)}|${this.defaultId}`;
    if (this.cache.has(fallbackKey)) {
      if (explicit && wanted !== this.defaultId) this.onFallback?.(wanted, this.defaultId);
      return this.cache.get(fallbackKey) as T;
    }
    const fallbackCandidates = this.candidates(this.defaultId, scope);
    const fallback = fallbackCandidates.find((item) => healthOf(item.entry) !== 'failed');
    if (fallback) {
      if (explicit && wanted !== this.defaultId) this.onFallback?.(wanted, this.defaultId);
      return this.remember(fallbackKey, fallback.entry.value);
    }

    const message = this.missingMessage?.(wanted) ?? `no provider registered for "${wanted}"`;
    throw new Error(message);
  }

  /** Highest-priority healthy provider visible in the scope (not id-bound). */
  resolveBest(scope: CapabilityScope = GLOBAL_SCOPE): T {
    this.assertOpen();
    const candidates = this.allCandidates(scope).filter((item) => healthOf(item.entry) !== 'failed');
    if (candidates.length === 0) {
      throw new Error(this.missingMessage?.(this.defaultId) ?? `no provider registered for "${this.defaultId}"`);
    }
    return candidates[0].entry.value;
  }

  get(id: string, scope: CapabilityScope = GLOBAL_SCOPE): T | undefined {
    this.assertOpen();
    return this.candidates(id, scope)[0]?.entry.value;
  }

  list(scope: CapabilityScope = GLOBAL_SCOPE): Array<{
    id: string;
    value: T;
    tier: CapabilityTier;
    scope: CapabilityScope;
  }> {
    this.assertOpen();
    const chain = this.scopeChain(scope);
    const merged = new Map<string, { value: T; tier: CapabilityTier; scope: CapabilityScope }>();
    for (let index = chain.length - 1; index >= 0; index -= 1) {
      const current = chain[index];
      for (const tier of this.tierOrder) {
        const bucket = this.scopes.get(scopeKey(current))?.get(tier);
        if (!bucket) continue;
        for (const [id, entry] of bucket) {
          merged.set(id, { value: entry.value, tier, scope: current });
        }
      }
    }
    return [...merged.entries()].map(([id, item]) => ({
      id,
      value: item.value,
      tier: item.tier,
      scope: item.scope,
    }));
  }

  /** Drop cached resolutions after external health/state changes. */
  invalidate(): void {
    this.cache.clear();
  }

  diagnostics(): KernelDiagnostic[] {
    return this.sequence.map((item) => {
      const health = healthOf(item.entry);
      const state = health === 'failed' ? 'failed' : health === 'degraded' ? 'degraded' : 'active';
      return createKernelDiagnostic({
        providerId: item.entry.id,
        capability: this.diagnosticMeta.capability,
        version: this.diagnosticMeta.version,
        plane: this.diagnosticMeta.plane,
        state,
        ...(state === 'active' ? {} : { reason: `health: ${health}` }),
        revision: this.diagnosticMeta.revision,
      });
    });
  }

  /**
   * Disposes every provider in reverse registration order, isolating failures.
   * The first call returns diagnostics; later calls are no-ops.
   */
  dispose(): Promise<CapabilityDiagnostic[]> {
    if (this.disposed) return Promise.resolve([]);
    this.disposed = true;
    this.cache.clear();
    this.disposing = (async () => {
      const diagnostics: CapabilityDiagnostic[] = [];
      for (const item of [...this.sequence].reverse()) {
        if (!item.entry.dispose) continue;
        try {
          await item.entry.dispose();
        } catch (err) {
          diagnostics.push({
            id: item.entry.id,
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }
      return diagnostics;
    })();
    return this.disposing;
  }

  private remember(key: string, value: T): T {
    this.cache.set(key, value);
    this.lastGood.set(key, value);
    return value;
  }

  private scopeChain(scope: CapabilityScope): CapabilityScope[] {
    if (scope.kind === 'session') {
      return [scope, { kind: 'project', projectId: scope.projectId }, GLOBAL_SCOPE];
    }
    if (scope.kind === 'project') return [scope, GLOBAL_SCOPE];
    return [GLOBAL_SCOPE];
  }

  private candidates(id: string, scope: CapabilityScope): Candidate<T>[] {
    const out: Candidate<T>[] = [];
    const chain = this.scopeChain(scope);
    chain.forEach((current, scopeIndex) => {
      for (let tierIndex = this.tierOrder.length - 1; tierIndex >= 0; tierIndex -= 1) {
        const tier = this.tierOrder[tierIndex];
        const entry = this.scopes.get(scopeKey(current))?.get(tier)?.get(id);
        if (!entry) continue;
        const order = this.sequence.find(
          (item) =>
            item.scopeKey === scopeKey(current) && item.tier === tier && item.entry.id === id,
        )?.order ?? Number.MAX_SAFE_INTEGER;
        out.push({ scope: current, tier, entry, order });
        void scopeIndex;
      }
    });
    return out.sort((a, b) => this.compareCandidates(a, b));
  }

  private allCandidates(scope: CapabilityScope): Candidate<T>[] {
    const out: Candidate<T>[] = [];
    for (const current of this.scopeChain(scope)) {
      for (const tier of this.tierOrder) {
        const bucket = this.scopes.get(scopeKey(current))?.get(tier);
        if (!bucket) continue;
        for (const entry of bucket.values()) {
          const order = this.sequence.find(
            (item) =>
              item.scopeKey === scopeKey(current) && item.tier === tier && item.entry.id === entry.id,
          )?.order ?? Number.MAX_SAFE_INTEGER;
          out.push({ scope: current, tier, entry, order });
        }
      }
    }
    return out.sort((a, b) => this.compareCandidates(a, b));
  }

  private compareCandidates(a: Candidate<T>, b: Candidate<T>): number {
    const scopeDelta = scopeRank(b.scope) - scopeRank(a.scope);
    if (scopeDelta !== 0) return scopeDelta;
    const tierA = this.tierOrder.indexOf(a.tier);
    const tierB = this.tierOrder.indexOf(b.tier);
    if (tierA !== tierB) return tierB - tierA;
    const priorityDelta = (b.entry.priority ?? 0) - (a.entry.priority ?? 0);
    if (priorityDelta !== 0) return priorityDelta;
    if (a.order !== b.order) return a.order - b.order;
    return a.entry.id.localeCompare(b.entry.id);
  }

  private bucket(
    scope: CapabilityScope,
    tier: CapabilityTier,
    create: boolean,
  ): Map<string, CapabilityEntry<T>> {
    if (!this.tierOrder.includes(tier)) throw new Error(`unknown capability tier: ${tier}`);
    const key = scopeKey(scope);
    let scopeMap = this.scopes.get(key);
    if (!scopeMap) {
      if (!create) throw new Error(`unknown capability scope: ${key}`);
      scopeMap = new Map();
      this.scopes.set(key, scopeMap);
    }
    let bucket = scopeMap.get(tier);
    if (!bucket) {
      if (!create) throw new Error(`unknown capability tier: ${tier}`);
      bucket = new Map();
      scopeMap.set(tier, bucket);
    }
    return bucket;
  }

  private assertOpen(): void {
    if (this.disposed) throw new Error('capability registry is disposed');
  }
}
