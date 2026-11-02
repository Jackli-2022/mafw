import type * as http from 'http';
import { PodError, type PodMemberRole, type PodMemberRow } from '../core/pod/pod-store';
import type { PodGoalService } from '../core/pod/pod-goal-service';
import type { PodMemoryService } from '../core/pod/pod-memory-service';
import type { PodMessageService } from '../core/pod/pod-message-service';
import type { PodService } from '../core/pod/pod-service';
import type { PodTaskService } from '../core/pod/pod-task-service';
import type { GoalIntakeInput, GoalIntakeResult } from '../core/goal/goal-intake';
import { makePodGoalId } from '../core/goal/goal-intake';
import type { PodEnqueueResult } from '../core/pod/pod-goal-service';
import type { PodAttentionItem, PodGoalView } from '../core/pod/pod-view';

export interface PodRouteDeps {
  pods: Pick<PodService, 'ensure' | 'get' | 'updateStatus' | 'lookup'>;
  tasks: Pick<PodTaskService, 'list' | 'createManual' | 'updateTask' | 'editPlanTask' | 'addPlanTask' | 'deleteTask'>;
  messages: Pick<PodMessageService, 'list' | 'send' | 'markRead'>;
  goals: Pick<PodGoalService, 'list' | 'promote'> & Partial<Pick<
    PodGoalService,
    'enqueueGoal' | 'views' | 'attention'
  >>;
  memory: Pick<PodMemoryService, 'renderContext' | 'writeMemory' | 'readMemoryFile'>;
  access?: { requireMember(sessionId: string, allowed: PodMemberRole[], podId?: string): PodMemberRow };
  delivery?: { deliver(messageId: string, opts?: { force?: boolean }): Promise<'delivered' | 'pending' | 'skipped'> };
  intake?: { create(input: GoalIntakeInput): GoalIntakeResult };
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
      const editsPlan = body?.title !== undefined || body?.acceptance !== undefined;
      const editsState = body?.status !== undefined || body?.ownerMemberId !== undefined;
      if (editsPlan && editsState) {
        throw new PodError(400, 'plan fields (title/acceptance) cannot be mixed with status/owner');
      }
      if (editsPlan) {
        // 计划变更属 Lead 职责：有 actor 时只允许 Lead；人类操作不带 actor。
        assertAccess(deps, body, ['lead'], podId);
        const updated = deps.tasks.editPlanTask(podId, decode(task[2]), {
          ...(body.title !== undefined ? { title: body.title } : {}),
          ...(body.acceptance !== undefined ? { acceptance: body.acceptance } : {}),
        });
        sendJson(res, 200, { task: updated });
        return true;
      }
      assertAccess(deps, body, ['lead', 'builder', 'reviewer'], podId);
      const updated = deps.tasks.updateTask(podId, decode(task[2]), {
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
        const member = assertAccess(deps, body, ['lead', 'builder', 'reviewer'], podId);
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
        const result = deps.delivery ? await deps.delivery.deliver(message.id, { force: true }) : 'skipped';
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

    const goals = pathname.match(/^\/api\/pods\/([^/]+)\/goals$/);
    if (goals) {
      const podId = decode(goals[1]);
      requirePod(deps, podId);
      if (method === 'GET') {
        readMember(deps, url, podId);
        const items: PodGoalView[] = deps.goals.views
          ? deps.goals.views(podId)
          : deps.goals.list(podId).map((row) => ({ ...row, title: row.goalId, phase: null, stage: { owner: 'system', kind: 'waiting' }, resultReady: false }));
        sendJson(res, 200, { items });
        return true;
      }
      if (method !== 'POST') return false;

      const body = await readJson(req);
      if (typeof body?.actorSessionID === 'string' && body.actorSessionID) {
        assertAccess(deps, body, ['lead'], podId);
      }
      const title = String(body?.title ?? '').trim();
      const objective = String(body?.objective ?? '').trim();
      const charter = String(body?.charter ?? '').trim();
      if (!title) throw new PodError(400, 'title is required');
      if (!objective && !charter) throw new PodError(400, 'objective or charter is required');
      if (!deps.intake) throw new PodError(503, 'goal intake unavailable');

      const detail = deps.pods.get(podId);
      if (!detail) throw new PodError(404, `pod not found: ${podId}`);
      const goalId = deps.newGoalId?.() ?? makePodGoalId(new Date().toISOString(), Math.random);
      const created = deps.intake.create({
        goalId,
        title,
        objective: objective || undefined,
        charter: charter || undefined,
        acceptance: Array.isArray(body.acceptance) ? body.acceptance : undefined,
        boundaries: Array.isArray(body.boundaries) ? body.boundaries : undefined,
        planReview: body.planReview === 'manual' ? 'manual' : body.planReview === 'auto' ? 'auto' : undefined,
        projectDir: detail.pod.projectDir,
        authorization: { source: 'desktop', requestMode: 'explicit' },
      });
      if (!deps.goals.enqueueGoal) throw new PodError(503, 'goal queue unavailable');
      const enqueue = await (deps.goals.enqueueGoal as PodEnqueueFn)(created.goalId, detail.pod.projectDir);
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

function enrichPodDetail<T extends { pod: { id: string }; goals: unknown[] }>(
  deps: PodRouteDeps,
  detail: T,
): T & { goals: PodGoalView[]; attention: PodAttentionItem[] } {
  const goals = deps.goals.views
    ? deps.goals.views(detail.pod.id)
    : detail.goals as PodGoalView[];
  const attention = deps.goals.attention ? deps.goals.attention(detail.pod.id) : [];
  return { ...detail, goals, attention };
}

function decode(value: string): string {
  return decodeURIComponent(value);
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
  return deps.access.requireMember(actor, ['lead', 'builder', 'reviewer'], podId);
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
