// gateway/src/routes/pod-collaboration.ts
// Pod 协作面（Task 18）：直接讨论 Goal 的 Tech Lead 会话、方向裁定、Spike 探针、
// 打回与 revision 历史。与 `pods.ts` 相同的校验/错误约定（deps 注入，可单测）。
//
// 权限模型与 pods.ts 一致：本地信任模型下 `actorSessionID` 是审计提示而非认证边界；
// 提供 actor 时按成员角色校验（Lead 才能改方向/打回/提探针）。
import type * as http from 'http';
import { PodError, type PodGoalRevisionRow, type PodMemberRole, type PodMemberRow } from '../core/pod/pod-store';
import type { PodGoalService } from '../core/pod/pod-goal-service';
import type { PodService } from '../core/pod/pod-service';
import type { PodTechLeadService } from '../core/pod/pod-tech-lead-service';
import type { PodDirectionService, PodDirectionResult } from '../core/pod/pod-direction-service';
import type { PodProbeService, ProbeRequestInput } from '../core/pod/pod-probe-service';
import type { DirectionOptionInput } from '../core/goal/direction-decision';
import type { ProbeAffects, ProbeBudget, ProbeScope, ProbeStatus } from '../core/goal/probe';

export interface PodCollaborationDeps {
  pods: Pick<PodService, 'get' | 'lookup'>;
  goals: Pick<PodGoalService, 'list' | 'rejectResult'>;
  techLead?: Pick<PodTechLeadService, 'ensureSession' | 'history' | 'prompt'>;
  directions?: Pick<PodDirectionService, 'request' | 'decide' | 'markClear'>;
  probes?: Pick<PodProbeService, 'list' | 'request' | 'requestMany'>;
  revisions?: { list(podId: string, goalId: string): PodGoalRevisionRow[] };
  /** 方向决定（decided/clear）后启动规划；needs_user 绝不调用。 */
  startPlanning?(goalId: string): Promise<void> | void;
  access?: { requireMember(sessionId: string, allowed: PodMemberRole[], podId?: string): PodMemberRow };
}

type DirectionMode = 'decided' | 'clear' | 'needs_user';

const PROBE_STATUSES = new Set<ProbeStatus>(['queued', 'running', 'completed', 'failed', 'cancelled']);

export async function handlePodCollaboration(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: string,
  deps: PodCollaborationDeps,
): Promise<boolean> {
  const pathname = url.split('?')[0];
  const method = req.method || 'GET';

  try {
    const techLeadMessages = pathname.match(
      /^\/api\/pods\/([^/]+)\/goals\/([^/]+)\/tech-lead\/messages$/,
    );
    if (techLeadMessages) {
      if (method !== 'POST') return false;
      const { podId, goalId } = goalTarget(deps, techLeadMessages);
      if (!deps.techLead) throw new PodError(503, 'tech lead discussion unavailable');
      const body = await readJson(req);
      assertAccess(deps, body, ['lead', 'tech_lead'], podId);
      const text = typeof body?.text === 'string'
        ? body.text
        : typeof body?.message === 'string' ? body.message : '';
      if (!text.trim()) throw new PodError(400, 'text is required');
      sendJson(res, 200, await deps.techLead.prompt(goalId, text));
      return true;
    }

    const techLead = pathname.match(/^\/api\/pods\/([^/]+)\/goals\/([^/]+)\/tech-lead$/);
    if (techLead) {
      if (method !== 'GET') return false;
      const { podId, goalId } = goalTarget(deps, techLead);
      if (!deps.techLead) throw new PodError(503, 'tech lead discussion unavailable');
      readMember(deps, url, podId);
      const limit = numberParam(url, 'limit') ?? 50;
      // 打开讨论 = 确保当前 revision 的隐藏 Tech Lead 会话存在（supervisor 复用/重建）。
      let sessionID: string | null = null;
      let sessionError: string | undefined;
      try {
        sessionID = await deps.techLead.ensureSession(goalId);
      } catch (err: any) {
        sessionError = String(err?.message ?? err);
      }
      const history = await deps.techLead.history(goalId, limit);
      sendJson(res, 200, {
        ...history,
        sessionID: history.sessionID ?? sessionID,
        ...(sessionError ? { sessionError } : {}),
      });
      return true;
    }

    const direction = pathname.match(/^\/api\/pods\/([^/]+)\/goals\/([^/]+)\/direction-decision$/);
    if (direction) {
      if (method !== 'POST') return false;
      const { podId, goalId } = goalTarget(deps, direction);
      if (!deps.directions) throw new PodError(503, 'goal direction unavailable');
      const body = await readJson(req);
      assertAccess(deps, body, ['lead'], podId);
      const mode = normalizeDirectionMode(body?.mode, body);
      const revision = optionalRevision(body?.revision);
      const reason = stringOrNull(body?.reason);
      const userWords = typeof body?.userWords === 'string' ? body.userWords : '';
      const optionId = stringOrNull(body?.optionId);

      if (mode === 'needs_user') {
        const options = Array.isArray(body?.options) ? body.options as DirectionOptionInput[] : [];
        if (options.length === 0) {
          throw new PodError(400, 'needs_user requires at least one direction option');
        }
        const requested = deps.directions.request({
          goalId,
          options,
          reason,
          requestedBy: actorSessionId(body),
          revision,
        });
        sendJson(res, 200, { ...requested, planningStarted: false });
        return true;
      }

      let result: PodDirectionResult;
      if (mode === 'clear') {
        const words = userWords.trim() || (reason ?? '');
        if (!words.trim() && !optionId) throw new PodError(400, 'clear requires userWords or optionId');
        result = deps.directions.markClear({
          goalId,
          userWords: words,
          optionId,
          reason,
          source: 'user',
          revision,
        });
      } else {
        if (!userWords.trim() && !optionId) throw new PodError(400, 'decided requires userWords or optionId');
        result = deps.directions.decide({
          goalId,
          revision,
          decision: { userWords, optionId, reason, source: 'user', revision: revision ?? null },
        });
      }

      let planningStarted = false;
      let planningError: string | undefined;
      if (deps.startPlanning) {
        try {
          await deps.startPlanning(goalId);
          planningStarted = true;
        } catch (err: any) {
          // 决定已持久化（append-only）；启动失败要可观测，但绝不回滚用户方向。
          planningError = String(err?.message ?? err);
        }
      }
      sendJson(res, 200, {
        ...result,
        planningStarted,
        ...(planningError ? { planningError } : {}),
      });
      return true;
    }

    const probes = pathname.match(/^\/api\/pods\/([^/]+)\/goals\/([^/]+)\/probes$/);
    if (probes) {
      const { podId, goalId } = goalTarget(deps, probes);
      if (!deps.probes) throw new PodError(503, 'probes unavailable');
      if (method === 'GET') {
        readMember(deps, url, podId);
        const params = new URL(url, 'http://localhost').searchParams;
        const revision = optionalRevision(params.get('revision'));
        const rawStatus = params.get('status');
        if (rawStatus && !PROBE_STATUSES.has(rawStatus as ProbeStatus)) {
          throw new PodError(400, `invalid probe status: ${rawStatus}`);
        }
        sendJson(res, 200, {
          items: deps.probes.list(podId, {
            goalId,
            ...(revision ? { revision } : {}),
            ...(rawStatus ? { status: rawStatus as ProbeStatus } : {}),
          }),
        });
        return true;
      }
      if (method === 'POST') {
        const body = await readJson(req);
        assertAccess(deps, body, ['lead'], podId);
        const inputs = Array.isArray(body?.probes) ? body.probes : [body];
        if (inputs.length === 0) throw new PodError(400, 'probe request is required');
        for (const input of inputs) {
          if (!input || typeof input !== 'object' || Array.isArray(input)) {
            throw new PodError(400, 'invalid probe request');
          }
        }
        if (inputs.length > 1 && !deps.probes.requestMany) {
          throw new PodError(503, 'probe batches unavailable');
        }
        const created = inputs.length > 1
          ? deps.probes.requestMany!(inputs.map((input: any) => toProbeInput(podId, goalId, input)))
          : [deps.probes.request(toProbeInput(podId, goalId, inputs[0]))];
        sendJson(res, 200, { items: created });
        return true;
      }
      return false;
    }

    const reject = pathname.match(/^\/api\/pods\/([^/]+)\/goals\/([^/]+)\/reject$/);
    if (reject) {
      if (method !== 'POST') return false;
      const { podId, goalId } = goalTarget(deps, reject);
      const body = await readJson(req);
      assertAccess(deps, body, ['lead'], podId);
      const feedback = typeof body?.feedback === 'string'
        ? body.feedback
        : typeof body?.reason === 'string' ? body.reason : '';
      if (!feedback.trim()) throw new PodError(400, 'reject feedback is required');
      sendJson(res, 200, await deps.goals.rejectResult(podId, goalId, feedback));
      return true;
    }

    const revisions = pathname.match(/^\/api\/pods\/([^/]+)\/goals\/([^/]+)\/revisions$/);
    if (revisions) {
      if (method !== 'GET') return false;
      const { podId, goalId } = goalTarget(deps, revisions);
      if (!deps.revisions) throw new PodError(503, 'goal revisions unavailable');
      readMember(deps, url, podId);
      sendJson(res, 200, { items: deps.revisions.list(podId, goalId) });
      return true;
    }

    return false;
  } catch (err: any) {
    const status = err instanceof PodError ? err.status : 500;
    sendJson(res, status, { error: err?.message ?? String(err) });
    return true;
  }
}

function goalTarget(
  deps: PodCollaborationDeps,
  match: RegExpMatchArray,
): { podId: string; goalId: string } {
  const podId = decode(match[1]);
  const goalId = decode(match[2]);
  requirePod(deps, podId);
  if (!deps.goals.list(podId).some((row) => row.goalId === goalId)) {
    throw new PodError(404, `goal not found: ${goalId}`);
  }
  return { podId, goalId };
}

function toProbeInput(podId: string, goalId: string, input: any): ProbeRequestInput {
  return {
    podId,
    goalId,
    ...(optionalRevision(input?.revision) ? { revision: optionalRevision(input?.revision)! } : {}),
    question: String(input?.question ?? ''),
    hypothesis: String(input?.hypothesis ?? ''),
    scope: input?.scope as ProbeScope,
    budget: input?.budget as ProbeBudget,
    evidenceRequired: Array.isArray(input?.evidenceRequired)
      ? input.evidenceRequired.map(String)
      : [],
    ...(input?.affects && typeof input.affects === 'object'
      ? { affects: input.affects as ProbeAffects }
      : {}),
  };
}

function normalizeDirectionMode(value: unknown, body: any): DirectionMode {
  if (value === 'decided' || value === 'clear' || value === 'needs_user') return value;
  if (value === 'request') return 'needs_user';
  if (value === undefined || value === null || value === '') {
    const hasOptions = Array.isArray(body?.options) && body.options.length > 0;
    const hasDecision = typeof body?.userWords === 'string' && body.userWords.trim().length > 0
      || (typeof body?.optionId === 'string' && body.optionId.trim().length > 0);
    return hasOptions && !hasDecision ? 'needs_user' : 'decided';
  }
  throw new PodError(400, 'mode must be decided | clear | needs_user');
}

function optionalRevision(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new PodError(400, `invalid revision: ${String(value)}`);
  }
  return parsed;
}

function numberParam(url: string, name: string): number | undefined {
  const raw = new URL(url, 'http://localhost').searchParams.get(name);
  return optionalRevision(raw);
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function actorSessionId(body: any): string | null {
  return typeof body?.actorSessionID === 'string' && body.actorSessionID ? body.actorSessionID : null;
}

function decode(value: string): string {
  return decodeURIComponent(value);
}

function requirePod(deps: PodCollaborationDeps, podId: string): void {
  if (!deps.pods.get(podId)) throw new PodError(404, `pod not found: ${podId}`);
}

function assertAccess(
  deps: PodCollaborationDeps,
  body: any,
  allowed: PodMemberRole[],
  podId: string,
): PodMemberRow | null {
  if (!body || typeof body.actorSessionID !== 'string' || !body.actorSessionID) return null;
  if (!deps.access) throw new PodError(503, 'pod access checks unavailable');
  return deps.access.requireMember(body.actorSessionID, allowed, podId);
}

function readMember(deps: PodCollaborationDeps, url: string, podId: string): PodMemberRow | null {
  const actor = new URL(url, 'http://localhost').searchParams.get('actorSessionID');
  if (!actor) return null;
  if (!deps.access) throw new PodError(503, 'pod access checks unavailable');
  return deps.access.requireMember(actor, ['lead', 'tech_lead', 'builder', 'reviewer'], podId);
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
