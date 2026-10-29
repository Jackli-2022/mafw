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
  memoryRoot: string;
  listRegisteredProjectDirs(): string[];
  ensureMemory?(podId: string, projectName: string): void;
  log?(message: string): void;
}

const MEMBER_SPECS: Array<{ role: PodMemberRole; displayName: string; agentName: string }> = [
  { role: 'lead', displayName: 'Lead', agentName: 'manager' },
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

    const lead = this.deps.store.getMemberByRole(pod.id, 'lead');
    const hasLeadSession = lead
      ? this.deps.store.listSessions(pod.id).some(
        (session) => session.memberId === lead.id && session.node === 'coordination' && !session.endedAt,
      )
      : false;
    if (!hasLeadSession) {
      const managerSession = await this.deps.getManagerSession(resolved);
      await this.bindLead(pod.id, managerSession);
    }

    this.deps.ensureMemory?.(pod.id, pod.name);
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
    const existing = this.deps.store.listSessions(podId).find(
      (session) => session.memberId === lead.id && session.sessionId === managerSessionId && !session.endedAt,
    );
    if (existing) return;

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
    this.deps.store.upsertMember({
      ...lead,
      status: 'available',
      now: this.deps.now(),
    });
  }

  bindSession(goalId: string, node: 'plan' | 'execute' | 'review', sessionId: string): PodSessionRow | null {
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

  async reconcile(): Promise<void> {
    for (const pod of this.deps.store.listPods()) {
      for (const session of this.deps.store.listActiveSessions(pod.id)) {
        if (session.node === 'coordination') continue;
        try {
          const info = await this.deps.getSession(session.sessionId);
          if (info?.time?.idle || info?.time?.completed) {
            await this.snapshotSession(session.sessionId);
          }
        } catch (err: any) {
          this.deps.log?.(`[Pod] reconcile session ${session.sessionId}: ${err?.message ?? err}`);
          await this.snapshotSession(session.sessionId).catch(() => {});
        }
      }
    }
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
      if (this.deps.store.getMemberByRole(podId, spec.role)) continue;
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
