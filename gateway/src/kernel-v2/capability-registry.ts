/**
 * Minimal capability registry for the fixed-core / replaceable-provider spike.
 *
 * A capability has one or more providers arranged in precedence tiers. The
 * consumer asks for an id (or the default) and never sees the tier bookkeeping.
 * This is deliberately smaller than the production kernel: it proves default,
 * override, fallback, listing and reverse-order disposal without introducing
 * scopes, health probes or dependency injection yet.
 */

export type CapabilityTier = 'builtin' | 'legacy' | 'package';

export interface CapabilityEntry<T> {
  id: string;
  value: T;
  /** Registry-owned teardown; called once by dispose(). */
  dispose?: () => void | Promise<void>;
}

export interface CapabilityRegistryOptions {
  defaultId: string;
  /** Ascending precedence. Default: builtin -> legacy -> package. */
  tiers?: readonly CapabilityTier[];
  /** Called when an explicit id is missing and the default is used instead. */
  onFallback?: (wanted: string, usedDefault: string) => void;
  /** Caller-shaped error when neither the id nor the default exists. */
  missingMessage?: (wanted: string) => string;
}

export interface CapabilityDiagnostic {
  id: string;
  message: string;
}

interface SequencedEntry<T> {
  tier: CapabilityTier;
  entry: CapabilityEntry<T>;
}

export class CapabilityRegistry<T> {
  private readonly defaultId: string;
  private readonly tierOrder: readonly CapabilityTier[];
  private readonly onFallback?: CapabilityRegistryOptions['onFallback'];
  private readonly missingMessage?: CapabilityRegistryOptions['missingMessage'];
  private readonly tiers = new Map<CapabilityTier, Map<string, CapabilityEntry<T>>>();
  /** Global registration order; dispose reverses it (LIFO). */
  private sequence: SequencedEntry<T>[] = [];
  private disposed = false;
  private disposing: Promise<CapabilityDiagnostic[]> | null = null;

  constructor(options: CapabilityRegistryOptions) {
    this.defaultId = options.defaultId;
    this.tierOrder = options.tiers ?? ['builtin', 'legacy', 'package'];
    this.onFallback = options.onFallback;
    this.missingMessage = options.missingMessage;
    for (const tier of this.tierOrder) this.tiers.set(tier, new Map());
  }

  get size(): number {
    return this.sequence.length;
  }

  get isDisposed(): boolean {
    return this.disposed;
  }

  register(tier: CapabilityTier, entry: CapabilityEntry<T>): void {
    this.assertOpen();
    const bucket = this.tiers.get(tier);
    if (!bucket) throw new Error(`unknown capability tier: ${tier}`);
    bucket.set(entry.id, entry);
    // The displaced provider is no longer tracked; its owner must dispose it.
    this.sequence = this.sequence.filter(
      (item) => !(item.tier === tier && item.entry.id === entry.id),
    );
    this.sequence.push({ tier, entry });
  }

  /**
   * Replaces a whole tier synchronously. Replaced providers are not disposed
   * here: the caller owns them until the next explicit dispose()/shutdown.
   */
  replaceTier(tier: CapabilityTier, entries: readonly CapabilityEntry<T>[]): void {
    this.assertOpen();
    if (!this.tiers.has(tier)) throw new Error(`unknown capability tier: ${tier}`);
    this.tiers.set(tier, new Map(entries.map((entry) => [entry.id, entry])));
    this.sequence = [
      ...this.sequence.filter((item) => item.tier !== tier),
      ...entries.map((entry) => ({ tier, entry })),
    ];
  }

  resolve(id?: string): T {
    this.assertOpen();
    const explicit = typeof id === 'string' && id.length > 0;
    const wanted = explicit ? id : this.defaultId;
    const found = this.find(wanted);
    if (found) return found.value;

    const fallback = this.find(this.defaultId);
    if (!fallback) {
      const message = this.missingMessage?.(wanted) ?? `no provider registered for "${wanted}"`;
      throw new Error(message);
    }
    if (explicit && wanted !== this.defaultId) {
      this.onFallback?.(wanted, this.defaultId);
    }
    return fallback.value;
  }

  get(id: string): T | undefined {
    this.assertOpen();
    return this.find(id)?.value;
  }

  list(): Array<{ id: string; value: T; tier: CapabilityTier }> {
    this.assertOpen();
    const merged = new Map<string, { value: T; tier: CapabilityTier }>();
    for (const tier of this.tierOrder) {
      const bucket = this.tiers.get(tier);
      if (!bucket) continue;
      for (const [id, entry] of bucket) {
        merged.set(id, { value: entry.value, tier });
      }
    }
    return [...merged.entries()].map(([id, item]) => ({ id, value: item.value, tier: item.tier }));
  }

  /**
   * Disposes every provider in reverse registration order, isolating failures.
   * The first call returns diagnostics; later calls are no-ops.
   */
  dispose(): Promise<CapabilityDiagnostic[]> {
    // `disposed` is set before the async body starts so a disposer that calls
    // back into the registry cannot start a second disposal pass.
    if (this.disposed) return Promise.resolve([]);
    this.disposed = true;
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

  private find(id: string): CapabilityEntry<T> | undefined {
    for (let index = this.tierOrder.length - 1; index >= 0; index -= 1) {
      const bucket = this.tiers.get(this.tierOrder[index]);
      const found = bucket?.get(id);
      if (found) return found;
    }
    return undefined;
  }

  private assertOpen(): void {
    if (this.disposed) throw new Error('capability registry is disposed');
  }
}
