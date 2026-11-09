import { validateAdapterEvent, type AdapterEvent, type RuntimeDefinition } from '@mafw/runtime-contract';
import { mapAdapterEvent, type MappedAdapterEvent } from './adapter-event-mapper';

export type DeliveredAdapterEvent = MappedAdapterEvent & { runtimeName: string };

export interface RuntimeBusStats {
  unknown: number;
  duplicate: number;
  stale: number;
  dropped: number;
}

export interface RuntimeBusTelemetry {
  kind: 'unknown' | 'duplicate' | 'stale' | 'dropped';
  type?: string;
  runtimeName?: string;
}

const SEEN_LIMIT = 2048;

export class RuntimeBus {
  private readonly definitions = new Map<string, { definition: RuntimeDefinition; unsubscribe: () => void }>();
  private readonly listeners = new Set<(event: DeliveredAdapterEvent) => void>();
  private readonly telemetry = new Set<(event: RuntimeBusTelemetry) => void>();
  private readonly seen = new Map<string, Set<string>>();
  private readonly lastSeq = new Map<string, number>();
  private readonly retiredTurns = new Map<string, Set<string>>();
  private defaultRuntime: string | undefined;
  private counters: RuntimeBusStats = { unknown: 0, duplicate: 0, stale: 0, dropped: 0 };

  register(definition: RuntimeDefinition): void {
    this.unregister(definition.name);
    const unsubscribe = definition.transport.onEvent((event) => this.dispatch(event, definition.name));
    this.definitions.set(definition.name, { definition, unsubscribe });
    this.defaultRuntime ??= definition.name;
  }

  unregister(name: string): void {
    const current = this.definitions.get(name);
    if (!current) return;
    current.unsubscribe();
    this.definitions.delete(name);
    if (this.defaultRuntime === name) this.defaultRuntime = this.definitions.keys().next().value;
  }

  subscribe(listener: (event: DeliveredAdapterEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onTelemetry(listener: (event: RuntimeBusTelemetry) => void): () => void {
    this.telemetry.add(listener);
    return () => this.telemetry.delete(listener);
  }

  private report(kind: RuntimeBusTelemetry['kind'], event: AdapterEvent | undefined, runtimeName: string): void {
    this.counters[kind] += 1;
    const telemetry = { kind, ...(event?.type ? { type: event.type } : {}), runtimeName };
    for (const listener of this.telemetry) {
      try { listener(telemetry); } catch { /* telemetry must not affect dispatch */ }
    }
  }

  /** Called by adapters' onEvent; tests may call it directly. */
  dispatch(input: AdapterEvent, runtimeName = this.defaultRuntime ?? 'unknown'): void {
    const validation = validateAdapterEvent(input);
    if (!validation.ok) {
      const unknown = validation.errors.some((error) => error.startsWith('unknown event type'));
      this.report(unknown ? 'unknown' : 'dropped', input, runtimeName);
      return;
    }
    const event = validation.event;

    if (event.sessionID) {
      const seen = this.seen.get(event.sessionID) ?? new Set<string>();
      if (seen.has(event.id)) {
        this.report('duplicate', event, runtimeName);
        return;
      }
      seen.add(event.id);
      if (seen.size > SEEN_LIMIT) {
        const oldest = seen.values().next().value;
        if (oldest !== undefined) seen.delete(oldest);
      }
      this.seen.set(event.sessionID, seen);
    }

    if (event.sessionID && event.seq !== undefined) {
      const previous = this.lastSeq.get(event.sessionID);
      if (previous !== undefined && event.seq <= previous) {
        this.report('stale', event, runtimeName);
        return;
      }
      this.lastSeq.set(event.sessionID, event.seq);
    }

    if (event.sessionID && event.turnID && this.retiredTurns.get(event.sessionID)?.has(event.turnID)) {
      this.report('stale', event, runtimeName);
      return;
    }

    const mapped = mapAdapterEvent(event);
    if (mapped.dropped) {
      this.report('dropped', event, runtimeName);
      return;
    }

    for (const listener of this.listeners) {
      try {
        listener({ ...mapped, runtimeName });
      } catch {
        // A bad consumer must not stop the fan-out or break the bus.
      }
    }

    if (event.sessionID && event.turnID && (event.type === 'turn.completed' || event.type === 'turn.failed' || event.type === 'turn.aborted')) {
      const retired = this.retiredTurns.get(event.sessionID) ?? new Set<string>();
      retired.add(event.turnID);
      this.retiredTurns.set(event.sessionID, retired);
    }
  }

  stats(): RuntimeBusStats {
    return { ...this.counters };
  }

  async flush(): Promise<void> {
    await Promise.resolve();
  }
}
