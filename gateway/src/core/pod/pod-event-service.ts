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
