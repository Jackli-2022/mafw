import type { Database } from 'better-sqlite3';
import type { ProbeStatus } from '../goal/probe';
import type { PodGoalVerdict } from './pod-stage';

export type PodStatus = 'active' | 'idle' | 'paused' | 'archived';
export type PodMemberRole = 'lead' | 'tech_lead' | 'builder' | 'reviewer';
/**
 * 四角色 roster 全集（roster 级访问检查的唯一来源）：任何成员都通过的通道用它；
 * Lead 专属动作（计划编辑、Goal 建立、投递重试）仍显式用 `['lead']`。
 */
export const POD_ROSTER_ROLES = ['lead', 'tech_lead', 'builder', 'reviewer'] as const;
export type PodMemberStatus = 'available' | 'working' | 'waiting' | 'sleeping' | 'retired';
export type PodGoalStatus = 'queued' | 'active' | 'done' | 'aborted';
/**
 * Goal revision 生命周期（append-only 打回循环）：每个 revision 独立走
 * 讨论 → 方向裁定 → 规划 → 计划审阅 → 排队 → 实施 → 验收 → 终态。
 * `discarded` = 误建 Goal 的丢弃（不产生 FAIL/outcome 污染）。
 */
export type PodGoalRevisionStatus =
  | 'discussing'
  | 'direction_review'
  | 'planning'
  | 'plan_review'
  | 'queued'
  | 'implementing'
  | 'reviewing'
  | 'completed'
  | 'aborted'
  | 'discarded';
export type PodGoalDirectionStatus = 'none' | 'pending' | 'decided';

/** 终态 revision：完成/中止/丢弃后不可再改写（打回只能追加下一 revision）。 */
export const TERMINAL_GOAL_REVISION_STATUSES = ['completed', 'aborted', 'discarded'] as const;

export function isTerminalGoalRevisionStatus(status: PodGoalRevisionStatus): boolean {
  return (TERMINAL_GOAL_REVISION_STATUSES as readonly string[]).includes(status);
}

/**
 * 旧 Goal 根状态 → revision 状态的一次性映射（历史数据没有阶段信息）：
 * queued→queued、active→implementing（在飞循环）、done→completed、aborted→aborted。
 */
export function revisionStatusFromGoalStatus(status: PodGoalStatus): PodGoalRevisionStatus {
  switch (status) {
    case 'queued':
      return 'queued';
    case 'active':
      return 'implementing';
    case 'done':
      return 'completed';
    case 'aborted':
      return 'aborted';
    default:
      return 'queued';
  }
}
export type PodTaskStatus =
  | 'pending'
  | 'in_progress'
  | 'blocked'
  | 'review'
  | 'done'
  | 'failed'
  | 'skipped'
  | 'reopened';

export interface PodRow {
  id: string;
  projectDir: string;
  name: string;
  status: PodStatus;
  configJson: string;
  activeGoalId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PodMemberRow {
  id: string;
  podId: string;
  role: PodMemberRole;
  displayName: string;
  agentName: string;
  modelProvider: string | null;
  modelId: string | null;
  status: PodMemberStatus;
  configJson: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PodGoalRow {
  id: string;
  podId: string;
  goalId: string;
  status: PodGoalStatus;
  verdict: PodGoalVerdict | null;
  /** 当前 revision（legacy 行为 1）；revision 内容在 pod_goal_revisions。 */
  activeRevision: number;
  /** Goal 级调度优先级（打回/高优先级 Goal 靠前；legacy 0）。 */
  priority: number;
  enqueuedAt: string;
  startedAt: string | null;
  endedAt: string | null;
}

/** Goal revision（append-only：旧 revision 永不覆盖、verdict 永不反归档）。 */
export interface PodGoalRevisionRow {
  id: string;
  podId: string;
  goalId: string;
  revision: number;
  status: PodGoalRevisionStatus;
  verdict: string | null;
  directionStatus: PodGoalDirectionStatus;
  directionJson: string | null;
  planHash: string | null;
  evalHash: string | null;
  feedback: string | null;
  priority: number;
  enqueuedAt: string;
  startedAt: string | null;
  endedAt: string | null;
}

/** Spike 探针（spec §6）：请求/报告持久化 + 每 Pod 单运行槽。 */
export interface PodProbeRow {
  id: string;
  podId: string;
  goalId: string;
  revision: number;
  status: ProbeStatus;
  requestJson: string;
  reportJson: string | null;
  requestPath: string;
  reportPath: string | null;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
}

export interface PodTaskRow {
  id: string;
  podId: string;
  goalId: string | null;
  sourceKey: string;
  externalTaskId: string | null;
  title: string;
  description: string | null;
  ownerMemberId: string | null;
  status: PodTaskStatus;
  dependenciesJson: string | null;
  artifactRefsJson: string | null;
  /** waves 任务验收标准的镜像（JSON string[]）；随投影刷新，状态仍独立保留。 */
  acceptanceJson: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PodMessageRow {
  id: string;
  podId: string;
  fromMemberId: string;
  toMemberId: string | null;
  kind: string;
  body: string;
  createdAt: string;
  readAt: string | null;
  protocol: string | null;
  externalMessageId: string | null;
  partsJson: string | null;
  deliveredAt: string | null;
  deliveredSessionId: string | null;
}

export interface PodMessageDeliveryRow {
  messageId: string;
  podId: string;
  memberId: string;
  deliveredAt: string | null;
  deliveredSessionId: string | null;
  status: 'pending' | 'delivered' | 'failed';
  attempts: number;
  lastError: string | null;
  nextRetryAt: string | null;
}

export interface PodA2ALinkRow {
  id: string;
  podId: string;
  localKind: 'task' | 'message';
  localId: string;
  a2aId: string;
  contextId: string | null;
  state: string | null;
  createdAt: string;
}

/**
 * 隐藏内部会话的作用域类型（Session Supervisor 词汇）：
 * - project       项目级常驻（Lead / Tech Lead 项目上下文）
 * - discussion    Goal 内的 Tech Lead 讨论
 * - probe         Spike 探针（隔离临时会话）
 * - implementation 按批准 Plan 的实施
 * - review        某 revision 的独立验收
 */
export type PodSessionScopeKind =
  | 'project'
  | 'discussion'
  | 'probe'
  | 'implementation'
  | 'review';

const POD_SESSION_SCOPE_KINDS: readonly string[] = [
  'project',
  'discussion',
  'probe',
  'implementation',
  'review',
];

/** 未知/手工写入的 scope_kind 一律按「非 Supervisor 管理」读（fail-closed）。 */
function scopeKindFromRow(value: unknown): PodSessionScopeKind | null {
  return typeof value === 'string' && POD_SESSION_SCOPE_KINDS.includes(value)
    ? (value as PodSessionScopeKind)
    : null;
}

/**
 * 内部会话的稳定身份：(pod, member, goal, revision, kind)。
 * runtime session id 只是运行资源，可被回收重建（见 `generation`）。
 */
export interface PodSessionScopeKey {
  podId: string;
  memberId: string;
  goalId: string | null;
  revision: number | null;
  kind: PodSessionScopeKind;
}

export interface PodSessionRow {
  id: string;
  podId: string;
  memberId: string;
  goalId: string | null;
  node: string | null;
  sessionId: string;
  status: string;
  transcriptRef: string | null;
  /** 作用域类型；null = 历史/节点会话（非 Supervisor 管理）。 */
  scopeKind: PodSessionScopeKind | null;
  /** Goal revision（project 作用域为 null）。 */
  revision: number | null;
  /** 同一作用域的租约世代：每次重建 +1（存活复用不递增）。 */
  generation: number;
  /** 最近一次被 ensure/current 确认存活的时间。 */
  lastActiveAt: string | null;
  createdAt: string;
  endedAt: string | null;
}

export class PodError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'PodError';
  }
}

function podFromRow(row: any): PodRow {
  return {
    id: row.id,
    projectDir: row.project_dir,
    name: row.name,
    status: row.status,
    configJson: row.config_json,
    activeGoalId: row.active_goal_id ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function memberFromRow(row: any): PodMemberRow {
  return {
    id: row.id,
    podId: row.pod_id,
    role: row.role,
    displayName: row.display_name,
    agentName: row.agent_name,
    modelProvider: row.model_provider ?? null,
    modelId: row.model_id ?? null,
    status: row.status,
    configJson: row.config_json ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function goalFromRow(row: any): PodGoalRow {
  return {
    id: row.id,
    podId: row.pod_id,
    goalId: row.goal_id,
    status: row.status,
    verdict: row.verdict ?? null,
    activeRevision: Number(row.active_revision ?? 1),
    priority: Number(row.priority ?? 0),
    enqueuedAt: row.enqueued_at,
    startedAt: row.started_at ?? null,
    endedAt: row.ended_at ?? null,
  };
}

function goalRevisionFromRow(row: any): PodGoalRevisionRow {
  return {
    id: row.id,
    podId: row.pod_id,
    goalId: row.goal_id,
    revision: Number(row.revision),
    status: row.status,
    verdict: row.verdict ?? null,
    directionStatus: row.direction_status ?? 'none',
    directionJson: row.direction_json ?? null,
    planHash: row.plan_hash ?? null,
    evalHash: row.eval_hash ?? null,
    feedback: row.feedback ?? null,
    priority: Number(row.priority ?? 0),
    enqueuedAt: row.enqueued_at,
    startedAt: row.started_at ?? null,
    endedAt: row.ended_at ?? null,
  };
}

function taskFromRow(row: any): PodTaskRow {
  return {
    id: row.id,
    podId: row.pod_id,
    goalId: row.goal_id ?? null,
    sourceKey: row.source_key,
    externalTaskId: row.external_task_id ?? null,
    title: row.title,
    description: row.description ?? null,
    ownerMemberId: row.owner_member_id ?? null,
    status: row.status,
    dependenciesJson: row.dependencies_json ?? null,
    artifactRefsJson: row.artifact_refs_json ?? null,
    acceptanceJson: row.acceptance_json ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function messageFromRow(row: any): PodMessageRow {
  return {
    id: row.id,
    podId: row.pod_id,
    fromMemberId: row.from_member_id,
    toMemberId: row.to_member_id ?? null,
    kind: row.kind,
    body: row.body,
    createdAt: row.created_at,
    readAt: row.read_at ?? null,
    protocol: row.protocol ?? null,
    externalMessageId: row.external_message_id ?? null,
    partsJson: row.parts_json ?? null,
    deliveredAt: row.delivered_at ?? null,
    deliveredSessionId: row.delivered_session_id ?? null,
  };
}

function deliveryFromRow(row: any): PodMessageDeliveryRow {
  return {
    messageId: row.message_id,
    podId: row.pod_id,
    memberId: row.member_id,
    deliveredAt: row.delivered_at ?? null,
    deliveredSessionId: row.delivered_session_id ?? null,
    status: row.status ?? 'pending',
    attempts: Number(row.attempts ?? 0),
    lastError: row.last_error ?? null,
    nextRetryAt: row.next_retry_at ?? null,
  };
}

function a2aLinkFromRow(row: any): PodA2ALinkRow {
  return {
    id: row.id,
    podId: row.pod_id,
    localKind: row.local_kind,
    localId: row.local_id,
    a2aId: row.a2a_id,
    contextId: row.context_id ?? null,
    state: row.state ?? null,
    createdAt: row.created_at,
  };
}

function probeFromRow(row: any): PodProbeRow {
  return {
    id: row.id,
    podId: row.pod_id,
    goalId: row.goal_id,
    revision: Number(row.revision),
    status: row.status,
    requestJson: row.request_json,
    reportJson: row.report_json ?? null,
    requestPath: row.request_path,
    reportPath: row.report_path ?? null,
    error: row.error ?? null,
    createdAt: row.created_at,
    startedAt: row.started_at ?? null,
    endedAt: row.ended_at ?? null,
  };
}

function sessionFromRow(row: any): PodSessionRow {
  return {
    id: row.id,
    podId: row.pod_id,
    memberId: row.member_id,
    goalId: row.goal_id ?? null,
    node: row.node ?? null,
    sessionId: row.session_id,
    status: row.status,
    transcriptRef: row.transcript_ref ?? null,
    scopeKind: scopeKindFromRow(row.scope_kind),
    revision: row.revision === null || row.revision === undefined ? null : Number(row.revision),
    generation: Number(row.generation ?? 1),
    lastActiveAt: row.last_active_at ?? null,
    createdAt: row.created_at,
    endedAt: row.ended_at ?? null,
  };
}

// 四角色 roster 的规范顺序：Lead → Tech Lead → Builder → Reviewer。
const ROLE_ORDER = `CASE role WHEN 'lead' THEN 0 WHEN 'tech_lead' THEN 1 WHEN 'builder' THEN 2 WHEN 'reviewer' THEN 3 ELSE 4 END`;

export class PodStore {
  constructor(private readonly db: Database) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS project_pods (
        id TEXT PRIMARY KEY,
        project_dir TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        status TEXT NOT NULL,
        config_json TEXT NOT NULL DEFAULT '{}',
        active_goal_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_project_pods_status ON project_pods(status);

      CREATE TABLE IF NOT EXISTS pod_members (
        id TEXT PRIMARY KEY,
        pod_id TEXT NOT NULL,
        role TEXT NOT NULL,
        display_name TEXT NOT NULL,
        agent_name TEXT NOT NULL,
        model_provider TEXT,
        model_id TEXT,
        status TEXT NOT NULL,
        config_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(pod_id, role)
      );
      CREATE INDEX IF NOT EXISTS idx_pod_members_pod ON pod_members(pod_id);

      CREATE TABLE IF NOT EXISTS pod_goals (
        id TEXT PRIMARY KEY,
        pod_id TEXT NOT NULL,
        goal_id TEXT NOT NULL,
        status TEXT NOT NULL,
        verdict TEXT,
        active_revision INTEGER NOT NULL DEFAULT 1,
        priority INTEGER NOT NULL DEFAULT 0,
        enqueued_at TEXT NOT NULL,
        started_at TEXT,
        ended_at TEXT,
        UNIQUE(pod_id, goal_id)
      );
      CREATE INDEX IF NOT EXISTS idx_pod_goals_goal ON pod_goals(goal_id);
      CREATE INDEX IF NOT EXISTS idx_pod_goals_pod_status ON pod_goals(pod_id, status, enqueued_at);

      CREATE TABLE IF NOT EXISTS pod_goal_revisions (
        id TEXT PRIMARY KEY,
        pod_id TEXT NOT NULL,
        goal_id TEXT NOT NULL,
        revision INTEGER NOT NULL,
        status TEXT NOT NULL,
        verdict TEXT,
        direction_status TEXT NOT NULL DEFAULT 'none',
        direction_json TEXT,
        plan_hash TEXT,
        eval_hash TEXT,
        feedback TEXT,
        priority INTEGER NOT NULL DEFAULT 0,
        enqueued_at TEXT NOT NULL,
        started_at TEXT,
        ended_at TEXT,
        UNIQUE(pod_id, goal_id, revision)
      );
      CREATE INDEX IF NOT EXISTS idx_pod_goal_revisions_goal
        ON pod_goal_revisions(pod_id, goal_id, revision);
      CREATE INDEX IF NOT EXISTS idx_pod_goal_revisions_status
        ON pod_goal_revisions(pod_id, status, priority);

      CREATE TABLE IF NOT EXISTS pod_tasks (
        id TEXT PRIMARY KEY,
        pod_id TEXT NOT NULL,
        goal_id TEXT,
        source_key TEXT NOT NULL,
        external_task_id TEXT,
        title TEXT NOT NULL,
        description TEXT,
        owner_member_id TEXT,
        status TEXT NOT NULL,
        dependencies_json TEXT,
        artifact_refs_json TEXT,
        acceptance_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(pod_id, goal_id, source_key)
      );
      CREATE INDEX IF NOT EXISTS idx_pod_tasks_pod_goal ON pod_tasks(pod_id, goal_id);

      CREATE TABLE IF NOT EXISTS pod_messages (
        id TEXT PRIMARY KEY,
        pod_id TEXT NOT NULL,
        from_member_id TEXT NOT NULL,
        to_member_id TEXT,
        kind TEXT NOT NULL,
        body TEXT NOT NULL,
        created_at TEXT NOT NULL,
        read_at TEXT,
        protocol TEXT,
        external_message_id TEXT,
        parts_json TEXT,
        delivered_at TEXT,
        delivered_session_id TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_pod_messages_pod ON pod_messages(pod_id, created_at);

      CREATE TABLE IF NOT EXISTS pod_message_deliveries (
        message_id TEXT NOT NULL,
        pod_id TEXT NOT NULL,
        member_id TEXT NOT NULL,
        delivered_at TEXT,
        delivered_session_id TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        attempts INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        next_retry_at TEXT,
        PRIMARY KEY (message_id, member_id)
      );
      CREATE INDEX IF NOT EXISTS idx_pod_deliveries_pod ON pod_message_deliveries(pod_id, status);

      CREATE TABLE IF NOT EXISTS pod_a2a_links (
        id TEXT PRIMARY KEY,
        pod_id TEXT NOT NULL,
        local_kind TEXT NOT NULL,
        local_id TEXT NOT NULL,
        a2a_id TEXT NOT NULL,
        context_id TEXT,
        state TEXT,
        created_at TEXT NOT NULL,
        UNIQUE(pod_id, local_kind, local_id),
        UNIQUE(pod_id, local_kind, a2a_id)
      );
      CREATE INDEX IF NOT EXISTS idx_pod_a2a_links_pod ON pod_a2a_links(pod_id, local_kind);

      CREATE TABLE IF NOT EXISTS pod_member_sessions (
        id TEXT PRIMARY KEY,
        pod_id TEXT NOT NULL,
        member_id TEXT NOT NULL,
        goal_id TEXT,
        node TEXT,
        session_id TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL,
        transcript_ref TEXT,
        scope_kind TEXT,
        revision INTEGER,
        generation INTEGER NOT NULL DEFAULT 1,
        last_active_at TEXT,
        created_at TEXT NOT NULL,
        ended_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_pod_member_sessions_pod ON pod_member_sessions(pod_id, ended_at);

      CREATE TABLE IF NOT EXISTS pod_session_snapshots (
        id TEXT PRIMARY KEY,
        pod_id TEXT NOT NULL,
        member_id TEXT NOT NULL,
        goal_id TEXT,
        node TEXT,
        session_id TEXT NOT NULL UNIQUE,
        path TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_pod_snapshots_pod ON pod_session_snapshots(pod_id);

      CREATE TABLE IF NOT EXISTS pod_probes (
        id TEXT PRIMARY KEY,
        pod_id TEXT NOT NULL,
        goal_id TEXT NOT NULL,
        revision INTEGER NOT NULL,
        status TEXT NOT NULL,
        request_json TEXT NOT NULL,
        report_json TEXT,
        request_path TEXT NOT NULL,
        report_path TEXT,
        error TEXT,
        created_at TEXT NOT NULL,
        started_at TEXT,
        ended_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_pod_probes_pod
        ON pod_probes(pod_id, status, created_at);
      CREATE INDEX IF NOT EXISTS idx_pod_probes_goal
        ON pod_probes(pod_id, goal_id, revision);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_pod_probes_running
        ON pod_probes(pod_id) WHERE status = 'running';
    `);

    this.ensureColumn('pod_messages', 'protocol', 'protocol TEXT');
    this.ensureColumn('pod_messages', 'external_message_id', 'external_message_id TEXT');
    this.ensureColumn('pod_messages', 'parts_json', 'parts_json TEXT');
    this.ensureColumn('pod_messages', 'delivered_at', 'delivered_at TEXT');
    this.ensureColumn('pod_messages', 'delivered_session_id', 'delivered_session_id TEXT');
    this.ensureColumn('pod_a2a_links', 'state', 'state TEXT');
    this.ensureColumn('pod_goals', 'verdict', 'verdict TEXT');
    // Task 3：Goal revision 根指针 + 调度优先级（legacy 行按 DEFAULT 归一为 1/0）。
    this.ensureColumn('pod_goals', 'active_revision', 'active_revision INTEGER NOT NULL DEFAULT 1');
    this.ensureColumn('pod_goals', 'priority', 'priority INTEGER NOT NULL DEFAULT 0');
    this.ensureColumn('pod_tasks', 'acceptance_json', 'acceptance_json TEXT');
    // Task 5：Session Supervisor 作用域元点 + 租约世代（历史行遗留为 null/1）。
    this.ensureColumn('pod_member_sessions', 'scope_kind', 'scope_kind TEXT');
    this.ensureColumn('pod_member_sessions', 'revision', 'revision INTEGER');
    this.ensureColumn('pod_member_sessions', 'generation', 'generation INTEGER NOT NULL DEFAULT 1');
    this.ensureColumn('pod_member_sessions', 'last_active_at', 'last_active_at TEXT');
    this.db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_pod_messages_external
        ON pod_messages(pod_id, external_message_id)
        WHERE external_message_id IS NOT NULL;
    `);
    this.ensureScopeIndexes();
    this.backfillLegacyDeliveries();
    this.backfillLegacyRevisions();
  }

  /**
   * 作用域租约索引（I-1）：
   * - `idx_pod_member_sessions_scope_key`：普通查找索引（含已结束行，世代计算要用）；
   * - `idx_pod_member_sessions_active_scope`：**唯一**部分索引，保证一个精确作用域
   *   最多只有一条活跃租约（单飞只在进程内，这里才是跨实例/跨进程的防线）。
   *
   * 表达式必须与查询谓词逐字一致（COALESCE），否则 SQLite 不会命中索引；
   * `goal_id`/`revision` 为 NULL 时也要能判重，故不能直接用裸列（唯一索引视 NULL 互异）。
   */
  private ensureScopeIndexes(): void {
    // 上一版 Task 5 的裸列普通索引已被表达式索引取代（旧库可能已存在）。
    this.db.exec('DROP INDEX IF EXISTS idx_pod_member_sessions_scope');
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_pod_member_sessions_scope_key
        ON pod_member_sessions(
          pod_id, member_id, COALESCE(goal_id, ''), COALESCE(revision, -1), scope_kind
        )
    `);
    const unique = `
      CREATE UNIQUE INDEX IF NOT EXISTS idx_pod_member_sessions_active_scope
        ON pod_member_sessions(
          pod_id, member_id, COALESCE(goal_id, ''), COALESCE(revision, -1), scope_kind
        )
        WHERE ended_at IS NULL
    `;
    try {
      this.db.exec(unique);
    } catch {
      // 旧库可能已有同作用域的多条活跃租约（索引建立前写入/手工数据）：
      // 保留最高世代、其余收尾后重建，避免 PodStore 构造直接失败。
      this.endDuplicateActiveScopes();
      this.db.exec(unique);
    }
  }

  /** 每个作用域只保留最高世代的活跃租约，其余标记结束（含 ended_at 兜底）。 */
  private endDuplicateActiveScopes(): void {
    this.db.prepare(`
      UPDATE pod_member_sessions
      SET status = 'ended',
          ended_at = COALESCE(ended_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      WHERE ended_at IS NULL
        AND scope_kind IS NOT NULL
        AND rowid NOT IN (
          SELECT rowid FROM (
            SELECT rowid,
                   ROW_NUMBER() OVER (
                     PARTITION BY pod_id, member_id,
                       COALESCE(goal_id, ''), COALESCE(revision, -1), scope_kind
                     ORDER BY generation DESC, created_at DESC, rowid DESC
                   ) AS rank
            FROM pod_member_sessions
            WHERE ended_at IS NULL AND scope_kind IS NOT NULL
          )
          WHERE rank = 1
        )
    `).run();
  }

  /** 作用域谓词参数（goal_id/revision 未传按 NULL 归一，M6）。 */
  private scopeParams(scope: PodSessionScopeKey): [string, string, string | null, number | null, string] {
    return [
      scope.podId,
      scope.memberId,
      scope.goalId ?? null,
      scope.revision ?? null,
      scope.kind,
    ];
  }

  /**
   * I-3：历史 Goal（Task 3 之前入库）没有 revision 行，Task 4 关闭当前 revision
   * 会静默 no-op、历史从 2 开始。这里一次性补齐：每个根 Goal 若缺少
   * `active_revision` 对应的行，就按根 status/verdict/时间戳插入一条（幂等）。
   *
   * 只处理**已存在**的根行；`enqueueGoal` 新建的 Goal 由 intake（后续 Task）
   * 显式创建 revision 1（discussing），避免这里把新 Goal 钉成 queued/implementing。
   */
  private backfillLegacyRevisions(): void {
    const missing = this.db.prepare(`
      SELECT g.* FROM pod_goals g
      LEFT JOIN pod_goal_revisions r
        ON r.pod_id = g.pod_id AND r.goal_id = g.goal_id AND r.revision = g.active_revision
      WHERE r.id IS NULL
    `).all() as any[];
    if (missing.length === 0) return;

    const insert = this.db.prepare(`
      INSERT INTO pod_goal_revisions (
        id, pod_id, goal_id, revision, status, verdict,
        direction_status, direction_json, plan_hash, eval_hash, feedback,
        priority, enqueued_at, started_at, ended_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'none', NULL, NULL, NULL, NULL, ?, ?, ?, ?)
      ON CONFLICT DO NOTHING
    `);
    const runAll = this.db.transaction((rows: any[]) => {
      for (const row of rows) {
        const goal = goalFromRow(row);
        insert.run(
          `goalrev_${goal.goalId}_${goal.activeRevision}`,
          goal.podId,
          goal.goalId,
          goal.activeRevision,
          revisionStatusFromGoalStatus(goal.status),
          goal.verdict,
          goal.priority,
          goal.enqueuedAt,
          goal.startedAt,
          goal.endedAt,
        );
      }
    });
    runAll(missing);
  }

  private backfillLegacyDeliveries(): void {
    // Direct legacy delivery: the delivered session identifies the member.
    this.db.prepare(`
      INSERT OR IGNORE INTO pod_message_deliveries (
        message_id, pod_id, member_id, delivered_at, delivered_session_id, status, attempts
      )
      SELECT m.id, m.pod_id, s.member_id, m.delivered_at, m.delivered_session_id, 'delivered', 0
      FROM pod_messages m
      JOIN pod_member_sessions s ON s.session_id = m.delivered_session_id
      WHERE m.delivered_at IS NOT NULL AND m.to_member_id IS NOT NULL
    `).run();

    // Legacy broadcast delivery had one global stamp. Treat it as delivered to
    // the roster at upgrade time so old broadcasts do not replay.
    this.db.prepare(`
      INSERT OR IGNORE INTO pod_message_deliveries (
        message_id, pod_id, member_id, delivered_at, delivered_session_id, status, attempts
      )
      SELECT m.id, m.pod_id, member.id, m.delivered_at, m.delivered_session_id, 'delivered', 0
      FROM pod_messages m
      JOIN pod_members member ON member.pod_id = m.pod_id
      WHERE m.delivered_at IS NOT NULL AND m.to_member_id IS NULL
    `).run();
  }

  private ensureColumn(table: string, column: string, ddl: string): void {
    const columns = this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (columns.some((item) => item.name === column)) return;
    this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  }

  ensurePod(input: { id: string; projectDir: string; name: string; configJson?: string; now: string }): PodRow {
    const row = this.db.prepare(`
      INSERT INTO project_pods (id, project_dir, name, status, config_json, created_at, updated_at)
      VALUES (?, ?, ?, 'idle', ?, ?, ?)
      ON CONFLICT(project_dir) DO UPDATE SET name = excluded.name, updated_at = excluded.updated_at
      RETURNING *
    `).get(input.id, input.projectDir, input.name, input.configJson ?? '{}', input.now, input.now) as any;
    return podFromRow(row);
  }

  getPod(id: string): PodRow | null {
    const row = this.db.prepare('SELECT * FROM project_pods WHERE id = ?').get(id) as any;
    return row ? podFromRow(row) : null;
  }

  getPodByProject(projectDir: string): PodRow | null {
    const row = this.db.prepare('SELECT * FROM project_pods WHERE project_dir = ?').get(projectDir) as any;
    return row ? podFromRow(row) : null;
  }

  findPodIdByGoal(goalId: string): string | null {
    const row = this.db.prepare(
      'SELECT pod_id FROM pod_goals WHERE goal_id = ? ORDER BY enqueued_at DESC LIMIT 1',
    ).get(goalId) as { pod_id?: string } | undefined;
    return row?.pod_id ?? null;
  }

  listPods(): PodRow[] {
    return (this.db.prepare('SELECT * FROM project_pods ORDER BY created_at ASC').all() as any[]).map(podFromRow);
  }

  updatePod(
    id: string,
    patch: Partial<Pick<PodRow, 'name' | 'status' | 'configJson' | 'activeGoalId'>>,
    now: string,
  ): void {
    const sets: string[] = [];
    const values: any[] = [];
    if (patch.name !== undefined) { sets.push('name = ?'); values.push(patch.name); }
    if (patch.status !== undefined) { sets.push('status = ?'); values.push(patch.status); }
    if (patch.configJson !== undefined) { sets.push('config_json = ?'); values.push(patch.configJson); }
    if (patch.activeGoalId !== undefined) { sets.push('active_goal_id = ?'); values.push(patch.activeGoalId); }
    sets.push('updated_at = ?'); values.push(now, id);
    this.db.prepare(`UPDATE project_pods SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  }

  upsertMember(input: Omit<PodMemberRow, 'createdAt' | 'updatedAt'> & { now: string }): PodMemberRow {
    const row = this.db.prepare(`
      INSERT INTO pod_members (id, pod_id, role, display_name, agent_name, model_provider, model_id, status, config_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(pod_id, role) DO UPDATE SET
        display_name = excluded.display_name,
        agent_name = excluded.agent_name,
        model_provider = excluded.model_provider,
        model_id = excluded.model_id,
        status = excluded.status,
        config_json = excluded.config_json,
        updated_at = excluded.updated_at
      RETURNING *
    `).get(
      input.id, input.podId, input.role, input.displayName, input.agentName,
      input.modelProvider, input.modelId, input.status, input.configJson, input.now, input.now,
    ) as any;
    return memberFromRow(row);
  }

  listMembers(podId: string): PodMemberRow[] {
    return (this.db.prepare(`SELECT * FROM pod_members WHERE pod_id = ? ORDER BY ${ROLE_ORDER}`).all(podId) as any[])
      .map(memberFromRow);
  }

  getMemberByRole(podId: string, role: PodMemberRole): PodMemberRow | null {
    const row = this.db.prepare('SELECT * FROM pod_members WHERE pod_id = ? AND role = ?').get(podId, role) as any;
    return row ? memberFromRow(row) : null;
  }

  getMemberBySession(sessionId: string): PodMemberRow | null {
    const row = this.db.prepare(`
      SELECT m.* FROM pod_members m
      JOIN pod_member_sessions s ON s.member_id = m.id
      WHERE s.session_id = ? AND s.ended_at IS NULL
      ORDER BY s.created_at DESC
      LIMIT 1
    `).get(sessionId) as any;
    return row ? memberFromRow(row) : null;
  }

  enqueueGoal(input: { id: string; podId: string; goalId: string; now: string }): PodGoalRow {
    const existing = this.getGoal(input.podId, input.goalId);
    if (existing) return existing;
    const row = this.db.prepare(`
      INSERT INTO pod_goals (id, pod_id, goal_id, status, enqueued_at)
      VALUES (?, ?, ?, 'queued', ?)
      RETURNING *
    `).get(input.id, input.podId, input.goalId, input.now) as any;
    return goalFromRow(row);
  }

  getGoal(podId: string, goalId: string): PodGoalRow | null {
    const row = this.db.prepare('SELECT * FROM pod_goals WHERE pod_id = ? AND goal_id = ?').get(podId, goalId) as any;
    return row ? goalFromRow(row) : null;
  }

  getGoalByGoalId(goalId: string): PodGoalRow | null {
    const row = this.db.prepare(
      'SELECT * FROM pod_goals WHERE goal_id = ? ORDER BY enqueued_at DESC LIMIT 1',
    ).get(goalId) as any;
    return row ? goalFromRow(row) : null;
  }

  getActiveGoal(podId: string): PodGoalRow | null {
    const row = this.db.prepare(
      "SELECT * FROM pod_goals WHERE pod_id = ? AND status = 'active' ORDER BY started_at ASC LIMIT 1",
    ).get(podId) as any;
    return row ? goalFromRow(row) : null;
  }

  listGoals(podId: string): PodGoalRow[] {
    return (this.db.prepare(
      'SELECT * FROM pod_goals WHERE pod_id = ? ORDER BY enqueued_at ASC',
    ).all(podId) as any[]).map(goalFromRow);
  }

  setGoalStatus(
    id: string,
    status: PodGoalStatus,
    patch: { startedAt?: string; endedAt?: string; verdict?: string | null },
  ): void {
    this.db.prepare(`
      UPDATE pod_goals SET
        status = ?,
        verdict = COALESCE(?, verdict),
        started_at = COALESCE(?, started_at),
        ended_at = COALESCE(?, ended_at)
      WHERE id = ?
    `).run(status, patch.verdict ?? null, patch.startedAt ?? null, patch.endedAt ?? null, id);
  }

  // ── Goal revisions（append-only 打回循环） ───────────────────────────────

  /**
   * 追加一个 revision。已存在的 (podId, goalId, revision) 原样返回——
   * revision 历史 append-only，重试不覆盖已发生的阶段与 verdict。
   * 注意：这里不动根 `active_revision`；切当前 revision 走 `setActiveRevision`。
   */
  createGoalRevision(input: {
    id?: string;
    podId: string;
    goalId: string;
    revision: number;
    status: PodGoalRevisionStatus;
    verdict?: string | null;
    directionStatus?: PodGoalDirectionStatus;
    directionJson?: string | null;
    planHash?: string | null;
    evalHash?: string | null;
    feedback?: string | null;
    priority?: number;
    enqueuedAt?: string;
    startedAt?: string | null;
    endedAt?: string | null;
    now: string;
  }): PodGoalRevisionRow {
    const existing = this.getGoalRevision(input.podId, input.goalId, input.revision);
    if (existing) return existing;
    const id = input.id ?? `goalrev_${input.goalId}_${input.revision}`;
    const row = this.db.prepare(`
      INSERT INTO pod_goal_revisions (
        id, pod_id, goal_id, revision, status, verdict,
        direction_status, direction_json, plan_hash, eval_hash, feedback,
        priority, enqueued_at, started_at, ended_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      RETURNING *
    `).get(
      id, input.podId, input.goalId, input.revision, input.status, input.verdict ?? null,
      input.directionStatus ?? 'none', input.directionJson ?? null,
      input.planHash ?? null, input.evalHash ?? null, input.feedback ?? null,
      input.priority ?? 0, input.enqueuedAt ?? input.now,
      input.startedAt ?? null, input.endedAt ?? null,
    ) as any;
    return goalRevisionFromRow(row);
  }

  getGoalRevision(podId: string, goalId: string, revision: number): PodGoalRevisionRow | null {
    const row = this.db.prepare(
      'SELECT * FROM pod_goal_revisions WHERE pod_id = ? AND goal_id = ? AND revision = ?',
    ).get(podId, goalId, revision) as any;
    return row ? goalRevisionFromRow(row) : null;
  }

  listGoalRevisions(podId: string, goalId: string): PodGoalRevisionRow[] {
    return (this.db.prepare(
      'SELECT * FROM pod_goal_revisions WHERE pod_id = ? AND goal_id = ? ORDER BY revision ASC',
    ).all(podId, goalId) as any[]).map(goalRevisionFromRow);
  }

  /**
   * 排队中的 revision：优先级高的先跑，同优先级按入队时间（打回 Goal 抢先）。
   *
   * 打回（reject）开出的 revision 仍是 `discussing`——Tech Lead 讨论不占实施槽
   * （spec §8.3），但它已经带上了打回优先级，必须在同一个调度视图里排在普通
   * queued revision 之前。没有优先级的讨论版不进入队列（只是普通讨论）。
   */
  listQueuedGoalRevisions(podId: string): PodGoalRevisionRow[] {
    return (this.db.prepare(
      `SELECT * FROM pod_goal_revisions
       WHERE pod_id = ? AND (status = 'queued' OR (status = 'discussing' AND priority > 0))
       ORDER BY priority DESC, enqueued_at ASC, revision ASC`,
    ).all(podId) as any[]).map(goalRevisionFromRow);
  }

  /**
   * 更新 revision 阶段。COALESCE 语义：未传的字段保持原值（含旧 verdict）；
   * 进入 implementing/reviewing 首次盖章 started_at，终态盖章 ended_at。
   *
   * 终态（completed / aborted / discarded）**不可改写**：review 打回必须走
   * `createGoalRevision` 追加下一 revision，绝不能把已 PASS 的 revision 改回
   * queued/FAIL（旧 revision 永远保持真实 verdict）。被拒绝或 revision 不存在
   * 时返回 `false`，调用方（Task 4 finishRevision）应视为「未变更」。
   */
  setGoalRevisionStatus(input: {
    podId: string;
    goalId: string;
    revision: number;
    status: PodGoalRevisionStatus;
    now: string;
    verdict?: string | null;
    directionStatus?: PodGoalDirectionStatus;
    directionJson?: string | null;
    planHash?: string | null;
    evalHash?: string | null;
    feedback?: string | null;
  }): boolean {
    const existing = this.getGoalRevision(input.podId, input.goalId, input.revision);
    if (!existing) return false;
    if (isTerminalGoalRevisionStatus(existing.status)) return false;
    const startsWork = input.status === 'implementing' || input.status === 'reviewing';
    const isTerminal = isTerminalGoalRevisionStatus(input.status);
    const result = this.db.prepare(`
      UPDATE pod_goal_revisions SET
        status = ?,
        verdict = COALESCE(?, verdict),
        direction_status = COALESCE(?, direction_status),
        direction_json = COALESCE(?, direction_json),
        plan_hash = COALESCE(?, plan_hash),
        eval_hash = COALESCE(?, eval_hash),
        feedback = COALESCE(?, feedback),
        started_at = COALESCE(started_at, ?),
        ended_at = COALESCE(?, ended_at)
      WHERE pod_id = ? AND goal_id = ? AND revision = ?
    `).run(
      input.status,
      input.verdict ?? null,
      input.directionStatus ?? null,
      input.directionJson ?? null,
      input.planHash ?? null,
      input.evalHash ?? null,
      input.feedback ?? null,
      startsWork ? input.now : null,
      isTerminal ? input.now : null,
      input.podId, input.goalId, input.revision,
    );
    return result.changes > 0;
  }

  /** 把 Goal 根指针切到指定 revision（旧 revision 行原样保留）。 */
  setActiveRevision(podId: string, goalId: string, revision: number): void {
    this.db.prepare(
      'UPDATE pod_goals SET active_revision = ? WHERE pod_id = ? AND goal_id = ?',
    ).run(revision, podId, goalId);
  }

  /**
   * 只更新方向镜像，**不改 revision 阶段**（打回反馈这类「方向决定的输入」不能
   * 把 discussing 推成 planning）。终态 revision 拒绝写入（append-only）。
   */
  setGoalRevisionDirection(input: {
    podId: string;
    goalId: string;
    revision: number;
    directionJson: string;
    directionStatus?: PodGoalDirectionStatus;
  }): boolean {
    const existing = this.getGoalRevision(input.podId, input.goalId, input.revision);
    if (!existing || isTerminalGoalRevisionStatus(existing.status)) return false;
    const result = this.db.prepare(`
      UPDATE pod_goal_revisions SET
        direction_json = ?,
        direction_status = COALESCE(?, direction_status)
      WHERE pod_id = ? AND goal_id = ? AND revision = ?
    `).run(
      input.directionJson,
      input.directionStatus ?? null,
      input.podId, input.goalId, input.revision,
    );
    return result.changes > 0;
  }

  /**
   * 打回重开：Goal 根记录回到进行中（清掉旧的终态 verdict / ended_at，否则旧
   * PASS 会冒充新 revision 的结果），revision 指针由 `setActiveRevision` 先行推进。
   * 旧 revision 行与 state 快照一律不动——「重开」不是撤销归档。
   */
  reopenGoal(podId: string, goalId: string, input: { status: PodGoalStatus; now: string }): void {
    this.db.prepare(`
      UPDATE pod_goals SET
        status = ?,
        verdict = NULL,
        ended_at = NULL,
        started_at = COALESCE(started_at, ?)
      WHERE pod_id = ? AND goal_id = ?
    `).run(input.status, input.now, podId, goalId);
  }

  /** 下一个 revision 号：max(已有 revision, 根 active_revision) + 1（legacy 从 2 开始）。 */
  nextGoalRevision(podId: string, goalId: string): number {
    const row = this.db.prepare(
      'SELECT COALESCE(MAX(revision), 0) AS max_revision FROM pod_goal_revisions WHERE pod_id = ? AND goal_id = ?',
    ).get(podId, goalId) as { max_revision?: number } | undefined;
    const goal = this.getGoal(podId, goalId);
    const highest = Math.max(Number(row?.max_revision ?? 0), goal?.activeRevision ?? 1);
    return highest + 1;
  }

  /** Goal 级调度优先级（打回 Goal 抢先于普通 queued Goal）。 */
  setGoalPriority(podId: string, goalId: string, priority: number): void {
    this.db.prepare(
      'UPDATE pod_goals SET priority = ? WHERE pod_id = ? AND goal_id = ?',
    ).run(priority, podId, goalId);
  }

  upsertTask(
    input: Omit<PodTaskRow, 'createdAt' | 'updatedAt' | 'acceptanceJson'>
      & { acceptanceJson?: string | null; now: string },
  ): PodTaskRow {
    const row = this.db.prepare(`
      INSERT INTO pod_tasks (
        id, pod_id, goal_id, source_key, external_task_id, title, description,
        owner_member_id, status, dependencies_json, artifact_refs_json, acceptance_json,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(pod_id, goal_id, source_key) DO UPDATE SET
        goal_id = excluded.goal_id,
        external_task_id = excluded.external_task_id,
        title = excluded.title,
        description = excluded.description,
        acceptance_json = excluded.acceptance_json,
        updated_at = excluded.updated_at
      RETURNING *
    `).get(
      input.id, input.podId, input.goalId, input.sourceKey, input.externalTaskId,
      input.title, input.description, input.ownerMemberId, input.status,
      input.dependenciesJson, input.artifactRefsJson, input.acceptanceJson ?? null,
      input.now, input.now,
    ) as any;
    return taskFromRow(row);
  }

  getTask(id: string): PodTaskRow | null {
    const row = this.db.prepare('SELECT * FROM pod_tasks WHERE id = ?').get(id) as any;
    return row ? taskFromRow(row) : null;
  }

  getTaskBySourceKey(podId: string, sourceKey: string): PodTaskRow | null {
    const row = this.db.prepare(
      'SELECT * FROM pod_tasks WHERE pod_id = ? AND source_key = ?',
    ).get(podId, sourceKey) as any;
    return row ? taskFromRow(row) : null;
  }

  listTasks(podId: string, goalId?: string): PodTaskRow[] {
    const rows = goalId
      ? this.db.prepare('SELECT * FROM pod_tasks WHERE pod_id = ? AND goal_id = ? ORDER BY created_at ASC').all(podId, goalId)
      : this.db.prepare('SELECT * FROM pod_tasks WHERE pod_id = ? ORDER BY created_at ASC').all(podId);
    return (rows as any[]).map(taskFromRow);
  }

  deleteProjectedTasks(podId: string, goalId: string): number {
    const result = this.db.prepare(
      "DELETE FROM pod_tasks WHERE pod_id = ? AND goal_id = ? AND source_key LIKE 'wave:%'",
    ).run(podId, goalId);
    return result.changes;
  }

  updateTask(
    id: string,
    patch: Partial<Pick<PodTaskRow, 'title' | 'description' | 'ownerMemberId' | 'status' | 'artifactRefsJson' | 'dependenciesJson' | 'acceptanceJson'>>,
    now: string,
  ): void {
    const sets: string[] = [];
    const values: any[] = [];
    if (patch.title !== undefined) { sets.push('title = ?'); values.push(patch.title); }
    if (patch.description !== undefined) { sets.push('description = ?'); values.push(patch.description); }
    if (patch.ownerMemberId !== undefined) { sets.push('owner_member_id = ?'); values.push(patch.ownerMemberId); }
    if (patch.status !== undefined) { sets.push('status = ?'); values.push(patch.status); }
    if (patch.artifactRefsJson !== undefined) { sets.push('artifact_refs_json = ?'); values.push(patch.artifactRefsJson); }
    if (patch.dependenciesJson !== undefined) { sets.push('dependencies_json = ?'); values.push(patch.dependenciesJson); }
    if (patch.acceptanceJson !== undefined) { sets.push('acceptance_json = ?'); values.push(patch.acceptanceJson); }
    sets.push('updated_at = ?'); values.push(now, id);
    this.db.prepare(`UPDATE pod_tasks SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  }

  updateTaskSourceKey(id: string, sourceKey: string): void {
    this.db.prepare('UPDATE pod_tasks SET source_key = ? WHERE id = ?').run(sourceKey, id);
  }

  deleteTask(id: string): boolean {
    return this.db.prepare('DELETE FROM pod_tasks WHERE id = ?').run(id).changes > 0;
  }

  insertMessage(input: Omit<PodMessageRow, 'createdAt' | 'readAt' | 'protocol' | 'externalMessageId' | 'partsJson' | 'deliveredAt' | 'deliveredSessionId'> & {
    protocol?: string | null;
    externalMessageId?: string | null;
    partsJson?: string | null;
    now: string;
  }): PodMessageRow {
    const row = this.db.prepare(`
      INSERT INTO pod_messages (
        id, pod_id, from_member_id, to_member_id, kind, body,
        protocol, external_message_id, parts_json, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      RETURNING *
    `).get(
      input.id, input.podId, input.fromMemberId, input.toMemberId,
      input.kind, input.body, input.protocol ?? null,
      input.externalMessageId ?? null, input.partsJson ?? null, input.now,
    ) as any;
    return messageFromRow(row);
  }

  markMessageDelivered(id: string, sessionId: string, now: string): void {
    this.db.prepare(
      'UPDATE pod_messages SET delivered_at = ?, delivered_session_id = ? WHERE id = ?',
    ).run(now, sessionId, id);
  }

  hasDelivery(messageId: string, memberId: string): boolean {
    const row = this.db.prepare(
      "SELECT 1 FROM pod_message_deliveries WHERE message_id = ? AND member_id = ? AND status = 'delivered' AND delivered_at IS NOT NULL",
    ).get(messageId, memberId);
    return !!row;
  }

  markDeliveryDelivered(messageId: string, memberId: string, sessionId: string, now: string): void {
    this.upsertDelivery(messageId, memberId, {
      deliveredAt: now,
      deliveredSessionId: sessionId,
      status: 'delivered',
      lastError: null,
      nextRetryAt: null,
    });
  }

  markDeliveryFailed(messageId: string, memberId: string, error: string, now: string): void {
    const message = this.getMessage(messageId);
    if (!message) return;
    const current = this.db.prepare(
      'SELECT * FROM pod_message_deliveries WHERE message_id = ? AND member_id = ?',
    ).get(messageId, memberId) as any;
    const attempts = Number(current?.attempts ?? 0) + 1;
    this.upsertDelivery(messageId, memberId, {
      deliveredAt: null,
      deliveredSessionId: null,
      status: 'failed',
      attempts,
      lastError: error.slice(0, 500),
      nextRetryAt: now,
    }, message.podId);
  }

  dismissDeliveryFailure(messageId: string, memberId: string): boolean {
    return this.db.prepare(
      "DELETE FROM pod_message_deliveries WHERE message_id = ? AND member_id = ? AND status = 'failed'",
    ).run(messageId, memberId).changes > 0;
  }

  listDeliveryFailures(podId: string): PodMessageDeliveryRow[] {
    return (this.db.prepare(
      "SELECT * FROM pod_message_deliveries WHERE pod_id = ? AND status = 'failed' ORDER BY next_retry_at ASC, message_id ASC",
    ).all(podId) as any[]).map(deliveryFromRow);
  }

  private upsertDelivery(
    messageId: string,
    memberId: string,
    patch: {
      deliveredAt: string | null;
      deliveredSessionId: string | null;
      status: PodMessageDeliveryRow['status'];
      attempts?: number;
      lastError: string | null;
      nextRetryAt: string | null;
    },
    podId?: string,
  ): void {
    const message = podId ? null : this.getMessage(messageId);
    const resolvedPodId = podId ?? message?.podId;
    if (!resolvedPodId) return;
    this.db.prepare(`
      INSERT INTO pod_message_deliveries (
        message_id, pod_id, member_id, delivered_at, delivered_session_id,
        status, attempts, last_error, next_retry_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(message_id, member_id) DO UPDATE SET
        delivered_at = excluded.delivered_at,
        delivered_session_id = excluded.delivered_session_id,
        status = excluded.status,
        attempts = COALESCE(excluded.attempts, pod_message_deliveries.attempts),
        last_error = excluded.last_error,
        next_retry_at = excluded.next_retry_at
    `).run(
      messageId, resolvedPodId, memberId, patch.deliveredAt, patch.deliveredSessionId,
      patch.status, patch.attempts ?? 0, patch.lastError, patch.nextRetryAt,
    );
  }

  linkA2A(input: {
    id: string;
    podId: string;
    localKind: 'task' | 'message';
    localId: string;
    a2aId: string;
    contextId?: string | null;
    state?: string | null;
    now: string;
  }): void {
    this.db.prepare(`
      INSERT OR IGNORE INTO pod_a2a_links (
        id, pod_id, local_kind, local_id, a2a_id, context_id, state, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.id, input.podId, input.localKind, input.localId,
      input.a2aId, input.contextId ?? null, input.state ?? null, input.now,
    );
  }

  setA2AState(podId: string, localKind: 'task' | 'message', localId: string, state: string): void {
    this.db.prepare(
      'UPDATE pod_a2a_links SET state = ? WHERE pod_id = ? AND local_kind = ? AND local_id = ?',
    ).run(state, podId, localKind, localId);
  }

  getA2ALink(podId: string, localKind: 'task' | 'message', localId: string): PodA2ALinkRow | null {
    const row = this.db.prepare(
      'SELECT * FROM pod_a2a_links WHERE pod_id = ? AND local_kind = ? AND local_id = ?',
    ).get(podId, localKind, localId) as any;
    return row ? a2aLinkFromRow(row) : null;
  }

  getA2ALocalId(podId: string, localKind: 'task' | 'message', a2aId: string): string | null {
    const row = this.db.prepare(
      'SELECT * FROM pod_a2a_links WHERE pod_id = ? AND local_kind = ? AND a2a_id = ?',
    ).get(podId, localKind, a2aId) as any;
    return row ? row.local_id : null;
  }

  listA2ALinks(podId: string, localKind?: 'task' | 'message'): PodA2ALinkRow[] {
    const rows = localKind
      ? this.db.prepare('SELECT * FROM pod_a2a_links WHERE pod_id = ? AND local_kind = ? ORDER BY created_at').all(podId, localKind)
      : this.db.prepare('SELECT * FROM pod_a2a_links WHERE pod_id = ? ORDER BY created_at').all(podId);
    return (rows as any[]).map(a2aLinkFromRow);
  }

  listMessages(podId: string, limit = 100): PodMessageRow[] {
    return (this.db.prepare(
      'SELECT * FROM pod_messages WHERE pod_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?',
    ).all(podId, limit) as any[]).map(messageFromRow);
  }

  getMessage(id: string): PodMessageRow | null {
    const row = this.db.prepare('SELECT * FROM pod_messages WHERE id = ?').get(id) as any;
    return row ? messageFromRow(row) : null;
  }

  getMessageByExternalId(podId: string, externalId: string): PodMessageRow | null {
    const row = this.db.prepare(
      'SELECT * FROM pod_messages WHERE pod_id = ? AND external_message_id = ?',
    ).get(podId, externalId) as any;
    return row ? messageFromRow(row) : null;
  }

  listPendingMessages(podId: string, memberId: string): PodMessageRow[] {
    return (this.db.prepare(`
      SELECT m.* FROM pod_messages m
      LEFT JOIN pod_message_deliveries d
        ON d.message_id = m.id AND d.member_id = ? AND d.status = 'delivered' AND d.delivered_at IS NOT NULL
      WHERE m.pod_id = ? AND d.message_id IS NULL
        AND (m.to_member_id = ? OR m.to_member_id IS NULL)
      ORDER BY m.created_at ASC, m.rowid ASC
    `).all(memberId, podId, memberId) as any[]).map(messageFromRow);
  }

  markMessageRead(id: string, now: string): void {
    this.db.prepare('UPDATE pod_messages SET read_at = ? WHERE id = ?').run(now, id);
  }

  // ── Probes（spike 请求 / 报告 + 每 Pod 单运行槽）─────────────────────────

  insertProbe(input: {
    id: string;
    podId: string;
    goalId: string;
    revision: number;
    requestJson: string;
    requestPath: string;
    createdAt: string;
  }): PodProbeRow {
    try {
      const row = this.db.prepare(`
        INSERT INTO pod_probes (
          id, pod_id, goal_id, revision, status, request_json, request_path, created_at
        ) VALUES (?, ?, ?, ?, 'queued', ?, ?, ?)
        RETURNING *
      `).get(
        input.id, input.podId, input.goalId, input.revision,
        input.requestJson, input.requestPath, input.createdAt,
      ) as any;
      return probeFromRow(row);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('UNIQUE') || message.includes('PRIMARY KEY')) {
        throw new PodError(409, `probe already exists: ${input.id}`);
      }
      throw error;
    }
  }

  getProbe(id: string): PodProbeRow | null {
    const row = this.db.prepare('SELECT * FROM pod_probes WHERE id = ?').get(id) as any;
    return row ? probeFromRow(row) : null;
  }

  listProbes(
    podId: string,
    filter: { goalId?: string; revision?: number; status?: ProbeStatus } = {},
  ): PodProbeRow[] {
    const sets = ['pod_id = ?'];
    const values: any[] = [podId];
    if (filter.goalId !== undefined) { sets.push('goal_id = ?'); values.push(filter.goalId); }
    if (filter.revision !== undefined) { sets.push('revision = ?'); values.push(filter.revision); }
    if (filter.status !== undefined) { sets.push('status = ?'); values.push(filter.status); }
    return (this.db.prepare(
      `SELECT * FROM pod_probes WHERE ${sets.join(' AND ')} ORDER BY created_at ASC, rowid ASC`,
    ).all(...values) as any[]).map(probeFromRow);
  }

  getRunningProbe(podId: string): PodProbeRow | null {
    const row = this.db.prepare(
      "SELECT * FROM pod_probes WHERE pod_id = ? AND status = 'running'",
    ).get(podId) as any;
    return row ? probeFromRow(row) : null;
  }

  /**
   * 抢占下一个排队探针（原子）：检查 + 读取 + 置 running 在同一事务内，
   * 另有唯一部分索引 `idx_pod_probes_running` 兜底跨进程并发。
   * 已有 running 时返回 null（每 Pod 同时最多一个 Spike，spec §6.5）。
   */
  claimNextProbe(podId: string, now: string): PodProbeRow | null {
    const claim = this.db.transaction(() => {
      const running = this.db.prepare(
        "SELECT id FROM pod_probes WHERE pod_id = ? AND status = 'running' LIMIT 1",
      ).get(podId);
      if (running) return null;
      const next = this.db.prepare(`
        SELECT * FROM pod_probes
        WHERE pod_id = ? AND status = 'queued'
        ORDER BY created_at ASC, rowid ASC
        LIMIT 1
      `).get(podId) as any;
      if (!next) return null;
      const updated = this.db.prepare(`
        UPDATE pod_probes SET status = 'running', started_at = ?
        WHERE id = ? AND status = 'queued'
        RETURNING *
      `).get(now, next.id) as any;
      return updated ? probeFromRow(updated) : null;
    });
    try {
      return claim();
    } catch (error) {
      // 唯一部分索引兜底跨进程并发：另一个实例先抢到运行槽，本实例视作「已被占用」。
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('UNIQUE') || message.includes('idx_pod_probes_running')) return null;
      throw error;
    }
  }

  /**
   * 按 id 抢占（调用方已确认它是 Pod-global 排队头）。
   * 同一事务内复核「Pod 无 running + 该行仍是 queued」——绝不把另一个 goal 的
   * 探针标成 running 后又丢弃（那会永久占住 Pod 的唯一运行槽）。
   */
  claimProbe(id: string, now: string): PodProbeRow | null {
    const claim = this.db.transaction(() => {
      const row = this.db.prepare(
        "SELECT * FROM pod_probes WHERE id = ? AND status = 'queued'",
      ).get(id) as any;
      if (!row) return null;
      const running = this.db.prepare(
        "SELECT id FROM pod_probes WHERE pod_id = ? AND status = 'running' LIMIT 1",
      ).get(row.pod_id);
      if (running) return null;
      const updated = this.db.prepare(`
        UPDATE pod_probes SET status = 'running', started_at = ?
        WHERE id = ? AND status = 'queued'
        RETURNING *
      `).get(now, id) as any;
      return updated ? probeFromRow(updated) : null;
    });
    try {
      return claim();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('UNIQUE') || message.includes('idx_pod_probes_running')) return null;
      throw error;
    }
  }

  /** completed：允许对该探针重放报告（A2A 传输重试），不允许覆盖 cancelled。 */
  completeProbe(id: string, input: { reportJson: string; reportPath: string; now: string }): PodProbeRow | null {
    const row = this.db.prepare(`
      UPDATE pod_probes SET
        status = 'completed',
        report_json = ?,
        report_path = ?,
        error = NULL,
        started_at = COALESCE(started_at, ?),
        ended_at = COALESCE(ended_at, ?)
      WHERE id = ? AND status IN ('queued', 'running', 'completed', 'failed')
      RETURNING *
    `).get(input.reportJson, input.reportPath, input.now, input.now, id) as any;
    return row ? probeFromRow(row) : null;
  }

  /**
   * 可重试的探针失败：把 running 退回 queued（释放运行槽，下一轮 claim 还能取回同一条）。
   * 只允许 running（queued/failed/completed/cancelled 不动）。
   */
  requeueProbe(id: string, now: string): PodProbeRow | null {
    const row = this.db.prepare(`
      UPDATE pod_probes SET
        status = 'queued',
        started_at = NULL,
        error = NULL
      WHERE id = ? AND status = 'running'
      RETURNING *
    `).get(id) as any;
    return row ? probeFromRow(row) : null;
  }

  /** failed：清理运行槽（completed/cancelled 不可再标失败）。 */
  failProbe(id: string, input: { error: string; now: string }): PodProbeRow | null {
    const row = this.db.prepare(`
      UPDATE pod_probes SET
        status = 'failed',
        error = ?,
        started_at = COALESCE(started_at, ?),
        ended_at = ?
      WHERE id = ? AND status IN ('queued', 'running', 'failed')
      RETURNING *
    `).get(input.error, input.now, input.now, id) as any;
    return row ? probeFromRow(row) : null;
  }

  insertSession(
    input: Omit<
      PodSessionRow,
      'createdAt' | 'endedAt' | 'scopeKind' | 'revision' | 'generation' | 'lastActiveAt'
    > & {
      scopeKind?: PodSessionScopeKind | null;
      revision?: number | null;
      generation?: number;
      lastActiveAt?: string | null;
      now: string;
    },
  ): PodSessionRow {
    this.db.prepare(`
      INSERT OR IGNORE INTO pod_member_sessions (
        id, pod_id, member_id, goal_id, node, session_id, status, transcript_ref,
        scope_kind, revision, generation, last_active_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.id, input.podId, input.memberId, input.goalId, input.node,
      input.sessionId, input.status, input.transcriptRef,
      input.scopeKind ?? null, input.revision ?? null,
      input.generation ?? 1, input.lastActiveAt ?? null, input.now,
    );
    const row = this.db.prepare('SELECT * FROM pod_member_sessions WHERE session_id = ?').get(input.sessionId) as any;
    if (!row) {
      // INSERT OR IGNORE 吞掉了约束（例如作用域唯一索引/其它冲突）且没有本行：
      // 明确报错，别把 undefined 当行返回（review I-1）。
      throw new PodError(409, `session insert was ignored: ${input.sessionId}`);
    }
    return sessionFromRow(row);
  }

  /**
   * 原子租约插入（review I-1）：世代读取 + INSERT 在同一事务里，跨实例并发时由
   * 唯一活跃作用域索引兜底——冲突会抛 SQLite 约束错误，调用方重读赢家后复用。
   */
  leaseScopedSession(input: {
    id: string;
    scope: PodSessionScopeKey;
    sessionId: string;
    now: string;
  }): PodSessionRow {
    const lease = this.db.transaction(() => {
      const generation = this.getScopedGeneration(input.scope) + 1;
      const [podId, memberId, goalId, revision, kind] = this.scopeParams(input.scope);
      const row = this.db.prepare(`
        INSERT INTO pod_member_sessions (
          id, pod_id, member_id, goal_id, node, session_id, status, transcript_ref,
          scope_kind, revision, generation, last_active_at, created_at
        ) VALUES (?, ?, ?, ?, NULL, ?, 'active', NULL, ?, ?, ?, ?, ?)
        RETURNING *
      `).get(
        input.id, podId, memberId, goalId, input.sessionId,
        kind, revision, generation, input.now, input.now,
      ) as any;
      return sessionFromRow(row);
    });
    return lease();
  }

  /**
   * 精确作用域的活跃租约（null goal/revision 按 NULL 匹配）。
   * 查询谓词与 `idx_pod_member_sessions_active_scope` 表达式逐字一致（索引可用）。
   */
  getActiveScopedSession(scope: PodSessionScopeKey): PodSessionRow | null {
    const [podId, memberId, goalId, revision, kind] = this.scopeParams(scope);
    const row = this.db.prepare(`
      SELECT * FROM pod_member_sessions
      WHERE pod_id = ? AND member_id = ?
        AND COALESCE(goal_id, '') = COALESCE(?, '')
        AND COALESCE(revision, -1) = COALESCE(?, -1)
        AND scope_kind = ?
        AND ended_at IS NULL
      ORDER BY generation DESC, created_at DESC
      LIMIT 1
    `).get(podId, memberId, goalId, revision, kind) as any;
    return row ? sessionFromRow(row) : null;
  }

  /** 该作用域已用过的最高世代（含已结束行）；0 = 从未建过。 */
  getScopedGeneration(scope: PodSessionScopeKey): number {
    const [podId, memberId, goalId, revision, kind] = this.scopeParams(scope);
    const row = this.db.prepare(`
      SELECT COALESCE(MAX(generation), 0) AS max_generation FROM pod_member_sessions
      WHERE pod_id = ? AND member_id = ?
        AND COALESCE(goal_id, '') = COALESCE(?, '')
        AND COALESCE(revision, -1) = COALESCE(?, -1)
        AND scope_kind = ?
    `).get(podId, memberId, goalId, revision, kind) as { max_generation?: number } | undefined;
    return Number(row?.max_generation ?? 0);
  }

  /** 存活确认：只有 `ensure` 命中存活租约时盖时间戳（`current` 只读不盖，M4）。 */
  touchSession(sessionId: string, now: string): void {
    this.db.prepare(
      'UPDATE pod_member_sessions SET last_active_at = ? WHERE session_id = ? AND ended_at IS NULL',
    ).run(now, sessionId);
  }

  listSessions(podId: string): PodSessionRow[] {
    return (this.db.prepare(
      'SELECT * FROM pod_member_sessions WHERE pod_id = ? ORDER BY created_at DESC',
    ).all(podId) as any[]).map(sessionFromRow);
  }

  getSessionBySessionId(sessionId: string): PodSessionRow | null {
    const row = this.db.prepare(
      'SELECT * FROM pod_member_sessions WHERE session_id = ?',
    ).get(sessionId) as any;
    return row ? sessionFromRow(row) : null;
  }

  listActiveSessions(podId: string): PodSessionRow[] {
    return (this.db.prepare(
      'SELECT * FROM pod_member_sessions WHERE pod_id = ? AND ended_at IS NULL ORDER BY created_at DESC',
    ).all(podId) as any[]).map(sessionFromRow);
  }

  listActiveScopedSessions(): PodSessionRow[] {
    return (this.db.prepare(
      'SELECT * FROM pod_member_sessions WHERE ended_at IS NULL AND scope_kind IS NOT NULL ORDER BY created_at ASC',
    ).all() as any[]).map(sessionFromRow);
  }

  endSession(sessionId: string, now: string): void {
    this.db.prepare(
      "UPDATE pod_member_sessions SET ended_at = ?, status = 'ended' WHERE session_id = ?",
    ).run(now, sessionId);
  }

  /** Reuse the same runtime session id after its previous Pod binding ended. */
  reactivateSession(sessionId: string, now: string): PodSessionRow | null {
    this.db.prepare(`
      UPDATE pod_member_sessions
      SET ended_at = NULL, status = 'active', last_active_at = ?
      WHERE session_id = ?
      RETURNING *
    `).run(now, sessionId);
    const row = this.db.prepare('SELECT * FROM pod_member_sessions WHERE session_id = ?').get(sessionId) as any;
    return row ? sessionFromRow(row) : null;
  }

  setSessionTranscriptRef(sessionId: string, path: string, _now: string): void {
    this.db.prepare(
      'UPDATE pod_member_sessions SET transcript_ref = ? WHERE session_id = ?',
    ).run(path, sessionId);
  }

  insertSnapshot(input: {
    id: string; podId: string; memberId: string; goalId: string | null;
    node: string | null; sessionId: string; path: string; now: string;
  }): void {
    this.db.prepare(`
      INSERT INTO pod_session_snapshots (id, pod_id, member_id, goal_id, node, session_id, path, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id) DO UPDATE SET path = excluded.path, created_at = excluded.created_at
    `).run(
      input.id, input.podId, input.memberId, input.goalId, input.node,
      input.sessionId, input.path, input.now,
    );
  }

  getSnapshot(sessionId: string): { path: string } | null {
    const row = this.db.prepare(
      'SELECT path FROM pod_session_snapshots WHERE session_id = ?',
    ).get(sessionId) as { path?: string } | undefined;
    return row?.path ? { path: row.path } : null;
  }

  getSnapshotForPod(podId: string, sessionId: string): { path: string } | null {
    const row = this.db.prepare(
      'SELECT path FROM pod_session_snapshots WHERE pod_id = ? AND session_id = ?',
    ).get(podId, sessionId) as { path?: string } | undefined;
    return row?.path ? { path: row.path } : null;
  }

  listSessionIds(podId: string, _sinceEpoch: number): string[] {
    return (this.db.prepare(
      "SELECT DISTINCT session_id FROM pod_member_sessions WHERE pod_id = ? AND COALESCE(node, '') <> 'coordination' ORDER BY session_id",
    ).all(podId) as Array<{ session_id: string }>).map((r) => r.session_id);
  }
}
