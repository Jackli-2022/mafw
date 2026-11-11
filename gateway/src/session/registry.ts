// gateway/src/session/registry.ts
// Unified session registry — the gateway's process table. One record per
// sessionID answering "who owns this session, in what state, until when".
//
// Model (kernel refactor Phase C):
// - Views either OWN a record (SessionWorkerPool kind 'worker' with TTL;
//   LeadSessionRegistry kind 'lead'; PodSessionSupervisor goal-scoped mirrors)
//   or OVERLAY metadata on a shared record (internalSessionRoles =
//   metadata.role; worker-origin = metadata.originSessionID).
// - TTL expiry is lazy: lookup()/byScope() materialize status 'ended' without
//   removing the record; sweep() collects expired records and fires the
//   per-record onEvict (explicit unregister never fires it).
// - Re-registering an active record updates it in place (scope may be
//   replaced — the new owner takes the record; metadata merges); registering
//   over an ended/swept record continues the generation sequence via a
//   bounded stash of retired generations.
//
// Spec: docs/superpowers/specs/2026-11-09-gateway-kernel-session-registry-design.md

import { SessionScope } from './scope';

export type SessionStatus = 'active' | 'idle' | 'ended';

export interface SessionRecord {
  sessionID: string;
  scope: SessionScope;
  /** 'ended' is materialized lazily on expiry; sweep() removes the record. */
  status: SessionStatus;
  runtimeName?: string;
  /** Lease generation — increments on re-register after the record ended/was retired. */
  generation: number;
  createdAt: number;
  lastActiveAt: number;
  /** TTL from registration/touch; null = never expires. */
  ttlMs: number | null;
  expiresAt: number | null;
  metadata: Record<string, unknown>;
  // NOTE: the per-record eviction callback lives on RegisterInput only —
  // public record copies never expose it (internal plumbing).
}

export interface RegisterInput {
  sessionID: string;
  scope: SessionScope;
  metadata?: Record<string, unknown>;
  /** TTL from registration/touch. Three states (E1-12): `undefined` on a
   *  re-register of an ACTIVE record keeps the current TTL (a lease renewal);
   *  `null` (or `0`/negative, legacy) = permanent; a positive number overrides
   *  and re-arms the lease from now. A first registration treats `undefined`
   *  as permanent. */
  ttlMs?: number | null;
  runtimeName?: string;
  onEvict?: (record: SessionRecord) => void;
}

export interface SessionRegistryOpts {
  now?: () => number;
  log?: (msg: string) => void;
}

const RETIRED_GENERATIONS_CAP = 10_000;

interface StoredRecord {
  sessionID: string;
  scope: SessionScope;
  runtimeName?: string;
  generation: number;
  createdAt: number;
  lastActiveAt: number;
  ttlMs: number | null;
  expiresAt: number | null;
  metadata: Record<string, unknown>;
  onEvict?: (record: SessionRecord) => void;
}

export class SessionRegistry {
  private readonly now: () => number;
  private readonly log: (msg: string) => void;
  private readonly records = new Map<string, StoredRecord>();
  /** sessionID → last known generation (bounded FIFO, survives sweeps/unregister). */
  private readonly retiredGenerations = new Map<string, number>();
  private readonly retiredOrder: string[] = [];

  constructor(opts?: SessionRegistryOpts) {
    this.now = opts?.now ?? (() => Date.now());
    this.log = opts?.log ?? (() => {});
  }

  register(input: RegisterInput): SessionRecord {
    const existing = this.records.get(input.sessionID);
    if (existing) {
      const ended = this.expiresAtOf(existing) !== null && this.now() >= this.expiresAtOf(existing)!;
      if (ended) {
        // The old record did end: fire its onEvict (dispose), drop it from the
        // table, then rebuild in place with generation +1. A new lifecycle
        // starts — createdAt resets and metadata is REPLACED (stale owner
        // data must not leak into the new record).
        this.collect(existing, this.materialize(existing, 'ended'));
        existing.generation = existing.generation + 1;
        existing.onEvict = input.onEvict; // fresh — the old callback already fired
        existing.createdAt = this.now();
        existing.metadata = { ...(input.metadata ?? {}) };
        // A new lifecycle starts: no lease to preserve, undefined is permanent
        // (same as a first registration).
        existing.ttlMs = input.ttlMs ?? null;
      } else {
        existing.onEvict = input.onEvict ?? existing.onEvict;
        existing.metadata = { ...existing.metadata, ...(input.metadata ?? {}) };
        // E1-12 three-state patch: an omitted ttlMs is "keep the current
        // lease" (re-register = renewal), NOT "clear the TTL". Only an
        // explicit null (or 0/negative, legacy) makes the record permanent.
        existing.ttlMs = input.ttlMs === undefined ? existing.ttlMs : input.ttlMs;
      }
      existing.scope = input.scope;
      existing.runtimeName = input.runtimeName ?? existing.runtimeName;
      existing.lastActiveAt = this.now();
      existing.expiresAt = this.expiresAtFor(existing.ttlMs);
      this.records.set(input.sessionID, existing); // collect() removed it when ended
      return this.materialize(existing, 'active');
    }

    const generation = (this.retiredGenerations.get(input.sessionID) ?? 0) + 1;
    this.retiredGenerations.delete(input.sessionID);
    const record: StoredRecord = {
      sessionID: input.sessionID,
      scope: input.scope,
      runtimeName: input.runtimeName,
      generation,
      createdAt: this.now(),
      lastActiveAt: this.now(),
      ttlMs: input.ttlMs ?? null,
      expiresAt: this.expiresAtFor(input.ttlMs),
      metadata: input.metadata ? { ...input.metadata } : {},
      onEvict: input.onEvict,
    };
    this.records.set(input.sessionID, record);
    return this.materialize(record, 'active');
  }

  unregister(sessionID: string): boolean {
    const record = this.records.get(sessionID);
    if (!record) return false;
    this.stashRetired(sessionID, record.generation);
    this.records.delete(sessionID);
    return true;
  }

  touch(sessionID: string): boolean {
    const record = this.records.get(sessionID);
    if (!record) return false;
    record.lastActiveAt = this.now();
    if (record.ttlMs !== null) record.expiresAt = this.now() + record.ttlMs;
    return true;
  }

  lookup(sessionID: string): SessionRecord | null {
    const record = this.records.get(sessionID);
    if (!record) return null;
    const expired = record.expiresAt !== null && this.now() >= record.expiresAt;
    return this.materialize(record, expired ? 'ended' : 'active');
  }

  byScope(scope: Partial<SessionScope>): SessionRecord[] {
    const out: SessionRecord[] = [];
    for (const record of this.records.values()) {
      const expired = record.expiresAt !== null && this.now() >= record.expiresAt;
      if (expired) continue; // active only
      if (!this.scopeMatches(record.scope, scope)) continue;
      out.push(this.materialize(record, 'active'));
    }
    return out;
  }

  sweep(): number {
    let swept = 0;
    for (const record of Array.from(this.records.values())) {
      // A mid-sweep onEvict may have unregistered later snapshot entries (the
      // pool's evictPair unregisters sibling worker records). Those were
      // EXPLICITLY unregistered — the "unregister never fires onEvict"
      // invariant must hold for them too, and the count must stay honest.
      if (!this.records.has(record.sessionID)) continue;
      if (record.expiresAt !== null && this.now() >= record.expiresAt) {
        this.collect(record, this.materialize(record, 'ended'));
        swept++;
      }
    }
    return swept;
  }

  updateMetadata(sessionID: string, patch: Record<string, unknown>): boolean {
    const record = this.records.get(sessionID);
    if (!record) return false;
    record.metadata = { ...record.metadata, ...patch };
    return true;
  }

  size(): { active: number; ended: number } {
    let active = 0;
    let ended = 0;
    for (const record of this.records.values()) {
      if (record.expiresAt !== null && this.now() >= record.expiresAt) ended++;
      else active++;
    }
    return { active, ended };
  }

  // ---- internals ----

  private expiresAtFor(ttlMs: number | null | undefined): number | null {
    return ttlMs != null && ttlMs > 0 ? this.now() + ttlMs : null;
  }

  private expiresAtOf(record: StoredRecord): number | null {
    return record.expiresAt;
  }

  private scopeMatches(scope: SessionScope, partial: Partial<SessionScope>): boolean {
    for (const key of Object.keys(partial) as Array<keyof SessionScope>) {
      if (partial[key] !== undefined && scope[key] !== partial[key]) return false;
    }
    return true;
  }

  private materialize(record: StoredRecord, status: SessionStatus): SessionRecord {
    // onEvict is internal — never leak the callback on public copies.
    return {
      sessionID: record.sessionID,
      scope: { ...record.scope },
      status,
      runtimeName: record.runtimeName,
      generation: record.generation,
      createdAt: record.createdAt,
      lastActiveAt: record.lastActiveAt,
      ttlMs: record.ttlMs,
      expiresAt: record.expiresAt,
      metadata: { ...record.metadata },
    };
  }

  private collect(record: StoredRecord, ended: SessionRecord): void {
    this.stashRetired(record.sessionID, record.generation);
    this.records.delete(record.sessionID);
    try {
      record.onEvict?.(ended);
    } catch (err) {
      this.log(`[SessionRegistry] onEvict for ${record.sessionID} threw: ${err instanceof Error ? err.message : err}`);
    }
  }

  private stashRetired(sessionID: string, generation: number): void {
    if (this.retiredGenerations.has(sessionID)) {
      this.retiredGenerations.set(sessionID, generation);
      return; // order already recorded
    }
    this.retiredGenerations.set(sessionID, generation);
    this.retiredOrder.push(sessionID);
    if (this.retiredOrder.length > RETIRED_GENERATIONS_CAP) {
      const oldest = this.retiredOrder.shift()!;
      this.retiredGenerations.delete(oldest);
    }
  }
}
