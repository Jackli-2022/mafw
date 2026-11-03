// gateway/src/core/pod/pod-tech-lead-service.ts
// 直接创建协作 Goal：Goal + revision 1 进入 discussing，隐藏 Tech Lead 会话
// 通过 Scoped Session supervisor 复用/重建，第一条 prompt 必带 ContextManifest。
//
// 不变量：
// - 讨论中的 Goal **绝不**自动启动 NodeDriver（intake 不发 goal_created）；
// - Tech Lead 会话是隐藏内部会话（registerInternalSession），按 Goal revision 作用域复用；
// - 只有绑定在当前 revision 的 Tech Lead 会话能写方向决定（assertTechLeadSession）。
import {
  GoalConflictError,
  createGoalIntake,
  makePodGoalId,
  type GoalAuthorization,
  type GoalIntakeInput,
  type GoalIntakeResult,
  type GoalSourceRef,
} from '../goal/goal-intake';
import * as fs from 'fs';
import {
  buildContextManifest,
  renderContextManifest,
} from '../goal/context-manifest';
import {
  PodError,
  isTerminalGoalRevisionStatus,
  type PodGoalRevisionRow,
  type PodGoalRow,
  type PodMemberRow,
  type PodStore,
} from './pod-store';
import type { PodDetail, PodService } from './pod-service';
import { canonicalProjectDir } from './pod-identity';
import type { PodSessionLease, PodSessionScope, PodSessionSupervisor } from './pod-session-supervisor';

/** Tech Lead 身份（IdentityRegistry 内置物化名）。 */
export const TECH_LEAD_AGENT = 'mafw-tech-lead';

/** 隐藏会话登记角色（session-visibility 的 role 词汇）。 */
export const TECH_LEAD_INTERNAL_ROLE = 'tech_lead';

export interface PodTechLeadRuntime {
  /** 创建一个新的 runtime 会话（仅 supervisor 在无存活租约时调用）。 */
  createSession(input: { projectDir: string; goalId: string; revision: number }): Promise<string>;
  /** 发一条消息；调用方负责在正文前拼 ContextManifest。 */
  promptAsync(opts: {
    sessionID: string;
    agent?: string;
    parts: Array<{ type: string; text: string }>;
  }): Promise<unknown>;
  messages(opts: { sessionID: string; limit?: number }): Promise<{ data: unknown[]; nextCursor?: string }>;
}

export interface PodTechLeadServiceDeps {
  store: PodStore;
  pods: Pick<PodService, 'ensure'>;
  sessions: Pick<PodSessionSupervisor, 'ensure' | 'current'>;
  runtime: PodTechLeadRuntime;
  /** 项目解析（与 intake 同一来源）：返回 canonical projectDir 与 mafwDir。 */
  resolveProject(projectDir?: string): { projectDir: string; mafwDir: string } | null;
  now?(): string;
  newId?(): string;
  newGoalId?(): string;
  /** 隐藏会话登记（gateway 组合根注入 registerInternalSession）。 */
  registerInternalSession?(sessionId: string, role: string, identity?: string): void;
  /** 仅在 legacy/非讨论路径使用；讨论 Goal 永不发 goal_created。 */
  emitGoalCreated?(event: unknown): void;
  notify?(podId: string, kind?: string): void;
  log?(message: string): void;
}

export interface PodTechLeadGoalInput {
  /** 可选：调用方已知的 Pod id；与项目解析结果不一致时 400（不静默换 Pod）。 */
  podId?: string;
  projectDir?: string;
  goalId?: string;
  title: string;
  objective?: string;
  charter?: string;
  acceptance?: string[];
  boundaries?: string[];
  metrics?: Record<string, { target?: number; unit?: string }>;
  priority?: GoalIntakeInput['priority'];
  maxLoops?: number;
  budget?: { maxTurns?: number; maxCostUsd?: number };
  taskType?: GoalIntakeInput['taskType'];
  planReview?: GoalIntakeInput['planReview'];
  source?: string;
  sourceRef?: GoalSourceRef;
  authorization?: GoalAuthorization;
  /** 调用者会话；提供时必须已绑定为 Lead。 */
  createdBy?: string;
}

/** 创建结果：stage 固定 discussing；sessionID 为 null 表示会话建立失败（可 retry ensureSession）。 */
export interface PodTechLeadGoalCreated {
  podId: string;
  goalId: string;
  revision: number;
  stage: 'discussing';
  status: PodGoalRevisionRow['status'];
  sessionID: string | null;
  projectDir: string;
  goalDir: string | null;
  charterPath: string;
  requestPath: string;
  sessionError?: string;
  promptError?: string;
}

export interface PodTechLeadPromptResult {
  goalId: string;
  revision: number;
  sessionID: string;
  /** 实际发送的正文（ContextManifest + 用户/开场文本）。 */
  text: string;
}

export interface PodTechLeadHistory {
  goalId: string;
  revision: number;
  sessionID: string | null;
  messages: unknown[];
  nextCursor?: string;
}

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export class PodTechLeadService {
  constructor(private readonly deps: PodTechLeadServiceDeps) {}

  /**
   * 直接创建讨论中的 Goal：
   * 1. 解析/确保四角色 Pod（Tech Lead 成员由 PodService 物化）；
   * 2. 以 goal-dir 布局写入 goal.md/request.json（discussion，不发 goal_created）；
   * 3. 建 root row + revision 1 discussing；
   * 4. supervisor 取讨论会话、登记隐藏、绑定 Goal revision；
   * 5. 发送带 ContextManifest 的开场 prompt。
   */
  async createGoal(input: PodTechLeadGoalInput): Promise<PodTechLeadGoalCreated> {
    const title = clean(input.title);
    const objective = clean(input.objective);
    const charter = clean(input.charter);
    if (!title) throw new PodError(400, 'title is required');
    if (!objective && !charter) throw new PodError(400, 'objective or charter is required');
    if (input.createdBy && !this.isLeadSession(input.createdBy)) {
      throw new PodError(403, 'only the project Lead can create a Pod goal');
    }

    const resolved = this.deps.resolveProject(input.projectDir);
    if (!resolved) {
      throw new PodError(400, `project is not registered: ${input.projectDir ?? '(current)'}`);
    }

    const detail = await this.deps.pods.ensure(resolved.projectDir);
    if (input.podId && input.podId !== detail.pod.id) {
      throw new PodError(
        400,
        `pod ${input.podId} does not belong to project ${detail.pod.projectDir}`,
      );
    }
    if (input.createdBy) {
      const caller = this.deps.store.getMemberBySession(input.createdBy);
      if (!caller || caller.role !== 'lead' || caller.podId !== detail.pod.id) {
        throw new PodError(403, 'only the project Lead can create a Pod goal');
      }
    }
    const projectDir = detail.pod.projectDir || resolved.projectDir;
    const techLead = this.techLeadMember(detail);
    const now = this.now();
    const goalId = clean(input.goalId)
      || this.deps.newGoalId?.()
      || makePodGoalId(now, Math.random);
    // Reusing an identifier of an already-advanced Goal would mint discussion files
    // under a revision that is no longer discussing: reject before any file write.
    const existingGoal = this.deps.store.getGoal(detail.pod.id, goalId);
    if (existingGoal && existingGoal.activeRevision !== 1) {
      throw new PodError(
        409,
        `goal ${goalId} is already at revision ${existingGoal.activeRevision}; cannot create a discussion revision`,
      );
    }
    const existingRevision = this.deps.store.getGoalRevision(detail.pod.id, goalId, 1);
    if (existingRevision && existingRevision.status !== 'discussing') {
      throw new PodError(
        409,
        `goal ${goalId} already exists in revision 1 (${existingRevision.status})`,
      );
    }

    let intake: GoalIntakeResult;
    try {
      intake = createGoalIntake({
        goalId,
        title,
        objective: objective || undefined,
        charter: charter || undefined,
        acceptance: input.acceptance,
        boundaries: input.boundaries,
        metrics: input.metrics,
        priority: input.priority,
        maxLoops: input.maxLoops,
        budget: input.budget,
        taskType: input.taskType,
        planReview: input.planReview,
        projectDir,
        source: input.source || 'lead',
        sourceRef: input.sourceRef,
        authorization: input.authorization
          ?? { source: 'lead', requestMode: 'explicit', scope: projectDir },
        // Discussion goals must never reach the goal_created listener.
        autoStart: false,
        discussion: true,
        layout: 'goal-dir',
      }, {
        resolveProject: () => ({ projectDir, mafwDir: resolved.mafwDir }),
        now: () => now,
        emitGoalCreated: (event) => this.deps.emitGoalCreated?.(event),
      });
    } catch (err) {
      if (err instanceof GoalConflictError) throw new PodError(409, err.message);
      throw err;
    }

    const goalRow = this.deps.store.enqueueGoal({
      id: this.deps.newId?.() ?? `podgoal_${goalId}`,
      podId: detail.pod.id,
      goalId,
      now,
    });
    let revision: number;
    try {
      revision = this.ensureDiscussionRevision(detail.pod.id, goalId, now);
      // A discussing goal is the Pod's current goal but has no NodeDriver run. Marking it
      // active (instead of queued) is what keeps Pod scheduling from promoting it into
      // execute/plan before the direction tool explicitly starts planning.
      if (detail.pod.status !== 'paused' && detail.pod.status !== 'archived') {
        this.deps.store.setGoalStatus(goalRow.id, 'active', { startedAt: now });
        this.deps.store.updatePod(detail.pod.id, {
          status: 'active',
          activeGoalId: goalId,
        }, now);
      }
    } catch (err) {
      // Do not leave discussion files for a Goal that never became a revision.
      if (intake.goalDir) {
        try { fs.rmSync(intake.goalDir, { recursive: true, force: true }); } catch { /* best effort */ }
      }
      throw err;
    }
    this.deps.notify?.(detail.pod.id, 'goal');

    let sessionID: string | null = null;
    let sessionError: string | undefined;
    try {
      sessionID = await this.ensureScopedSession(
        detail.pod.id,
        techLead.id,
        goalId,
        revision,
        projectDir,
      );
    } catch (err: any) {
      sessionError = String(err?.message ?? err);
      this.deps.log?.(
        `[Pod] Tech Lead session unavailable for ${goalId}#${revision} (goal kept discussing): ${sessionError}`,
      );
    }

    let promptError: string | undefined;
    if (sessionID) {
      try {
        await this.prompt(goalId, this.openingPrompt(title, objective || charter));
      } catch (err: any) {
        promptError = String(err?.message ?? err);
        this.deps.log?.(`[Pod] Tech Lead opening prompt failed for ${goalId}: ${promptError}`);
      }
    }

    const row = this.deps.store.getGoalRevision(detail.pod.id, goalId, revision);
    return {
      podId: detail.pod.id,
      goalId,
      revision,
      stage: 'discussing',
      status: row?.status ?? 'discussing',
      sessionID,
      projectDir,
      goalDir: intake.goalDir,
      charterPath: intake.charterPath,
      requestPath: intake.requestPath,
      ...(sessionError ? { sessionError } : {}),
      ...(promptError ? { promptError } : {}),
    };
  }

  /** 当前 revision 的讨论会话；不存在/死亡时由 supervisor 重建（generation+1）。 */
  async ensureSession(goalId: string): Promise<string> {
    const goal = this.requireGoal(goalId);
    const revision = this.requireActiveRevision(goal);
    const techLead = this.techLeadMemberForPod(goal.podId);
    const pod = this.requirePod(goal.podId);
    return this.ensureScopedSession(goal.podId, techLead.id, goal.goalId, revision, pod.projectDir);
  }

  /** 发送一条 Tech Lead 消息；正文前永远拼上当前 revision 的 ContextManifest。 */
  async prompt(goalId: string, text: string): Promise<PodTechLeadPromptResult> {
    const goal = this.requireGoal(goalId);
    const revision = this.requireActiveRevision(goal);
    const sessionID = await this.ensureSession(goalId);
    const body = String(text ?? '').trim();
    const content = this.withManifest(goal.goalId, revision, body || undefined);
    await this.deps.runtime.promptAsync({
      sessionID,
      agent: TECH_LEAD_AGENT,
      parts: [{ type: 'text', text: content }],
    });
    return { goalId: goal.goalId, revision, sessionID, text: content };
  }

  /** 只读读取当前讨论会话历史；没有存活会话时返回空（不创建会话）。 */
  async history(goalId: string, limit = 50): Promise<PodTechLeadHistory> {
    const goal = this.requireGoal(goalId);
    const revision = this.requireActiveRevision(goal);
    const techLead = this.techLeadMemberForPod(goal.podId);
    const scope: PodSessionScope = {
      podId: goal.podId,
      memberId: techLead.id,
      goalId: goal.goalId,
      revision,
      kind: 'discussion',
    };
    const lease = await this.deps.sessions.current(scope);
    if (!lease) {
      return { goalId: goal.goalId, revision, sessionID: null, messages: [] };
    }
    const page = await this.deps.runtime.messages({ sessionID: lease.sessionId, limit });
    return {
      goalId: goal.goalId,
      revision,
      sessionID: lease.sessionId,
      messages: page.data ?? [],
      ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
    };
  }

  /**
   * 只有绑定在**当前 active revision** 的 Tech Lead 会话能写方向决定。
   * 旧 revision 的会话在 revision 切换后自动失效（supervisor 作用域隔离）。
   */
  assertTechLeadSession(goalId: string, sessionID: string): { revision: number; sessionID: string } {
    const goal = this.requireGoal(goalId);
    const revision = this.requireActiveRevision(goal);
    const caller = clean(sessionID);
    if (!caller) throw new PodError(403, `session is not the bound Tech Lead session for goal ${goal.goalId}`);
    const techLead = this.techLeadMemberForPod(goal.podId);
    const active = this.deps.store.getActiveScopedSession({
      podId: goal.podId,
      memberId: techLead.id,
      goalId: goal.goalId,
      revision,
      kind: 'discussion',
    });
    if (!active || active.sessionId !== caller) {
      throw new PodError(403, `session is not the bound Tech Lead session for goal ${goal.goalId}`);
    }
    return { revision, sessionID: caller };
  }

  /** Lead 判定（manager 会话在 Pod ensure 时绑定为 lead）。 */
  isLeadSession(sessionID: string): boolean {
    const caller = clean(sessionID);
    if (!caller) return false;
    return this.deps.store.getMemberBySession(caller)?.role === 'lead';
  }

  /** 该项目是否已经有 Pod（用于拒绝「Lead 无 sessionID」的静默 legacy 回退）。 */
  hasPod(projectDir?: string): boolean {
    const resolved = this.deps.resolveProject(projectDir);
    if (!resolved) return false;
    const canonical = canonicalProjectDir(resolved.projectDir);
    return this.deps.store.listPods()
      .some((pod) => canonicalProjectDir(pod.projectDir) === canonical);
  }

  private async ensureScopedSession(
    podId: string,
    memberId: string,
    goalId: string,
    revision: number,
    projectDir: string,
  ): Promise<string> {
    const scope: PodSessionScope = { podId, memberId, goalId, revision, kind: 'discussion' };
    const lease: PodSessionLease = await this.deps.sessions.ensure(scope, async () => {
      const sessionId = await this.deps.runtime.createSession({ projectDir, goalId, revision });
      return sessionId;
    });
    // 幂等登记：gateway 重启后 kv 恢复前也保证隐藏判定与角色归属。
    this.deps.registerInternalSession?.(lease.sessionId, TECH_LEAD_INTERNAL_ROLE, TECH_LEAD_AGENT);
    return lease.sessionId;
  }

  /** revision 1 的 discussing 行：新建或幂等复用；已推进的 Goal 不能被直接创建覆盖。 */
  private ensureDiscussionRevision(podId: string, goalId: string, now: string): number {
    const goal = this.deps.store.getGoal(podId, goalId);
    if (goal && goal.activeRevision !== 1) {
      throw new PodError(
        409,
        `goal ${goalId} is already at revision ${goal.activeRevision}; cannot create a discussion revision`,
      );
    }
    const existing = this.deps.store.getGoalRevision(podId, goalId, 1);
    if (existing) {
      if (existing.status !== 'discussing') {
        throw new PodError(
          409,
          `goal ${goalId} already exists in revision 1 (${existing.status})`,
        );
      }
      this.deps.store.setActiveRevision(podId, goalId, 1);
      return 1;
    }
    this.deps.store.createGoalRevision({
      podId,
      goalId,
      revision: 1,
      status: 'discussing',
      priority: 0,
      now,
    });
    this.deps.store.setActiveRevision(podId, goalId, 1);
    return 1;
  }

  private withManifest(goalId: string, revision: number, body?: string): string {
    const manifest = buildContextManifest({
      goalId,
      revision,
      stage: 'discussing',
      role: TECH_LEAD_INTERNAL_ROLE,
    });
    const rendered = renderContextManifest(manifest);
    return body ? `${rendered}\n\n${body}` : rendered;
  }

  private openingPrompt(title: string, objective: string): string {
    return [
      'Start the technical discussion for this Pod Goal.',
      `Goal: ${title}`,
      objective ? `Objective: ${objective}` : '',
      'Clarify constraints and direction with the user. Do not start planning here:',
      'call mafw_pod_goal_direction with mode "clear" when the direction is unambiguous,',
      'or "needs_user" when a real ambiguity needs the user to decide.',
    ].filter(Boolean).join('\n');
  }

  private requireGoal(goalId: string): PodGoalRow {
    const goal = this.deps.store.getGoalByGoalId(clean(goalId));
    if (!goal) throw new PodError(404, `goal not found: ${goalId}`);
    return goal;
  }

  private requirePod(podId: string) {
    const pod = this.deps.store.getPod(podId);
    if (!pod) throw new PodError(404, `pod not found: ${podId}`);
    return pod;
  }

  private requireActiveRevision(goal: PodGoalRow): number {
    const revision = goal.activeRevision;
    const row = this.deps.store.getGoalRevision(goal.podId, goal.goalId, revision);
    if (!row) throw new PodError(404, `goal revision not found: ${goal.goalId}#${revision}`);
    if (isTerminalGoalRevisionStatus(row.status)) {
      throw new PodError(409, `revision ${revision} is terminal (${row.status})`);
    }
    return revision;
  }

  private techLeadMember(detail: PodDetail): PodMemberRow {
    const member = detail.members.find((candidate) => candidate.role === 'tech_lead');
    if (!member) throw new PodError(404, `pod tech lead not found: ${detail.pod.id}`);
    return member;
  }

  private techLeadMemberForPod(podId: string): PodMemberRow {
    const member = this.deps.store.getMemberByRole(podId, 'tech_lead');
    if (!member) throw new PodError(404, `pod tech lead not found: ${podId}`);
    return member;
  }

  private now(): string {
    return this.deps.now?.() ?? new Date().toISOString();
  }
}
