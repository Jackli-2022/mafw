import {
  clearManagerSlot,
  readManagerSlot,
  writeManagerSlot,
} from './manager-session-runtime';
import {
  resolveLeadCandidate,
  type LeadCandidate,
} from './lead-session-resolution';
import { canonicalProjectDir } from '../pod/pod-identity';

export interface LeadSessionRecord {
  sessionId: string;
  createdAt: string | null;
  source: 'slot' | 'pod' | 'created';
}

export interface LeadSessionRegistryDeps {
  kvGet(scope: string, key: string): unknown;
  kvSet(scope: string, key: string, value: unknown): void;
  kvAll<T = unknown>(scope: string): Array<{ key: string; value: T }>;
  runtimeName: string;
  podByProject(projectDir: string): { podId: string; projectDir: string } | null;
  activePodCoordination(podId: string): { sessionId: string } | null;
  createSession(projectDir: string): Promise<string>;
  isAlive(sessionId: string): Promise<boolean>;
  registerLead(sessionId: string, projectDir: string): Promise<void>;
  archiveLead(sessionId: string, projectDir: string): Promise<void>;
  bindPodLead(podId: string, sessionId: string): Promise<void>;
  now(): string;
  log?(message: string): void;
}

export class LeadSessionConflictError extends Error {
  constructor(message = 'ambiguous manager-session keys for project') {
    super(message);
    this.name = 'LeadSessionConflictError';
  }
}

interface SlotRow {
  key: string;
  sessionId: string;
  createdAt: string | null;
}

/**
 * Single lifecycle owner for the project-level Lead identity.
 *
 * kv remains the persisted active-runtime slot; Pod coordination is the
 * recovery source when kv is missing or dead. Historical manager rows and
 * other runtimes' slots are never candidates. Reads stay read-only; ensure is
 * the only method that can create/replace a runtime session.
 */
export class LeadSessionRegistry {
  private readonly ensureInflight = new Map<string, Promise<LeadSessionRecord>>();

  constructor(private readonly deps: LeadSessionRegistryDeps) {}

  current(projectDir: string): LeadSessionRecord | null {
    const canonical = canonicalProjectDir(projectDir);
    const rows = this.slotRows(canonical);
    const exact = rows.find((row) => row.key === canonical);
    if (exact) {
      return { sessionId: exact.sessionId, createdAt: exact.createdAt, source: 'slot' };
    }
    const distinct = uniqueBySession(rows);
    if (distinct.length === 0) return null;
    // Read-only callers cannot probe liveness. For legacy raw-key variants,
    // choose the newest slot deterministically; ensure() later repairs it with
    // authoritative liveness/Pod evidence.
    const newest = [...distinct].sort(
      (a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''),
    )[0];
    return {
      sessionId: newest.sessionId,
      createdAt: newest.createdAt,
      source: 'slot',
    };
  }

  findBySessionId(sessionID: string): { projectDir: string; sessionId: string } | null {
    for (const row of this.deps.kvAll('manager-session')) {
      const slot = readManagerSlot(row.value, this.deps.runtimeName);
      if (slot?.sessionId !== sessionID) continue;
      return { projectDir: canonicalProjectDir(row.key), sessionId: slot.sessionId };
    }
    return null;
  }

  async ensure(projectDir: string): Promise<LeadSessionRecord> {
    const canonical = canonicalProjectDir(projectDir);
    const pending = this.ensureInflight.get(canonical);
    if (pending) return pending;
    const promise = this.ensureCanonical(canonical).finally(() => {
      if (this.ensureInflight.get(canonical) === promise) this.ensureInflight.delete(canonical);
    });
    this.ensureInflight.set(canonical, promise);
    return promise;
  }

  private async ensureCanonical(canonical: string): Promise<LeadSessionRecord> {
    const rows = this.slotRows(canonical);
    const exact = rows.find((row) => row.key === canonical);
    const probed = await Promise.all(rows.map(async (row) => ({
      ...row,
      alive: await this.isAlive(row.sessionId),
    })));
    const exactLive = probed.find((row) => row.key === canonical && row.alive) ?? null;
    const legacyLive = probed.filter((row) => row.key !== canonical && row.alive);
    const slotConflict = !exactLive && legacyLive.length > 1;
    const slotCandidate: LeadCandidate | null = exactLive
      ? { sessionId: exactLive.sessionId, source: 'slot' }
      : (legacyLive.length === 1
        ? { sessionId: legacyLive[0].sessionId, source: 'slot' }
        : null);

    const pod = this.deps.podByProject(canonical);
    const coordination = pod ? this.deps.activePodCoordination(pod.podId) : null;
    const podAlive = coordination ? await this.isAlive(coordination.sessionId) : false;
    const podCandidate: LeadCandidate | null = pod && coordination && podAlive
      ? { sessionId: coordination.sessionId, source: 'pod' }
      : null;

    const resolution = resolveLeadCandidate({
      slot: slotCandidate,
      pod: podCandidate,
      slotKeyConflict: slotConflict,
    });
    if (resolution.action === 'conflict') {
      this.deps.log?.(`[Lead] ambiguous manager-session keys for ${canonical}; refusing to create`);
      throw new LeadSessionConflictError(`ambiguous manager-session keys for ${canonical}`);
    }

    const deadRows = probed.filter((row) => !row.alive);
    const chosenId = resolution.action === 'reuse' ? resolution.sessionId : null;

    if (resolution.action === 'reuse') {
      await this.archiveDeadRows(deadRows, chosenId, canonical);
      this.writeCanonical(canonical, resolution.sessionId);
      await this.deps.registerLead(resolution.sessionId, canonical);
      if (pod) await this.deps.bindPodLead(pod.podId, resolution.sessionId);
      return {
        sessionId: resolution.sessionId,
        createdAt: this.createdAtFor(canonical, resolution.sessionId),
        source: resolution.source,
      };
    }

    await this.archiveDeadRows(deadRows, null, canonical);
    const sessionId = await this.deps.createSession(canonical);
    this.writeCanonical(canonical, sessionId);
    await this.deps.registerLead(sessionId, canonical);
    if (pod) await this.deps.bindPodLead(pod.podId, sessionId);
    return {
      sessionId,
      createdAt: this.createdAtFor(canonical, sessionId),
      source: 'created',
    };
  }

  private slotRows(canonical: string): SlotRow[] {
    const rows: SlotRow[] = [];
    for (const entry of this.deps.kvAll('manager-session')) {
      if (canonicalProjectDir(entry.key) !== canonical) continue;
      const slot = readManagerSlot(entry.value, this.deps.runtimeName);
      if (!slot?.sessionId) continue;
      rows.push({
        key: entry.key,
        sessionId: slot.sessionId,
        createdAt: slot.createdAt ?? null,
      });
    }
    return rows;
  }

  private createdAtFor(canonical: string, sessionId: string): string | null {
    return this.slotRows(canonical).find((row) => row.sessionId === sessionId)?.createdAt ?? null;
  }

  private writeCanonical(canonical: string, sessionId: string): void {
    const existing = this.deps.kvGet('manager-session', canonical);
    const slot = readManagerSlot(existing, this.deps.runtimeName);
    if (slot?.sessionId === sessionId) return;
    this.deps.kvSet('manager-session', canonical, writeManagerSlot(
      existing,
      this.deps.runtimeName,
      { sessionId, createdAt: slot?.createdAt ?? this.deps.now() },
    ));
  }

  private async archiveDeadRows(
    rows: Array<SlotRow & { alive: boolean }>,
    chosenId: string | null,
    canonical: string,
  ): Promise<void> {
    const seen = new Set<string>();
    for (const row of rows) {
      if (row.sessionId === chosenId || seen.has(row.sessionId)) continue;
      seen.add(row.sessionId);
      try {
        await this.deps.archiveLead(row.sessionId, canonical);
        const existing = this.deps.kvGet('manager-session', row.key);
        this.deps.kvSet(
          'manager-session',
          row.key,
          clearManagerSlot(existing, this.deps.runtimeName),
        );
      } catch (err: any) {
        this.deps.log?.(`[Lead] archive failed for ${row.sessionId} (non-fatal): ${err?.message ?? err}`);
      }
    }
  }

  private async isAlive(sessionId: string): Promise<boolean> {
    try {
      return await this.deps.isAlive(sessionId);
    } catch (err: any) {
      this.deps.log?.(`[Lead] liveness probe failed for ${sessionId} (treated alive): ${err?.message ?? err}`);
      return true;
    }
  }
}

function uniqueBySession(rows: SlotRow[]): SlotRow[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    if (seen.has(row.sessionId)) return false;
    seen.add(row.sessionId);
    return true;
  });
}
