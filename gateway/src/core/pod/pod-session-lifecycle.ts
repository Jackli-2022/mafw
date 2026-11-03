import {
  isTerminalGoalRevisionStatus,
  type PodSessionScopeKey,
  type PodSessionRow,
  type PodStore,
} from './pod-store';
import type { PodSessionSupervisor } from './pod-session-supervisor';

export interface PodSessionLifecycleDeps {
  store: PodStore;
  supervisor: Pick<PodSessionSupervisor, 'retire'>;
  snapshotSession(sessionId: string): Promise<unknown>;
  log?(message: string): void;
}

/**
 * Revision-scoped Pod session retirement.
 *
 * Retirement means the active lease ends; runtime sessions and artifacts are
 * not physically deleted in this lifecycle. Snapshot is best-effort, then the
 * supervisor ends the lease even when transcript capture fails.
 */
export class PodSessionLifecycle {
  constructor(private readonly deps: PodSessionLifecycleDeps) {}

  async retireRevision(goalId: string, revision: number): Promise<boolean> {
    const goal = this.deps.store.getGoalByGoalId(goalId);
    if (!goal) return false;
    const member = this.deps.store.getMemberByRole(goal.podId, 'tech_lead');
    if (!member) return false;
    const scope: PodSessionScopeKey = {
      podId: goal.podId,
      memberId: member.id,
      goalId,
      revision,
      kind: 'discussion',
    };
    const active = this.deps.store.getActiveScopedSession(scope);
    if (!active) return false;
    await this.retireLease(scope, active);
    return true;
  }

  /**
   * Startup/recovery calibration for leases left active by older builds.
   * Only the current non-terminal revision keeps its discussion lease.
   */
  async retireStaleDiscussionLeases(): Promise<number> {
    let retired = 0;
    for (const row of this.deps.store.listActiveScopedSessions()) {
      if (row.scopeKind !== 'discussion' || !row.goalId || row.revision === null) continue;
      if (!this.isStale(row)) continue;
      await this.retireLease({
        podId: row.podId,
        memberId: row.memberId,
        goalId: row.goalId,
        revision: row.revision,
        kind: 'discussion',
      }, row);
      retired++;
    }
    return retired;
  }

  private isStale(row: PodSessionRow): boolean {
    const goal = this.deps.store.getGoalByGoalId(row.goalId!);
    if (!goal) return true;
    if (row.revision !== goal.activeRevision) return true;
    const revision = this.deps.store.getGoalRevision(row.podId, row.goalId!, row.revision!);
    if (!revision) return true;
    return isTerminalGoalRevisionStatus(revision.status);
  }

  private async retireLease(scope: PodSessionScopeKey, row: PodSessionRow): Promise<void> {
    try {
      await this.deps.snapshotSession(row.sessionId);
    } catch (err: any) {
      this.deps.log?.(`[Pod] revision snapshot failed for ${row.sessionId} (non-fatal): ${err?.message ?? err}`);
    }
    this.deps.supervisor.retire(scope);
  }
}
