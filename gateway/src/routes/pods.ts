import type * as http from 'http';
import * as fs from 'fs';
import { PodError, POD_ROSTER_ROLES, type PodMemberRole, type PodMemberRow } from '../core/pod/pod-store';
import type { PodGoalService } from '../core/pod/pod-goal-service';
import type { PodMemoryService } from '../core/pod/pod-memory-service';
import type { PodMessageService } from '../core/pod/pod-message-service';
import type { PodService } from '../core/pod/pod-service';
import type { PodTaskService } from '../core/pod/pod-task-service';
import type { PodTechLeadService } from '../core/pod/pod-tech-lead-service';
import type { GoalAuthorization, GoalIntakeInput, GoalIntakeResult } from '../core/goal/goal-intake';
import {
  GoalConflictError,
  makePodGoalId,
  normalizeGoalSourceRef,
} from '../core/goal/goal-intake';
import type { PodEnqueueResult } from '../core/pod/pod-goal-service';
import type { PodAttentionItem, PodGoalView } from '../core/pod/pod-view';

export interface PodRouteDeps {
  pods: Pick<PodService, 'ensure' | 'get' | 'updateStatus' | 'lookup' | 'ensureLead'>;
  tasks: Pick<PodTaskService, 'list' | 'createManual' | 'updateTask' | 'editTitle' | 'editPlanTask' | 'addPlanTask' | 'deleteTask'>;
  messages: Pick<PodMessageService, 'list' | 'send' | 'markRead'>;
  goals: Pick<PodGoalService, 'list' | 'promote'> & Partial<Pick<
    PodGoalService,
    'enqueueGoal' | 'views' | 'attention' | 'pause' | 'resume' | 'cancelQueued' | 'result'
  >>;
  memory: Pick<PodMemoryService, 'renderContext' | 'writeMemory' | 'readMemoryFile'>;
  access?: { requireMember(sessionId: string, allowed: PodMemberRole[], podId?: string): PodMemberRow };
  delivery?: {
    deliver(messageId: string, opts?: { force?: boolean }): Promise<'delivered' | 'pending' | 'skipped'>;
    listFailures?(podId: string): import('../core/pod/pod-store').PodMessageDeliveryRow[];
    retryFailure?(messageId: string): Promise<'delivered' | 'pending' | 'skipped'>;
    dismissFailure?(messageId: string, memberId: string): boolean;
  };
  intake?: { create(input: GoalIntakeInput): GoalIntakeResult };
  /** Task 18: POST /goals creates a direct discussion Goal (Tech Lead session + revision 1 discussing). */
  techLead?: Pick<PodTechLeadService, 'createGoal'>;
  newGoalId?(): string;
  cost(podId: string): Promise<{ spentUsd: number; limitUsd: number }>;
  transcript(podId: string, sessionId: string): Promise<unknown>;
}

type PodEnqueueFn = (goalId: string, projectDir?: string) => Promise<PodEnqueueResult>;

const POD_STATUSES = new Set(['active', 'idle', 'paused', 'archived']);
const MESSAGE_KINDS = new Set(['note', 'request', 'review', 'decision', 'escalation']);
const MEMORY_FILES = new Set(['POD', 'MEMORY', 'GLOSSARY']);

export async function handlePods(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: string,
  deps: PodRouteDeps,
): Promise<boolean> {
  const pathname = url.split('?')[0];
  const method = req.method || 'GET';

  try {
    const lookupPath = pathname.match(/^\/api\/projects\/([^/]+)\/pod\/lookup$/);
    if (lookupPath) {
      if (method !== 'GET') return false;
      const detail = deps.pods.lookup(decode(lookupPath[1]));
      if (!detail) throw new PodError(404, 'pod not found');
      const member = readMember(deps, url, detail.pod.id);
      const view = enrichPodDetail(deps, detail);
      sendJson(res, 200, member && member.role !== 'lead' ? { ...view, sessions: [] } : view);
      return true;
    }

    const leadEnsure = pathname.match(/^\/api\/pods\/([^/]+)\/lead\/ensure$/);
    if (leadEnsure) {
      if (method !== 'POST') return false;
      const result = await deps.pods.ensureLead(decode(leadEnsure[1]));
      sendJson(res, 200, result);
      return true;
    }

    const projectPod = pathname.match(/^\/api\/projects\/([^/]+)\/pod$/);
    if (projectPod) {
      if (method === 'GET' || method === 'POST') {
        const lookup = new URL(url, 'http://localhost').searchParams.get('lookup') === '1';
        if (method === 'GET' && lookup) {
          const detail = deps.pods.lookup(decode(projectPod[1]));
          if (!detail) throw new PodError(404, 'pod not found');
          const member = readMember(deps, url, detail.pod.id);
          const view = enrichPodDetail(deps, detail);
          sendJson(res, 200, member && member.role !== 'lead' ? { ...view, sessions: [] } : view);
          return true;
        }
        const detail = await deps.pods.ensure(decode(projectPod[1]));
        const member = readMember(deps, url, detail.pod.id);
        const view = enrichPodDetail(deps, detail);
        sendJson(res, 200, member && member.role !== 'lead' ? { ...view, sessions: [] } : view);
        return true;
      }
      return false;
    }

    const task = pathname.match(/^\/api\/pods\/([^/]+)\/tasks\/([^/]+)$/);
    if (task) {
      if (method === 'DELETE') {
        const podId = decode(task[1]);
        requirePod(deps, podId);
        const body = await readJson(req);
        assertAccess(deps, body, ['lead'], podId);
        const deleted = deps.tasks.deleteTask(podId, decode(task[2]));
        sendJson(res, 200, { deleted });
        return true;
      }
      if (method !== 'PATCH') return false;
      const podId = decode(task[1]);
      requirePod(deps, podId);
      const body = await readJson(req);
      const targetTaskId = decode(task[2]);
      const onlyTitle = body?.title !== undefined && body?.acceptance === undefined;
      // A title-only edit of a note is not a plan change; only plan tasks need
      // the Lead gate. Unknown ids fall through to the service's 404.
      const target = onlyTitle
        ? deps.tasks.list(podId).find((row) => row.id === targetTaskId)
        : undefined;
      const editsPlan = body?.acceptance !== undefined
        || (onlyTitle && target?.kind !== 'note');
      const editsState = body?.status !== undefined || body?.ownerMemberId !== undefined;
      if (editsPlan && editsState) {
        throw new PodError(400, 'plan fields (title/acceptance) cannot be mixed with status/owner');
      }
      if (editsPlan) {
        // 计划变更属 Lead 职责：有 actor 时只允许 Lead；人类操作不带 actor。
        assertAccess(deps, body, ['lead'], podId);
        const updated = body.acceptance === undefined
          ? deps.tasks.editTitle(podId, targetTaskId, String(body.title ?? ''))
          : deps.tasks.editPlanTask(podId, targetTaskId, {
            ...(body.title !== undefined ? { title: body.title } : {}),
            acceptance: body.acceptance,
          });
        sendJson(res, 200, { task: updated });
        return true;
      }
      if (onlyTitle) {
        assertAccess(deps, body, [...POD_ROSTER_ROLES], podId);
        sendJson(res, 200, { task: deps.tasks.editTitle(podId, targetTaskId, String(body.title ?? '')) });
        return true;
      }
      assertAccess(deps, body, [...POD_ROSTER_ROLES], podId);
      const updated = deps.tasks.updateTask(podId, targetTaskId, {
        ...(body.status ? { status: body.status } : {}),
        ...(body.ownerMemberId !== undefined ? { ownerMemberId: body.ownerMemberId } : {}),
      });
      sendJson(res, 200, { task: updated });
      return true;
    }

    const tasks = pathname.match(/^\/api\/pods\/([^/]+)\/tasks$/);
    if (tasks) {
      const podId = decode(tasks[1]);
      requirePod(deps, podId);
      if (method === 'GET') {
        readMember(deps, url, podId);
        sendJson(res, 200, { items: deps.tasks.list(podId) });
        return true;
      }
      if (method === 'POST') {
        const body = await readJson(req);
        const planMode = body?.plan === true || typeof body?.waveId === 'string';
        if (planMode) {
          assertAccess(deps, body, ['lead'], podId);
          if (typeof body?.goalId !== 'string' || !body.goalId) {
            throw new PodError(400, 'goalId is required for plan tasks');
          }
          const created = deps.tasks.addPlanTask(
            podId,
            body.goalId,
            typeof body.waveId === 'string' ? body.waveId : null,
            String(body.title ?? ''),
            Array.isArray(body.acceptance) ? body.acceptance : undefined,
          );
          sendJson(res, 200, { task: created });
          return true;
        }
        assertAccess(deps, body, ['lead', 'builder'], podId);
        const created = deps.tasks.createManual(
          podId,
          typeof body.goalId === 'string' ? body.goalId : null,
          String(body.title ?? ''),
          typeof body.ownerMemberId === 'string' ? body.ownerMemberId : undefined,
        );
        sendJson(res, 200, { task: created });
        return true;
      }
      return false;
    }

    const messages = pathname.match(/^\/api\/pods\/([^/]+)\/messages$/);
    if (messages) {
      const podId = decode(messages[1]);
      requirePod(deps, podId);
      if (method === 'GET') {
        readMember(deps, url, podId);
        sendJson(res, 200, { items: deps.messages.list(podId) });
        return true;
      }
      if (method === 'POST') {
        const body = await readJson(req);
        const member = assertAccess(deps, body, [...POD_ROSTER_ROLES], podId);
        if (member && body.fromMemberId && body.fromMemberId !== member.id) {
          throw new PodError(403, 'fromMemberId does not match authenticated actor');
        }
        const fromMemberId = member?.id
          ?? (typeof body.fromMemberId === 'string' ? body.fromMemberId : undefined);
        if (!fromMemberId) throw new PodError(400, 'fromMemberId or actorSessionID required');
        if (!MESSAGE_KINDS.has(String(body.kind))) throw new PodError(400, 'invalid message kind');
        const toMemberId = typeof body.toMemberId === 'string' ? body.toMemberId : null;
        const notify = body.notify === true;
        if (notify && !toMemberId) throw new PodError(400, 'notify requires toMemberId');
        const message = deps.messages.send({
          podId,
          fromMemberId,
          toMemberId,
          kind: body.kind,
          body: String(body.body ?? ''),
        });
        if (!notify) {
          sendJson(res, 200, { message });
          return true;
        }
        const result = deps.delivery ? await deps.delivery.deliver(message.id, { force: false }) : 'skipped';
        sendJson(res, 200, { message, delivery: result === 'skipped' ? 'disabled' : result });
        return true;
      }
      return false;
    }

    const messageRead = pathname.match(/^\/api\/pods\/([^/]+)\/messages\/([^/]+)\/read$/);
    if (messageRead) {
      const podId = decode(messageRead[1]);
      requirePod(deps, podId);
      if (method !== 'POST') return false;
      readMember(deps, url, podId);
      const messageId = decode(messageRead[2]);
      const message = deps.messages.markRead(messageId, podId);
      if (!message) throw new PodError(404, 'message not found');
      sendJson(res, 200, { message });
      return true;
    }

    const deliveryAction = pathname.match(/^\/api\/pods\/([^/]+)\/messages\/([^/]+)\/delivery\/(retry|dismiss)$/);
    if (deliveryAction) {
      if (method !== 'POST') return false;
      const podId = decode(deliveryAction[1]);
      requirePod(deps, podId);
      const body = await readJson(req);
      if (typeof body?.actorSessionID === 'string' && body.actorSessionID) {
        assertAccess(deps, body, ['lead'], podId);
      }
      const messageId = decode(deliveryAction[2]);
      if (deliveryAction[3] === 'retry') {
        if (!deps.delivery?.retryFailure) throw new PodError(503, 'delivery retry unavailable');
        sendJson(res, 200, { delivery: await deps.delivery.retryFailure(messageId) });
      } else {
        if (!deps.delivery?.dismissFailure) throw new PodError(503, 'delivery dismiss unavailable');
        const memberId = String(body?.memberId ?? '');
        if (!memberId) throw new PodError(400, 'memberId is required');
        sendJson(res, 200, { dismissed: deps.delivery.dismissFailure(messageId, memberId) });
      }
      return true;
    }

    const wake = pathname.match(/^\/api\/pods\/([^/]+)\/(wake|sleep)$/);
    if (wake) {
      if (method !== 'POST') return false;
      const podId = decode(wake[1]);
      requirePod(deps, podId);
      const detail = deps.pods.updateStatus(podId, wake[2] === 'wake' ? 'active' : 'idle');
      if (wake[2] === 'wake') await deps.goals.promote(podId);
      sendJson(res, 200, enrichPodDetail(deps, detail));
      return true;
    }

    const cost = pathname.match(/^\/api\/pods\/([^/]+)\/cost$/);
    if (cost) {
      if (method !== 'GET') return false;
      const podId = decode(cost[1]);
      requirePod(deps, podId);
      readMember(deps, url, podId);
      sendJson(res, 200, await deps.cost(podId));
      return true;
    }

    const goalCancel = pathname.match(/^\/api\/pods\/([^/]+)\/goals\/([^/]+)$/);
    if (goalCancel && method === 'DELETE') {
      const podId = decode(goalCancel[1]);
      requirePod(deps, podId);
      const body = await readJson(req);
      if (typeof body?.actorSessionID === 'string' && body.actorSessionID) {
        assertAccess(deps, body, ['lead'], podId);
      }
      if (!deps.goals.cancelQueued) throw new PodError(503, 'goal cancellation unavailable');
      const goal = deps.goals.cancelQueued(podId, decode(goalCancel[2]));
      sendJson(res, 200, { goal });
      return true;
    }

    const goalResult = pathname.match(/^\/api\/pods\/([^/]+)\/goals\/([^/]+)\/result$/);
    if (goalResult) {
      if (method !== 'GET') return false;
      const podId = decode(goalResult[1]);
      requirePod(deps, podId);
      readMember(deps, url, podId);
      if (!deps.goals.result) throw new PodError(503, 'goal result unavailable');
      sendJson(res, 200, deps.goals.result(podId, decode(goalResult[2])));
      return true;
    }

    const handoff = pathname.match(/^\/api\/pods\/([^/]+)\/goals\/handoff$/);
    if (handoff) {
      if (method !== 'POST') return false;
      const podId = decode(handoff[1]);
      requirePod(deps, podId);
      if (!deps.techLead) throw new PodError(503, 'tech lead unavailable');
      const body = await readJson(req);
      const title = String(body?.title ?? '').trim();
      const objective = String(body?.objective ?? '').trim();
      const charter = String(body?.charter ?? '').trim();
      if (!title) throw new PodError(400, 'title is required');
      if (!objective && !charter) throw new PodError(400, 'objective or charter is required');
      const sourceRef = normalizeGoalSourceRef(body?.sourceRef, new Date().toISOString());
      if (!sourceRef?.snapshot) throw new PodError(400, 'sourceRef.snapshot is required');
      const lead = await deps.pods.ensureLead(podId);
      const created = await deps.techLead.createGoal({
        podId,
        projectDir: lead.projectDir,
        title,
        objective: objective || undefined,
        charter: charter || undefined,
        acceptance: Array.isArray(body.acceptance) ? body.acceptance : undefined,
        boundaries: Array.isArray(body.boundaries) ? body.boundaries : undefined,
        priority: isGoalPriority(body.priority) ? body.priority : undefined,
        taskType: isGoalTaskType(body.taskType) ? body.taskType : undefined,
        planReview: body.planReview === 'manual' ? 'manual' : body.planReview === 'auto' ? 'auto' : undefined,
        source: 'lead',
        sourceRef,
        authorization: { source: 'lead', requestMode: 'explicit', scope: lead.projectDir },
        createdBy: lead.sessionId,
      });
      const view = deps.goals.views?.(podId).find((item) => item.goalId === created.goalId)
        ?? {
          id: created.goalId, podId, goalId: created.goalId, status: 'active',
          title, phase: null, verdict: null, stage: { owner: 'team', kind: 'working' },
          resultReady: false, activeRevision: created.revision, revision: created.revision,
          priority: 0, enqueuedAt: new Date().toISOString(), startedAt: null, endedAt: null,
        };
      sendJson(res, 200, {
        podId,
        goalId: created.goalId,
        status: created.status,
        revision: created.revision,
        stage: created.stage,
        queueReason: null,
        sessionID: created.sessionID,
        goal: view,
        ...(created.sessionError ? { sessionError: created.sessionError } : {}),
        ...(created.promptError ? { promptError: created.promptError } : {}),
      });
      return true;
    }

    const goals = pathname.match(/^\/api\/pods\/([^/]+)\/goals$/);
    if (goals) {
      const podId = decode(goals[1]);
      requirePod(deps, podId);
      if (method === 'GET') {
        readMember(deps, url, podId);
        const items: PodGoalView[] = deps.goals.views
          ? deps.goals.views(podId)
          : deps.goals.list(podId).map((row) => ({
            ...row,
            title: row.goalId,
            phase: null,
            stage: { owner: 'system', kind: 'waiting' },
            bucket: row.status === 'queued' ? 'queued' : (row.status === 'done' || row.status === 'aborted') ? 'ended' : 'in_progress',
            resultReady: false,
            sourceRef: null,
            strategy: null,
            assessment: null,
            currentAssignment: null,
            revision: row.activeRevision,
          }));
        sendJson(res, 200, { items });
        return true;
      }
      if (method !== 'POST') return false;

      const body = await readJson(req);
      const actor = typeof body?.actorSessionID === 'string' && body.actorSessionID
        ? assertAccess(deps, body, ['lead'], podId)
        : null;
      const title = String(body?.title ?? '').trim();
      const objective = String(body?.objective ?? '').trim();
      const charter = String(body?.charter ?? '').trim();
      if (!title) throw new PodError(400, 'title is required');
      if (!objective && !charter) throw new PodError(400, 'objective or charter is required');
      // Persist the real entry point (desktop/tui/agent/...) instead of hardcoding
      // desktop; unknown values are rejected so request.json stays trustworthy.
      const source = normalizeGoalSource(body?.source);
      const sourceRef = normalizeGoalSourceRef(body?.sourceRef, new Date().toISOString());

      const detail = deps.pods.get(podId);
      if (!detail) throw new PodError(404, `pod not found: ${podId}`);

      // Task 18: a Pod Goal is created as a direct discussion Goal - the Tech Lead
      // session starts discussing revision 1 and the NodeDriver only starts after an
      // explicit direction decision. The intake/enqueue path stays as the legacy
      // fallback for compositions without the Tech Lead service.
      if (deps.techLead) {
        const created = await deps.techLead.createGoal({
          podId,
          projectDir: detail.pod.projectDir,
          title,
          objective: objective || undefined,
          charter: charter || undefined,
          acceptance: Array.isArray(body.acceptance) ? body.acceptance : undefined,
          boundaries: Array.isArray(body.boundaries) ? body.boundaries : undefined,
          metrics: isPlainObject(body.metrics) ? body.metrics : undefined,
          priority: isGoalPriority(body.priority) ? body.priority : undefined,
          maxLoops: positiveInteger(body.maxLoops),
          budget: isPlainObject(body.budget) ? body.budget : undefined,
          taskType: isGoalTaskType(body.taskType) ? body.taskType : undefined,
          planReview: body.planReview === 'manual' ? 'manual' : body.planReview === 'auto' ? 'auto' : undefined,
          source,
          sourceRef,
          authorization: { source, requestMode: 'explicit', scope: detail.pod.projectDir },
          ...(actor && typeof body.actorSessionID === 'string' ? { createdBy: body.actorSessionID } : {}),
        });
        const view = deps.goals.views?.(podId).find((item) => item.goalId === created.goalId)
          ?? {
            id: created.goalId, podId, goalId: created.goalId, status: 'active',
            title, phase: null, verdict: null, stage: { owner: 'team', kind: 'working' },
            resultReady: false, activeRevision: created.revision, revision: created.revision,
            priority: 0, enqueuedAt: new Date().toISOString(), startedAt: null, endedAt: null,
          };
        sendJson(res, 200, {
          podId,
          goalId: created.goalId,
          status: created.status,
          revision: created.revision,
          stage: created.stage,
          queueReason: null,
          sessionID: created.sessionID,
          goal: view,
          ...(created.sessionError ? { sessionError: created.sessionError } : {}),
          ...(created.promptError ? { promptError: created.promptError } : {}),
        });
        return true;
      }

      if (!deps.intake) throw new PodError(503, 'goal intake unavailable');
      const goalId = deps.newGoalId?.() ?? makePodGoalId(new Date().toISOString(), Math.random);
      let created: GoalIntakeResult;
      try {
        created = deps.intake.create({
          goalId,
          title,
          objective: objective || undefined,
          charter: charter || undefined,
          acceptance: Array.isArray(body.acceptance) ? body.acceptance : undefined,
          boundaries: Array.isArray(body.boundaries) ? body.boundaries : undefined,
          planReview: body.planReview === 'manual' ? 'manual' : body.planReview === 'auto' ? 'auto' : undefined,
          projectDir: detail.pod.projectDir,
          source,
          sourceRef,
          authorization: { source, requestMode: 'explicit' },
          // This route enqueues explicitly below; the intake must not emit
          // goal_created as well or the same goal would be started twice.
          autoStart: false,
        });
      } catch (err) {
        if (err instanceof GoalConflictError) throw new PodError(409, err.message);
        throw err;
      }
      if (!deps.goals.enqueueGoal) throw new PodError(503, 'goal queue unavailable');
      let enqueue: PodEnqueueResult;
      try {
        enqueue = await (deps.goals.enqueueGoal as PodEnqueueFn)(created.goalId, detail.pod.projectDir);
      } catch (err) {
        // The intake files are only useful once the goal is queued; a failed
        // enqueue must not leave an orphan goal behind.
        for (const target of [created.charterPath, created.requestPath]) {
          try { fs.unlinkSync(target); } catch { /* best effort */ }
        }
        throw err;
      }
      const view = deps.goals.views?.(podId).find((item) => item.goalId === created.goalId)
        ?? {
          id: created.goalId, podId, goalId: created.goalId, status: enqueue.status === 'started' ? 'active' : 'queued',
          title, phase: null, verdict: null, stage: enqueue.status === 'started' ? { owner: 'team', kind: 'working' } : { owner: 'team', kind: 'queued' },
          resultReady: false, enqueuedAt: new Date().toISOString(), startedAt: null, endedAt: null,
        };
      sendJson(res, 200, {
        goalId: created.goalId,
        status: enqueue.status,
        queueReason: enqueue.queueReason,
        goal: view,
      });
      return true;
    }

    const transcript = pathname.match(/^\/api\/pods\/([^/]+)\/sessions\/([^/]+)\/transcript$/);
    if (transcript) {
      if (method !== 'GET') return false;
      const podId = decode(transcript[1]);
      requirePod(deps, podId);
      readMember(deps, url, podId);
      sendJson(res, 200, { transcript: await deps.transcript(podId, decode(transcript[2])) });
      return true;
    }

    const memory = pathname.match(/^\/api\/pods\/([^/]+)\/memory$/);
    if (memory) {
      const podId = decode(memory[1]);
      requirePod(deps, podId);
      if (method === 'GET') {
        readMember(deps, url, podId);
        const params = new URL(url, 'http://localhost').searchParams;
        const file = params.get('file');
        if (file) {
          if (!MEMORY_FILES.has(file)) throw new PodError(400, 'file must be POD|MEMORY|GLOSSARY');
          sendJson(res, 200, { content: deps.memory.readMemoryFile(podId, file as 'POD' | 'MEMORY' | 'GLOSSARY') });
          return true;
        }
        const node = params.get('node') || 'plan';
        if (node !== 'plan' && node !== 'execute' && node !== 'review') {
          throw new PodError(400, `invalid node: ${node}`);
        }
        sendJson(res, 200, { context: deps.memory.renderContext(podId, node) });
        return true;
      }
      if (method === 'POST') {
        const body = await readJson(req);
        assertAccess(deps, body, ['lead'], podId);
        if (!MEMORY_FILES.has(String(body.file))) throw new PodError(400, 'file must be POD|MEMORY|GLOSSARY');
        const target = deps.memory.writeMemory(podId, body.file, String(body.content ?? ''));
        sendJson(res, 200, { path: target });
        return true;
      }
      return false;
    }

    const pod = pathname.match(/^\/api\/pods\/([^/]+)$/);
    if (pod) {
      const podId = decode(pod[1]);
      if (method === 'GET') {
        requirePod(deps, podId);
        const detail = deps.pods.get(podId)!;
        const member = readMember(deps, url, podId);
        const view = enrichPodDetail(deps, detail);
        sendJson(res, 200, member && member.role !== 'lead' ? { ...view, sessions: [] } : view);
        return true;
      }
      if (method === 'PATCH') {
        requirePod(deps, podId);
        const body = await readJson(req);
        if (!POD_STATUSES.has(String(body.status))) throw new PodError(400, 'invalid pod status');
        if (body.status === 'active' && deps.goals.resume) {
          await deps.goals.resume(podId);
          const detail = deps.pods.get(podId);
          if (!detail) throw new PodError(404, `pod not found: ${podId}`);
          sendJson(res, 200, enrichPodDetail(deps, detail));
          return true;
        }
        sendJson(res, 200, enrichPodDetail(deps, deps.pods.updateStatus(podId, body.status)));
        return true;
      }
      return false;
    }

    return false;
  } catch (err: any) {
    const status = err instanceof PodError ? err.status : 500;
    sendJson(res, status, { error: err?.message ?? String(err) });
    return true;
  }
}

function enrichPodDetail<T extends { pod: { id: string }; goals: unknown[]; tasks: unknown[] }>(
  deps: PodRouteDeps,
  detail: T,
): T & { goals: PodGoalView[]; attention: PodAttentionItem[] } {
  const goals = deps.goals.views
    ? deps.goals.views(detail.pod.id)
    : detail.goals as PodGoalView[];
  const attention = deps.goals.attention ? deps.goals.attention(detail.pod.id) : [];
  const tasks = deps.tasks.list(detail.pod.id);
  const messageHealth = deps.delivery?.listFailures?.(detail.pod.id) ?? [];
  return { ...detail, goals, tasks, attention, messageHealth };
}

function decode(value: string): string {
  return decodeURIComponent(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

const GOAL_SOURCES: ReadonlySet<GoalAuthorization['source']> = new Set([
  'desktop', 'lead', 'a2a', 'automation', 'user', 'tui', 'agent', 'mobile',
]);

/** 入口来源白名单：未知值 400（请求文件里的 source 必须可信，不能静默落 desktop）。 */
function normalizeGoalSource(value: unknown): GoalAuthorization['source'] {
  if (value === undefined || value === null || value === '') return 'desktop';
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text || !GOAL_SOURCES.has(text as GoalAuthorization['source'])) {
    throw new PodError(400, `invalid goal source: ${String(value)}`);
  }
  return text as GoalAuthorization['source'];
}

function isGoalPriority(value: unknown): value is GoalIntakeInput['priority'] {
  return value === 'low' || value === 'medium' || value === 'high' || value === 'critical';
}

function isGoalTaskType(value: unknown): value is GoalIntakeInput['taskType'] {
  return value === 'feature' || value === 'bugfix' || value === 'refactor'
    || value === 'research' || value === 'docs' || value === 'test' || value === 'other';
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
}

function requirePod(deps: PodRouteDeps, podId: string): void {
  if (!deps.pods.get(podId)) throw new PodError(404, `pod not found: ${podId}`);
}

function assertAccess(
  deps: PodRouteDeps,
  body: any,
  allowed: PodMemberRole[],
  podId: string,
): PodMemberRow | null {
  if (!body || typeof body.actorSessionID !== 'string' || !body.actorSessionID) return null;
  if (!deps.access) throw new PodError(503, 'pod access checks unavailable');
  return deps.access.requireMember(body.actorSessionID, allowed, podId);
}

function readMember(deps: PodRouteDeps, url: string, podId: string): PodMemberRow | null {
  const actor = new URL(url, 'http://localhost').searchParams.get('actorSessionID');
  if (!actor) return null;
  if (!deps.access) throw new PodError(503, 'pod access checks unavailable');
  return deps.access.requireMember(actor, [...POD_ROSTER_ROLES], podId);
}

function readJson(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer | string) => {
      const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
      size += buf.length;
      if (size > 64 * 1024) {
        reject(new PodError(413, 'request body too large'));
        return;
      }
      chunks.push(buf);
    });
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf-8');
      if (!body.trim()) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new PodError(400, 'invalid json body'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res: http.ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(value));
}
