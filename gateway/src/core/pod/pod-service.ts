import * as fs from 'fs';
import * as path from 'path';
import {
  PodError,
  PodStore,
  type PodGoalRow,
  type PodMemberRow,
  type PodMemberRole,
  type PodRow,
  type PodSessionRow,
  type PodStatus,
  type PodTaskRow,
} from './pod-store';
import {
  canonicalProjectDir,
  parentProjectDirForWorktree,
  podIdForProject,
  roleForNode,
  type PodNode,
} from './pod-identity';

export interface PodDetail {
  pod: PodRow;
  members: PodMemberRow[];
  goals: PodGoalRow[];
  tasks: PodTaskRow[];
  sessions: PodSessionRow[];
}

export interface PodServiceDeps {
  store: PodStore;
  now(): string;
  newId(): string;
  broadcast(event: { type: string; properties?: Record<string, unknown>; sessionID?: string }): void;
  getManagerSession(projectDir: string): Promise<string>;
  getSession(sessionID: string): Promise<{ time?: { idle?: number; completed?: number }; parentID?: string }>;
  messages(sessionID: string, limit: number): Promise<unknown[]>;
  /** Best-effort archive after a replaced/ended Lead coordination row. */
  archiveLeadSession?(sessionId: string): Promise<void> | void;
  memoryRoot: string;
  listRegisteredProjectDirs(): string[];
  ensureMemory?(podId: string, projectName: string): void;
  log?(message: string): void;
}

const MEMBER_SPECS: Array<{ role: PodMemberRole; displayName: string; agentName: string }> = [
  { role: 'lead', displayName: 'Lead', agentName: 'lead' },
  { role: 'tech_lead', displayName: 'Tech Lead', agentName: 'mafw-tech-lead' },
  { role: 'builder', displayName: 'Builder', agentName: 'mafw-execute' },
  { role: 'reviewer', displayName: 'Reviewer', agentName: 'mafw-review' },
];

export class PodService {
  constructor(private readonly deps: PodServiceDeps) {}

  async ensure(projectDir: string): Promise<PodDetail> {
    const resolved = this.resolveProjectDir(projectDir);
    const podId = podIdForProject(resolved);
    const pod = this.deps.store.ensurePod({
      id: podId,
      projectDir: resolved,
      name: path.basename(resolved) || 'project',
      now: this.deps.now(),
    });
    this.ensureMembers(pod.id);

    try {
      const managerSession = await this.deps.getManagerSession(resolved);
      await this.bindLead(pod.id, managerSession);
    } catch (err: any) {
      this.deps.log?.(`[Pod] lead binding failed for ${pod.id} (non-fatal): ${err?.message ?? err}`);
    }

    try {
      this.deps.ensureMemory?.(pod.id, pod.name);
    } catch (err: any) {
      this.deps.log?.(`[Pod] memory init failed for ${pod.id} (non-fatal): ${err?.message ?? err}`);
    }
    return this.get(pod.id)!;
  }

  get(podId: string): PodDetail | null {
    const pod = this.deps.store.getPod(podId);
    if (!pod) return null;
    return {
      pod,
      members: this.deps.store.listMembers(pod.id),
      goals: this.deps.store.listGoals(pod.id),
      tasks: this.deps.store.listTasks(pod.id),
      sessions: this.deps.store.listSessions(pod.id),
    };
  }

  lookup(projectDir: string): PodDetail | null {
    let resolved: string;
    try {
      resolved = this.resolveProjectDir(projectDir);
    } catch {
      return null;
    }
    const pod = this.deps.store.getPodByProject(resolved);
    return pod ? this.get(pod.id) : null;
  }

  getPodIdForGoal(goalId: string): string | null {
    return this.deps.store.findPodIdByGoal(goalId);
  }

  updateStatus(podId: string, status: PodStatus): PodDetail {
    const pod = this.deps.store.getPod(podId);
    if (!pod) throw new PodError(404, `pod not found: ${podId}`);
    this.deps.store.updatePod(podId, { status }, this.deps.now());
    this.emit(podId, 'pod');
    return this.get(podId)!;
  }

  async bindLead(podId: string, managerSessionId: string): Promise<void> {
    const pod = this.deps.store.getPod(podId);
    if (!pod) throw new PodError(404, `pod not found: ${podId}`);
    const lead = this.deps.store.getMemberByRole(podId, 'lead');
    if (!lead) throw new PodError(404, `pod lead not found: ${podId}`);
    const allCoordination = this.deps.store.listSessions(podId).filter(
      (session) => session.memberId === lead.id && session.node === 'coordination',
    );
    const coordination = allCoordination.filter((session) => !session.endedAt);
    if (coordination.some((session) => session.sessionId === managerSessionId)) return;
    for (const session of coordination) {
      try {
        await this.snapshotSession(session.sessionId);
      } catch (err: any) {
        this.deps.log?.(`[Pod] replaced Lead snapshot failed for ${session.sessionId} (non-fatal): ${err?.message ?? err}`);
        this.deps.store.endSession(session.sessionId, this.deps.now());
      }
      try {
        await this.deps.archiveLeadSession?.(session.sessionId);
      } catch (err: any) {
        this.deps.log?.(`[Pod] replaced Lead archive failed for ${session.sessionId} (non-fatal): ${err?.message ?? err}`);
      }
    }

    const endedSame = allCoordination.find(
      (session) => session.sessionId === managerSessionId && !!session.endedAt,
    );
    if (endedSame) {
      this.deps.store.reactivateSession(managerSessionId, this.deps.now());
    } else {
      this.deps.store.insertSession({
        id: this.deps.newId(),
        podId,
        memberId: lead.id,
        goalId: null,
        node: 'coordination',
        sessionId: managerSessionId,
        status: 'active',
        transcriptRef: null,
        now: this.deps.now(),
      });
    }
    this.deps.store.upsertMember({
      ...lead,
      status: 'available',
      now: this.deps.now(),
    });
    this.emit(podId, 'member');
  }

  async ensureLead(podId: string): Promise<{ podId: string; projectDir: string; sessionId: string }> {
    const pod = this.deps.store.getPod(podId);
    if (!pod) throw new PodError(404, `pod not found: ${podId}`);
    this.ensureMembers(pod.id);
    const sessionId = await this.deps.getManagerSession(pod.projectDir);
    await this.bindLead(pod.id, sessionId);
    return { podId: pod.id, projectDir: pod.projectDir, sessionId };
  }

  bindSession(goalId: string, node: PodNode, sessionId: string): PodSessionRow | null {
    const podId = this.deps.store.findPodIdByGoal(goalId);
    if (!podId) return null;
    const member = this.deps.store.getMemberByRole(podId, roleForNode(node));
    if (!member) return null;

    const session = this.deps.store.insertSession({
      id: this.deps.newId(),
      podId,
      memberId: member.id,
      goalId,
      node,
      sessionId,
      status: 'active',
      transcriptRef: null,
      now: this.deps.now(),
    });
    this.deps.store.upsertMember({ ...member, status: 'working', now: this.deps.now() });
    this.emit(podId, 'member');
    return session;
  }

  async snapshotSession(sessionId: string): Promise<string | null> {
    const session = this.deps.store.getSessionBySessionId(sessionId);
    if (!session) return null;
    if (session.endedAt) return session.transcriptRef;

    let messages: unknown[] = [];
    try {
      messages = await this.deps.messages(sessionId, 200);
    } catch (err: any) {
      this.deps.log?.(`[Pod] snapshot messages failed for ${sessionId}: ${err?.message ?? err}`);
      throw new PodError(502, `transcript unavailable for session ${sessionId}`);
    }
    const safeSessionId = sessionId.replace(/[^A-Za-z0-9._-]/g, '_');
    const transcriptPath = path.join(this.deps.memoryRoot, session.podId, 'sessions', `${safeSessionId}.json`);
    fs.mkdirSync(path.dirname(transcriptPath), { recursive: true });
    fs.writeFileSync(transcriptPath, JSON.stringify({ sessionID: sessionId, messages }, null, 2), 'utf-8');
    this.deps.store.insertSnapshot({
      id: this.deps.newId(),
      podId: session.podId,
      memberId: session.memberId,
      goalId: session.goalId,
      node: session.node,
      sessionId,
      path: transcriptPath,
      now: this.deps.now(),
    });
    this.deps.store.setSessionTranscriptRef(sessionId, transcriptPath, this.deps.now());
    this.deps.store.endSession(sessionId, this.deps.now());
    const member = this.deps.store.getMemberByRole(session.podId, this.roleOfMember(session.memberId));
    if (member) this.deps.store.upsertMember({ ...member, status: 'available', now: this.deps.now() });
    this.emit(session.podId, 'member');
    return transcriptPath;
  }

  finalizeMissingSession(sessionId: string): string | null {
    const session = this.deps.store.getSessionBySessionId(sessionId);
    if (!session) return null;
    if (session.endedAt) return session.transcriptRef;
    const safeSessionId = sessionId.replace(/[^A-Za-z0-9._-]/g, '_');
    const transcriptPath = path.join(this.deps.memoryRoot, session.podId, 'sessions', `${safeSessionId}.json`);
    fs.mkdirSync(path.dirname(transcriptPath), { recursive: true });
    fs.writeFileSync(
      transcriptPath,
      JSON.stringify({ sessionID: sessionId, messages: [], unavailable: true }, null, 2),
      'utf-8',
    );
    this.deps.store.insertSnapshot({
      id: this.deps.newId(),
      podId: session.podId,
      memberId: session.memberId,
      goalId: session.goalId,
      node: session.node,
      sessionId,
      path: transcriptPath,
      now: this.deps.now(),
    });
    this.deps.store.setSessionTranscriptRef(sessionId, transcriptPath, this.deps.now());
    this.deps.store.endSession(sessionId, this.deps.now());
    const member = this.deps.store.getMemberByRole(session.podId, this.roleOfMember(session.memberId));
    if (member) this.deps.store.upsertMember({ ...member, status: 'available', now: this.deps.now() });
    this.emit(session.podId, 'member');
    return transcriptPath;
  }

  async reconcile(): Promise<void> {
    for (const pod of this.deps.store.listPods()) {
      for (const session of this.deps.store.listActiveSessions(pod.id)) {
        if (session.node === 'coordination') continue;
        // Session Supervisor 租约（scope_kind 非空）只豁免「回合 idle」这一种收尾：
        // idle 只表示本轮结束，快照/结束会让存活复用失效并每轮抬 generation。
        // 真正的 runtime 会话消失（null / not found）仍必须最终化，否则作用域行会
        // 永远 active、transcript 缺失、成员卡在 working（review I-2）。
        const isScoped = !!session.scopeKind;
        try {
          const info = await this.deps.getSession(session.sessionId);
          if (!info) {
            try {
              await this.snapshotSession(session.sessionId);
            } catch {
              this.finalizeMissingSession(session.sessionId);
            }
            continue;
          }
          if (!isScoped && (info.time?.idle || info.time?.completed)) {
            try {
              await this.snapshotSession(session.sessionId);
            } catch (err: any) {
              this.deps.log?.(`[Pod] transcript snapshot deferred for ${session.sessionId}: ${err?.message ?? err}`);
            }
          }
        } catch (err: any) {
          const message = String(err?.message ?? err);
          this.deps.log?.(`[Pod] reconcile session ${session.sessionId}: ${message}`);
          if (!/not found|404|gone|missing|deleted|no such/i.test(message)) {
            continue;
          }
          try {
            await this.snapshotSession(session.sessionId);
          } catch (snapshotErr: any) {
            this.deps.log?.(`[Pod] finalize missing session ${session.sessionId}: ${snapshotErr?.message ?? snapshotErr}`);
            this.finalizeMissingSession(session.sessionId);
          }
        }
      }
      this.reconcileMemberStatus(pod.id);
    }
  }

  /** 成员 readiness 修复：没有活跃 session 却仍标 working 的成员回落 available。
   *  （bindSession 置 working，snapshot/finalize 置 available；节点会话被 runtime
   *   直接删除时这两步可能都不触发，这里兜底。sleeping/retired 是人工状态，不动。） */
  reconcileMemberStatus(podId: string): number {
    const active = new Set(
      this.deps.store.listActiveSessions(podId).map((session) => session.memberId),
    );
    let repaired = 0;
    for (const member of this.deps.store.listMembers(podId)) {
      if (member.status !== 'working') continue;
      if (active.has(member.id)) continue;
      this.deps.store.upsertMember({ ...member, status: 'available', now: this.deps.now() });
      repaired++;
    }
    if (repaired > 0) this.emit(podId, 'member');
    return repaired;
  }

  memberForSession(sessionId: string): PodMemberRow | null {
    return this.deps.store.getMemberBySession(sessionId);
  }

  private resolveProjectDir(projectDir: string): string {
    const canonical = canonicalProjectDir(projectDir);
    const registered = this.deps.listRegisteredProjectDirs().map(canonicalProjectDir);
    if (registered.includes(canonical)) return canonical;
    const parent = parentProjectDirForWorktree(canonical);
    if (parent) {
      const canonicalParent = canonicalProjectDir(parent);
      if (registered.includes(canonicalParent)) return canonicalParent;
    }
    throw new PodError(404, `project is not registered: ${canonical}`);
  }

  private ensureMembers(podId: string): void {
    for (const spec of MEMBER_SPECS) {
      const existing = this.deps.store.getMemberByRole(podId, spec.role);
      if (existing) {
        // Legacy Pods stored the Lead identity under the deprecated manager
        // agent name. Keep the member id/bindings, normalize only the name.
        if (spec.role === 'lead' && existing.agentName === 'manager') {
          this.deps.store.upsertMember({ ...existing, agentName: 'lead', now: this.deps.now() });
        }
        continue;
      }
      this.deps.store.upsertMember({
        id: this.deps.newId(),
        podId,
        role: spec.role,
        displayName: spec.displayName,
        agentName: spec.agentName,
        modelProvider: null,
        modelId: null,
        status: 'available',
        configJson: null,
        now: this.deps.now(),
      });
    }
  }

  private roleOfMember(memberId: string): PodMemberRole {
    for (const pod of this.deps.store.listPods()) {
      const member = this.deps.store.listMembers(pod.id).find((m) => m.id === memberId);
      if (member) return member.role;
    }
    return 'builder';
  }

  private emit(podId: string, kind: string): void {
    this.deps.broadcast({ type: 'pod.updated', properties: { podId, kind } });
  }
}
