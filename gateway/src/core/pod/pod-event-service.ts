// gateway/src/core/pod/pod-event-service.ts
// Runtime truth lives in `pod_events`; the per-pod JSON file is a create-once
// audit snapshot so a human can read what happened without opening SQLite.
import * as fs from 'fs';
import * as path from 'path';
import { PodStore, type PodEventRow } from './pod-store';
import type { PodEventSeverity, PodEventReason, PodEventAudience } from './pod-event-model';

export interface PodEventRecordInput {
  podId: string;
  projectId: string;
  goalId?: string | null;
  revision?: number | null;
  kind: string;
  severity: PodEventSeverity;
  reason: PodEventReason;
  title: string;
  summary?: string | null;
  refs?: Array<{ kind: string; id: string }>;
  dedupeKey: string;
  audience: PodEventAudience;
  wakeState?: 'none' | 'pending';
}

export interface PodEventServiceDeps {
  store: PodStore;
  /** Audit root (`~/.mafw`). Omitted in unit tests that do not want files. */
  mafwDir?: string;
  now?(): string;
  log?(message: string): void;
}

/** `2026-11-04T10:00:00.000Z` → filename-safe. */
function fileStamp(iso: string): string {
  return iso.replace(/[:.]/g, '-');
}

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 8);
}

export class PodEventService {
  constructor(private readonly deps: PodEventServiceDeps) {}

  record(input: PodEventRecordInput): PodEventRow {
    const now = this.now();
    const id = `evt_${Date.parse(now) || Date.now()}_${randomSuffix()}`;
    const row = this.deps.store.insertEvent({
      id,
      podId: input.podId,
      projectId: input.projectId,
      goalId: input.goalId ?? null,
      revision: input.revision ?? null,
      kind: input.kind,
      severity: input.severity,
      reason: input.reason,
      title: input.title,
      summary: input.summary ?? null,
      refsJson: input.refs?.length ? JSON.stringify(input.refs) : null,
      dedupeKey: input.dedupeKey,
      audience: input.audience,
      wakeState: input.wakeState ?? (input.audience === 'lead' ? 'pending' : 'none'),
      // Only human-facing events can be "unread": lead/none events have no inbox.
      state: input.audience === 'human' ? 'unread' : 'seen',
      now,
    });
    this.writeAuditFile(row);
    return row;
  }

  list(podId: string, opts?: { state?: 'unread'; limit?: number }): { items: PodEventRow[]; unread: number } {
    return {
      items: this.deps.store.listEvents(podId, opts),
      unread: this.deps.store.countUnreadEvents(podId),
    };
  }

  markSeen(podId: string, id: string): boolean {
    return this.deps.store.markEventSeen(podId, id, this.now());
  }

  markSeenAll(podId: string, goalId: string, revision: number): number {
    return this.deps.store.markEventsSeenForGoal(podId, goalId, revision, this.now());
  }

  pendingWakes(podId?: string): PodEventRow[] {
    return this.deps.store.listPendingWakeEvents(podId);
  }

  markWakeDelivered(id: string, sessionId: string): void {
    this.deps.store.updateEventWake(id, {
      wakeState: 'delivered',
      wakeAt: this.now(),
      wakeSessionId: sessionId,
    });
  }

  markWakeSuppressed(id: string): void {
    this.deps.store.updateEventWake(id, { wakeState: 'suppressed' });
  }

  markWakeAttempt(id: string): void {
    this.deps.store.incrementEventWakeAttempts(id);
  }

  /**
   * Retention: p3 is informational (member notes / decisions), so seen p3 rows
   * older than `p3Days` are dropped; audit JSON files older than `auditDays` are
   * removed. p1/p2 rows are never pruned here — they are the result/blocker trail.
   */
  prune(opts?: { p3Days?: number; auditDays?: number }): { events: number; files: number } {
    const nowMs = Date.parse(this.now());
    if (!Number.isFinite(nowMs)) return { events: 0, files: 0 };
    const p3Days = Math.max(1, opts?.p3Days ?? 7);
    const auditDays = Math.max(1, opts?.auditDays ?? 30);
    const events = this.deps.store.deleteStaleP3EventsBefore(
      new Date(nowMs - p3Days * 86_400_000).toISOString(),
    );
    const files = this.pruneAuditFiles(nowMs - auditDays * 86_400_000);
    return { events, files };
  }

  private pruneAuditFiles(cutoffMs: number): number {
    const root = this.deps.mafwDir;
    if (!root) return 0;
    let removed = 0;
    try {
      const podsDir = path.join(root, 'pods');
      if (!fs.existsSync(podsDir)) return 0;
      for (const podId of fs.readdirSync(podsDir)) {
        const dir = path.join(podsDir, podId, 'events');
        if (!fs.existsSync(dir)) continue;
        for (const name of fs.readdirSync(dir)) {
          if (!name.endsWith('.json')) continue;
          const file = path.join(dir, name);
          try {
            // Use the event's own createdAt (filename stamps are lossy; mtime is
            // "when the file was written", not when the event happened).
            const raw = fs.readFileSync(file, 'utf8');
            const createdAt = Date.parse((JSON.parse(raw) as any)?.createdAt ?? '');
            if (Number.isFinite(createdAt) && createdAt < cutoffMs) {
              fs.unlinkSync(file);
              removed += 1;
            }
          } catch {
            /* one unreadable file must not abort the sweep */
          }
        }
      }
    } catch (err) {
      this.deps.log?.(`pod event audit prune failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    return removed;
  }

  private now(): string {
    return this.deps.now?.() ?? new Date().toISOString();
  }

  private writeAuditFile(row: PodEventRow): void {
    const root = this.deps.mafwDir;
    if (!root) return;
    try {
      const dir = path.join(root, 'pods', row.podId, 'events');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, `${fileStamp(row.createdAt)}-${row.id}.json`),
        JSON.stringify(row, null, 2),
        'utf8',
      );
    } catch (err) {
      // The DB already holds the event; a broken audit path must not lose it.
      this.deps.log?.(`pod event audit write failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
