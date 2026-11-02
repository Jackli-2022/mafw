// gateway/src/core/pod/pod-probe-service.ts
// Spike 探针的持久化与受限调度（spec §6.2 / §6.5）。
//
// 不变量：
// - 请求先过大范围校验（probe.ts）再落库：范围 / 预算 / 证据都是机器可读字段；
// - 请求与报告都写入 Goal 工作区文件（`<mafw>/goals/<goalId>/probes/<probeId>.*.json`）
//   并镜像到 `pod_probes`——文件是后续节点的权威输入，DB 是查询索引；
// - 报告在写 DB 与写文件**之前**统一脱敏（绝不把明文密钥留在磁盘上）；
// - 每个 Pod 同时最多一个 running 探针：claim 走单事务 + 唯一部分索引；
// - revision 必须真实存在且非终态；Goal 终态后不允许再挂探针；
// - 队列有上限（maxPending），避免 Spike 无限挤占实施资源。

import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import {
  DEFAULT_PROBE_LIMITS,
  redactProbeReport,
  redactProbeText,
  validateProbeReport,
  validateProbeRequest,
  type ProbeAffects,
  type ProbeBudget,
  type ProbeReport,
  type ProbeRequest,
  type ProbeScope,
} from '../goal/probe';
import {
  PodError,
  isTerminalGoalRevisionStatus,
  type PodProbeRow,
  type PodStore,
} from './pod-store';

/** 默认每 Pod 活跃（queued + running）探针上限。 */
export const DEFAULT_MAX_PENDING_PROBES = 8;

const SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

/** 路径构建器的标识符闸门：`.`/`..`/分隔符一律拒绝（不做字符替换，避免歧义路径）。 */
function safeSegment(value: string, field: string): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!SAFE_IDENTIFIER.test(text)) {
    throw new Error(`probe ${field} must be a safe identifier`);
  }
  return text;
}

export interface PodProbeServiceDeps {
  store: PodStore;
  /** Goal 的 mafw 目录；解析不到时任何写操作 400（不产生半持久化）。 */
  resolveMafwDir(goalId: string): string | null;
  now?(): string;
  newId?(): string;
  limits?: {
    /** 单探针分钟上限（只能收紧默认值）。 */
    maxMinutes?: number;
    /** 单探针美元上限（只能收紧默认值）。 */
    maxUsd?: number;
    /** 每 Pod 活跃探针上限。 */
    maxPending?: number;
  };
  notify?(podId: string): void;
  log?(message: string): void;
}

export interface ProbeRequestInput {
  podId: string;
  goalId: string;
  /** 缺省 = Goal 的 active revision。 */
  revision?: number;
  question: string;
  hypothesis: string;
  scope: ProbeScope;
  budget: ProbeBudget;
  evidenceRequired: string[];
  affects?: ProbeAffects;
}

export interface ProbeRecord {
  id: string;
  podId: string;
  goalId: string;
  revision: number;
  status: PodProbeRow['status'];
  request: ProbeRequest;
  report: ProbeReport | null;
  error: string | null;
  requestPath: string;
  reportPath: string | null;
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
}

export interface ProbeListFilter {
  goalId?: string;
  revision?: number;
  status?: PodProbeRow['status'];
}

/** `<mafwDir>/goals/<goalId>/probes`（探针产物的唯一落点）。 */
export function probeArtifactDir(mafwDir: string, goalId: string): string {
  return path.join(mafwDir, 'goals', safeSegment(goalId, 'goalId'), 'probes');
}

export function probeRequestPath(mafwDir: string, goalId: string, probeId: string): string {
  return path.join(
    probeArtifactDir(mafwDir, goalId),
    `${safeSegment(probeId, 'probeId')}.request.json`,
  );
}

export function probeReportPath(mafwDir: string, goalId: string, probeId: string): string {
  return path.join(
    probeArtifactDir(mafwDir, goalId),
    `${safeSegment(probeId, 'probeId')}.report.json`,
  );
}

function writeJsonAtomic(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf-8');
  fs.renameSync(tmp, file);
}

function parseJson<T>(text: string | null, what: string, id: string): T | null {
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`probe ${what} artifact is corrupt: ${id}`);
  }
}

function recordFromRow(row: PodProbeRow): ProbeRecord {
  const request = parseJson<ProbeRequest>(row.requestJson, 'request', row.id);
  if (!request) throw new Error(`probe request artifact is missing: ${row.id}`);
  return {
    id: row.id,
    podId: row.podId,
    goalId: row.goalId,
    revision: row.revision,
    status: row.status,
    request,
    report: parseJson<ProbeReport>(row.reportJson, 'report', row.id),
    error: row.error,
    requestPath: row.requestPath,
    reportPath: row.reportPath,
    createdAt: row.createdAt,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
  };
}

export class PodProbeService {
  constructor(private readonly deps: PodProbeServiceDeps) {}

  private now(): string {
    return this.deps.now?.() ?? new Date().toISOString();
  }

  private nextId(): string {
    return this.deps.newId?.() ?? `probe_${randomUUID()}`;
  }

  private budgetLimits(): { maxMinutes: number; maxUsd: number } {
    return {
      maxMinutes: this.deps.limits?.maxMinutes ?? DEFAULT_PROBE_LIMITS.maxMinutes,
      maxUsd: this.deps.limits?.maxUsd ?? DEFAULT_PROBE_LIMITS.maxUsd,
    };
  }

  private maxPending(): number {
    return this.deps.limits?.maxPending ?? DEFAULT_MAX_PENDING_PROBES;
  }

  /**
   * 入队一条探针请求。校验顺序：Pod → Goal（含 Pod 归属）→ revision（存在且非终态）
   * → 队列上限 → 请求本身。任何一步失败都不写文件、不写 DB。
   */
  request(input: ProbeRequestInput): ProbeRecord {
    if (!this.deps.store.getPod(input.podId)) {
      throw new PodError(404, `pod not found: ${input.podId}`);
    }
    const goal = this.deps.store.getGoal(input.podId, input.goalId);
    if (!goal) throw new PodError(404, `goal not found in pod: ${input.goalId}`);

    const active = this.deps.store.getGoalRevision(input.podId, input.goalId, goal.activeRevision);
    if (active && isTerminalGoalRevisionStatus(active.status)) {
      throw new PodError(409, `goal revision is terminal: ${input.goalId} r${goal.activeRevision}`);
    }

    const revision = input.revision ?? goal.activeRevision;
    const revisionRow = this.deps.store.getGoalRevision(input.podId, input.goalId, revision);
    if (!revisionRow) {
      throw new PodError(404, `goal revision not found: ${input.goalId} r${revision}`);
    }
    if (isTerminalGoalRevisionStatus(revisionRow.status)) {
      throw new PodError(409, `goal revision is terminal: ${input.goalId} r${revision}`);
    }

    const activeProbes = this.deps.store.listProbes(input.podId)
      .filter((probe) => probe.status === 'queued' || probe.status === 'running');
    if (activeProbes.length >= this.maxPending()) {
      throw new PodError(409, `probe queue is full for pod: ${input.podId}`);
    }

    const mafwDir = this.deps.resolveMafwDir(input.goalId);
    if (!mafwDir) throw new PodError(400, `mafw dir not resolved for goal: ${input.goalId}`);

    let request: ProbeRequest;
    try {
      request = validateProbeRequest({
        id: this.nextId(),
        podId: input.podId,
        goalId: input.goalId,
        revision,
        question: input.question,
        hypothesis: input.hypothesis,
        scope: input.scope,
        budget: input.budget,
        evidenceRequired: input.evidenceRequired,
        affects: input.affects,
      }, this.budgetLimits());
    } catch (error) {
      throw new PodError(400, error instanceof Error ? error.message : String(error));
    }

    const requestPath = probeRequestPath(mafwDir, request.goalId, request.id);
    writeJsonAtomic(requestPath, request);

    let row: PodProbeRow;
    try {
      row = this.deps.store.insertProbe({
        id: request.id,
        podId: request.podId,
        goalId: request.goalId,
        revision: request.revision,
        requestJson: JSON.stringify(request),
        requestPath,
        createdAt: this.now(),
      });
    } catch (error) {
      // DB 拒绝（例如 id 撞车）时不要让孤儿文件冒充权威输入。
      try { fs.rmSync(requestPath, { force: true }); } catch { /* best effort */ }
      throw error;
    }

    this.deps.notify?.(row.podId);
    this.deps.log?.(`[Pod] probe queued pod=${row.podId} goal=${row.goalId} r${row.revision} probe=${row.id}`);
    return recordFromRow(row);
  }

  /**
   * 抢占该 Pod 的下一条**有效**排队探针；已有 running、队列为空或排队后 Goal
   * 已终态（完成/中止/丢弃）时返回 null。
   *
   * 终态复核放在 claim 而不是只在 request：请求入队后 Goal 随时可能被人中止，
   * 过期探针绝不交给 Builder（否则会白烧预算并产出无主报告）。过期探针标记 failed
   * 以释放运行槽，然后继续看下一条。
   */
  claim(podId: string): ProbeRecord | null {
    for (;;) {
      const row = this.deps.store.claimNextProbe(podId, this.now());
      if (!row) return null;

      const revision = this.deps.store.getGoalRevision(row.podId, row.goalId, row.revision);
      if (!revision || isTerminalGoalRevisionStatus(revision.status)) {
        const reason = redactProbeText(!revision
          ? `goal revision is missing: ${row.goalId} r${row.revision}`
          : `goal revision is terminal: ${row.goalId} r${row.revision} (${revision.status})`);
        this.deps.store.failProbe(row.id, { error: reason, now: this.now() });
        this.deps.notify?.(row.podId);
        this.deps.log?.(`[Pod] probe skipped pod=${row.podId} probe=${row.id} reason=${reason}`);
        continue;
      }

      this.deps.notify?.(row.podId);
      this.deps.log?.(`[Pod] probe claimed pod=${row.podId} probe=${row.id}`);
      return recordFromRow(row);
    }
  }

  /**
   * 完成探针：校验 + 脱敏 + 原子写报告文件 + 写 DB。
   * 允许对同一探针重复完成（A2A 传输重试 / Builder 修正报告）：最新报告为准。
   */
  complete(probeId: string, reportInput: unknown): ProbeReport {
    const row = this.deps.store.getProbe(probeId);
    if (!row) throw new PodError(404, `probe not found: ${probeId}`);
    if (row.status === 'cancelled') {
      throw new PodError(409, `probe is cancelled: ${probeId}`);
    }

    const raw = (reportInput && typeof reportInput === 'object' && !Array.isArray(reportInput))
      ? reportInput as Record<string, unknown>
      : {};
    const declaredId = typeof raw.probeId === 'string' ? raw.probeId.trim() : '';
    if (declaredId && declaredId !== probeId) {
      throw new PodError(400, `probe report probeId mismatch: expected ${probeId}, got ${declaredId}`);
    }

    let report: ProbeReport;
    try {
      report = validateProbeReport({ ...raw, probeId });
    } catch (error) {
      throw new PodError(400, error instanceof Error ? error.message : String(error));
    }
    const redacted = redactProbeReport(report);

    const mafwDir = this.deps.resolveMafwDir(row.goalId);
    const reportPath = mafwDir
      ? probeReportPath(mafwDir, row.goalId, probeId)
      : path.join(path.dirname(row.requestPath), `${safeSegment(probeId, 'probeId')}.report.json`);
    writeJsonAtomic(reportPath, redacted);

    const updated = this.deps.store.completeProbe(probeId, {
      reportJson: JSON.stringify(redacted),
      reportPath,
      now: this.now(),
    });
    if (!updated) throw new PodError(409, `probe cannot be completed in status: ${row.status}`);

    this.deps.notify?.(updated.podId);
    this.deps.log?.(
      `[Pod] probe completed pod=${updated.podId} probe=${probeId} conclusion=${redacted.conclusion}`,
    );
    return redacted;
  }

  /** 标记探针失败（原因同样脱敏），释放该 Pod 的运行槽。 */
  fail(probeId: string, reason: string): ProbeRecord {
    const row = this.deps.store.getProbe(probeId);
    if (!row) throw new PodError(404, `probe not found: ${probeId}`);
    if (row.status === 'completed' || row.status === 'cancelled') {
      throw new PodError(409, `probe cannot fail in status: ${row.status}`);
    }
    const message = typeof reason === 'string' ? reason.trim() : '';
    if (!message) throw new PodError(400, 'probe failure reason is required');

    const redacted = redactProbeText(message);
    const updated = this.deps.store.failProbe(probeId, { error: redacted, now: this.now() });
    if (!updated) throw new PodError(409, `probe cannot fail in status: ${row.status}`);

    this.deps.notify?.(updated.podId);
    this.deps.log?.(`[Pod] probe failed pod=${updated.podId} probe=${probeId}`);
    return recordFromRow(updated);
  }

  /** 查询某 Pod 的探针（按入队顺序）。 */
  list(podId: string, filter: ProbeListFilter = {}): ProbeRecord[] {
    return this.deps.store.listProbes(podId, filter).map(recordFromRow);
  }
}
