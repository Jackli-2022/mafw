/**
 * api-contract：catalog 可达性守卫 + 契约产物新鲜度。
 *
 * A. 可达性守卫（E3-1）——catalog 每个 op 必须**可达**，满足其一：
 *    1. attached：gateway 源码里有 `attachHandler('<id>')` 字面量（含动态 attach：
 *       `for (const op of [...])` / `for (const op of CONST_ARRAY)`；
 *       以及 `attachTypedRoute({ operationId: '<id>' })`）。
 *    2. TRANSPORT_ALLOWLIST：由 `http/transport.ts` 手写分支服务（A2A、/register、
 *       /control、/health、file-history），不进 registry。
 *    3. DASHBOARD_RESIDUE_ALLOWLIST：由 `subsystems/dashboard-legacy.ts` 的
 *       `/api/goals|/api/stats|/api/memory` 兜底服务（R5 保留的旧形状）——E3 fix
 *       删除了最后两个误登记项（goals.loops/loopsAt），名单现为空。
 *    4. RUNTIME_PROXY_ALLOWLIST：反代到 runtime serve 的端点（无 gateway handler）。
 *    每条 allowlist 必须带一句人话 reason；名单只减不增（op 一旦 attach，条目必须移除）。
 *
 * B. 新鲜度 —— contract/openapi.json 的 paths/operationId 必须与 catalog 重新生成的
 *    结果一致，防 catalog 改了忘跑 emit:openapi（陈旧产物）。
 *
 * 用法：npx jest tests/unit/api-contract.test.ts
 * 新增 gateway 路由：登记进 route-catalog.ts → attach handler → npm run emit:openapi
 * → (sdk) merge-contract/gen:api。
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { Value } from '@sinclair/typebox/value';
import { RouteRegistry } from '../../src/routes/registry';
import { buildRouteCatalog } from '../../src/routes/route-catalog';
import { KernelStatsResponse } from '../../src/routes/schemas/resources';
import { buildKernelStatsSnapshot, type KernelStatsInput } from '../../src/resources/stats';
import { AttentionListResponse, DecisionListResponse } from '../../src/routes/schemas/read-models';
import {
  SessionCheckpointsResponse,
  SessionChildrenResponse,
  SessionConfigResponse,
  SessionDiffResponse,
  SessionQueueListResponse,
  SessionSubagentsResponse,
  SessionTodoResponse,
  SessionTokenSummaryResponse,
} from '../../src/routes/schemas/session-read';
import {
  PodCostResponse,
  PodEventsResponse,
  PodGoalResultResponse,
  PodGoalRevisionsResponse,
  PodGoalsResponse,
  PodMessagesResponse,
  PodProbesResponse,
  PodReviewItemsResponse,
  PodTasksResponse,
  PodTechLeadHistoryResponse,
  PodTranscriptResponse,
  PodWorktreeDiffResponse,
} from '../../src/routes/schemas/pods';
import {
  GoalListResponse,
  GoalPlanResponse,
  GoalSessionsResponse,
  GoalSourceResponse,
  GoalTimelineResponse,
} from '../../src/routes/schemas/goals';
import { MemoryGetResponse, MemorySearchResponse } from '../../src/routes/schemas/memory';
import {
  RecallContextResponse,
  RecallInstructionsResponse,
  RecallPinnedResponse,
  RecallPriorsResponse,
} from '../../src/routes/schemas/recall';
import { LeadContextResponse, LeadRecallResponse, LeadWorkingSetResponse } from '../../src/routes/schemas/lead';
import {
  MemoryEnergyDistributionResponse,
  MemoryL5AxiomsResponse,
  MemoryMergedSearchResponse,
  MemoryStickyResponse,
} from '../../src/routes/schemas/memory-extra';
import {
  AllowlistListResponse,
  ApprovalListResponse,
  PermissionListResponse,
  PermissionModeResponse,
  PermissionRulesListResponse,
  QuestionListResponse,
  TriageListResponse,
} from '../../src/routes/schemas/human-gate';
import { WorkOverviewResponse } from '../../src/routes/schemas/work';
import { handleAttention } from '../../src/routes/attention';
import { handleDecisionList } from '../../src/routes/decisions';
import type { PodGoalView } from '../../src/core/pod/pod-view';
import type { DecisionRecord } from '../../src/core/decision/decision-record';

const CONTRACT_PATH = join(__dirname, '..', '..', '..', 'packages', 'gateway-sdk', 'contract', 'openapi.json');
const GATEWAY_SRC = join(__dirname, '..', '..', 'src');
const CATALOG_FILE = 'route-catalog.ts';

const contract = JSON.parse(readFileSync(CONTRACT_PATH, 'utf-8'));
const registry = new RouteRegistry().register(...buildRouteCatalog());

interface AllowEntry {
  id: string;
  reason: string;
}

/**
 * 无 registry handler、但由 `http/transport.ts` 手写分支服务的 catalog op。
 * 分支顺序是 load-bearing 的（见 transport 头注释），因此不进 registry。
 */
const TRANSPORT_ALLOWLIST: AllowEntry[] = [
  { id: 'media.createTask', reason: 'POST /a2a JSON-RPC branch in http/transport.ts (A2A media agent)' },
  { id: 'a2a.agentCard', reason: 'GET /.well-known/agent-card.json branch in http/transport.ts (A2A discovery)' },
  { id: 'media.artifact', reason: 'GET /a2a/artifacts/:id branch in http/transport.ts (matchArtifactId)' },
  { id: 'project.setCurrent', reason: 'POST /register branch in http/transport.ts (project registration)' },
  { id: 'goals.controlLegacy', reason: 'POST /control branch in http/transport.ts (MCP compatibility alias)' },
  { id: 'health.root', reason: 'GET /health branch in http/transport.ts (standalone health probe)' },
  { id: 'fileHistory.snapshot', reason: 'transport deps.fileHistory branch (routes/file-history.ts, loopback-only)' },
  { id: 'fileHistory.list', reason: 'transport deps.fileHistory branch (routes/file-history.ts, loopback-only)' },
  { id: 'fileHistory.restore', reason: 'transport deps.fileHistory branch (routes/file-history.ts, loopback-only)' },
];

/**
 * R5 保留的 dashboard 兜底形状由 `subsystems/dashboard-legacy.ts` 的
 * `/api/goals*` catch-all 直接响应、没有独立 registry handler。E3 fix 删除了
 * 最后两个误登记项（`goals.loops` / `goals.loopsAt` —— catch-all 实际返回的是
 * goals 列表，形状不对）；现在该名单为空，请求仍由 catch-all 兜底。
 */
const DASHBOARD_RESIDUE_ALLOWLIST: AllowEntry[] = [];

/** 由反代尾部透传给 runtime serve 的端点（gateway 无 handler 是设计）。 */
const RUNTIME_PROXY_ALLOWLIST: AllowEntry[] = [
  { id: 'session.command', reason: 'reverse-proxied to runtime serve (no gateway handler by design)' },
];

const ALLOWLISTS: ReadonlyArray<{ name: string; entries: AllowEntry[] }> = [
  { name: 'TRANSPORT_ALLOWLIST', entries: TRANSPORT_ALLOWLIST },
  { name: 'DASHBOARD_RESIDUE_ALLOWLIST', entries: DASHBOARD_RESIDUE_ALLOWLIST },
  { name: 'RUNTIME_PROXY_ALLOWLIST', entries: RUNTIME_PROXY_ALLOWLIST },
];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist') continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walk(p));
    else if (name.endsWith('.ts') && !name.endsWith('.test.ts') && !name.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

/** 从 `start` 处的开括号起，读取到配对闭括号（跳过字符串）。 */
function readBalanced(src: string, start: number): string | null {
  const open = src[start];
  const close = open === '[' ? ']' : open === '{' ? '}' : open === '(' ? ')' : '';
  if (!close) return null;
  let depth = 0;
  let quote: string | null = null;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === '\\') { i++; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  return null;
}

function quotedStrings(expr: string): string[] {
  return [...expr.matchAll(/['"]([^'"]+)['"]/g)].map((m) => m[1]);
}

/** 解析 `for (const X of <expr>) { ... }` 中的动态 attach id 列表。 */
function collectLoopIds(src: string): string[] {
  const ids: string[] = [];
  const loopRe = /for\s*\(\s*const\s+([\s\S]*?)\s+of\s+([\s\S]*?)\)\s*\{/g;
  for (const m of src.matchAll(loopRe)) {
    const bodyOpen = m.index! + m[0].length - 1;
    const body = readBalanced(src, bodyOpen);
    if (!body || !body.includes('attachHandler')) continue;

    let expr = m[2].trim().replace(/\s+as\s+const$/, '').trim();
    if (/^[A-Za-z_$][\w$]*$/.test(expr)) {
      // `for (const op of CONST_ARRAY)` —— 解析同文件里的 `const CONST_ARRAY = [...]`。
      const def = new RegExp(`const\\s+${expr}\\s*=\\s*(\\[)`).exec(src);
      if (!def) continue;
      const arr = readBalanced(src, def.index + def[0].length - 1);
      if (!arr) continue;
      expr = arr;
    }
    if (!expr.startsWith('[')) continue;
    ids.push(...quotedStrings(expr));
  }
  return ids;
}

/** 扫描 gateway 源码，返回所有可证明 attached 的 operationId。 */
function collectAttachedOperationIds(): Set<string> {
  const attached = new Set<string>();
  for (const file of walk(GATEWAY_SRC)) {
    if (file.endsWith(CATALOG_FILE)) continue; // catalog 是登记面，不是 attach 证据
    const src = readFileSync(file, 'utf-8');

    for (const m of src.matchAll(/attachHandler\(\s*['"]([^'"]+)['"]/g)) attached.add(m[1]);
    for (const id of collectLoopIds(src)) attached.add(id);

    // attachTypedRoute(registry, { operationId: '...' }) —— 调用点在 api-routes.ts。
    if (src.includes('attachTypedRoute(')) {
      for (const m of src.matchAll(/operationId\s*:\s*['"]([^'"]+)['"]/g)) attached.add(m[1]);
    }
  }
  return attached;
}

describe('api-contract: catalog 可达性守卫', () => {
  const attached = collectAttachedOperationIds();
  const allowedIds = new Set(ALLOWLISTS.flatMap((l) => l.entries.map((e) => e.id)));

  test('catalog 每个 op 都 attached 或在 allowlist（catalog − attached − allowlist = ∅）', () => {
    const unreachable = registry
      .list()
      .filter((def) => !attached.has(def.operationId) && !allowedIds.has(def.operationId));
    if (unreachable.length) {
      console.error(
        '[api-contract] 不可达 catalog op（既无 handler 也不在 allowlist）:\n' +
          unreachable
            .map((d) => `${d.method} ${d.path} (${d.operationId})`)
            .join('\n') +
          '\n修复：attach handler，或按真实服务面加入带 reason 的 allowlist。',
      );
    }
    expect(unreachable.map((d) => d.operationId)).toEqual([]);
  });

  test('allowlist 条目：存在、唯一、带 reason、且未被 attach（只减不增）', () => {
    const catalogIds = new Set(registry.list().map((d) => d.operationId));
    const seen = new Map<string, string>();
    const problems: string[] = [];
    for (const { name, entries } of ALLOWLISTS) {
      for (const { id, reason } of entries) {
        if (seen.has(id)) problems.push(`${id}: 同时出现在 ${seen.get(id)} 与 ${name}`);
        seen.set(id, name);
        if (!catalogIds.has(id)) problems.push(`${id}: 已不在 catalog（allowlist 陈旧条目，删除）`);
        if (attached.has(id)) problems.push(`${id}: 已有 handler（从 ${name} 移除）`);
        if (!reason || reason.trim().length < 8) problems.push(`${id}: 缺少可读 reason`);
      }
    }
    expect(problems).toEqual([]);
  });

  test('dashboard-residue 幽灵 op 已删除（goals.loops / goals.loopsAt 无 handler，兜底返回列表形状）', () => {
    const ids = new Set(registry.list().map((d) => d.operationId));
    expect(ids.has('goals.loops')).toBe(false);
    expect(ids.has('goals.loopsAt')).toBe(false);
  });

  test('扫描器能解析动态 attach 源（pods / wave1 / lead boundaries / typed）', () => {
    for (const id of [
      'pods.ensure', // pod-handlers.ts const operationIds = [...]
      'pods.goals.techLead', // pod-handlers.ts COLLABORATION_OPERATION_IDS
      'pods.a2a', // pod-a2a.ts inline array
      'session.checkpoint', // wave1-handlers.ts inline array
      'lead.boundaries.accept', // lead-boundaries.ts destructured loop
      'session.list', // api-routes.ts attachTypedRoute({ operationId })
    ]) {
      expect(attached.has(id)).toBe(true);
    }
  });

  test('本次两个漂移 bug 的回归锚点（catalog 内）', () => {
    const ids = new Set(registry.list().map((d) => d.operationId));
    expect(ids.has('triage.dismiss')).toBe(true);
    expect(ids.has('goals.control')).toBe(true);
    expect(ids.has('goals.respondQuestion')).toBe(true);
  });
});

describe('api-contract: response schemas（E3-6 四个读接口）', () => {
  test('goals.get / project.list / presence.get / session.usageSummary 的 200 响应带 JSON schema', () => {
    const required: Record<string, string> = {
      'goals.get': 'GET /api/goals/{id}',
      'project.list': 'GET /api/projects',
      'presence.get': 'GET /api/presence',
      'session.usageSummary': 'GET /api/usage/summary',
    };
    const problems: string[] = [];
    for (const [operationId, label] of Object.entries(required)) {
      let op: any = null;
      for (const methods of Object.values<any>(contract.paths)) {
        for (const candidate of Object.values<any>(methods)) {
          if (candidate?.operationId === operationId) op = candidate;
        }
      }
      if (!op) { problems.push(`${operationId}: 未出现在 openapi.json（${label}）`); continue; }
      const schema = op.responses?.['200']?.content?.['application/json']?.schema;
      if (!schema) { problems.push(`${operationId}: responses.200 缺 application/json schema`); continue; }
      const propertyCount = Object.keys(schema.properties ?? {}).length;
      if (propertyCount < 1) problems.push(`${operationId}: schema 不含任何 property`);
    }
    if (problems.length) {
      console.error('[api-contract] 读接口 response schema 缺失 —— 先跑 emit:openapi + merge-contract:\n' + problems.join('\n'));
    }
    expect(problems).toEqual([]);
  });

  test('E4-8 kernel.stats 的 200 响应带资源账本 schema', () => {
    let op: any = null;
    for (const methods of Object.values<any>(contract.paths)) {
      for (const candidate of Object.values<any>(methods)) {
        if (candidate?.operationId === 'kernel.stats') op = candidate;
      }
    }
    expect(op).not.toBeNull();
    expect(op.tags).toContain('internal');
    const schema = op.responses?.['200']?.content?.['application/json']?.schema;
    expect(schema).toBeDefined();
    // 账本的承重字段（少一个客户端就无法判断降级/进程/配额）。
    for (const field of ['pressure', 'disk', 'connections', 'buffers', 'timers', 'processes', 'quotas', 'handles', 'scheduler', 'events', 'serve']) {
      expect({ field, present: Object.prototype.hasOwnProperty.call(schema.properties ?? {}, field) })
        .toEqual({ field, present: true });
    }
    // quotas 的每个资源键都是 required（stats 快照永不发半张配额表）。
    expect(schema.properties.quotas.required).toEqual(['projects', 'sessions', 'sessionRecordsPerProject']);
    for (const resource of ['projects', 'sessions', 'sessionRecordsPerProject']) {
      expect(schema.properties.quotas.properties[resource].required).toEqual(['current', 'limit']);
    }
  });

  test('E5b event.replay 的 200 响应带 event_log 恢复 schema（internal）', () => {
    let op: any = null;
    for (const methods of Object.values<any>(contract.paths)) {
      for (const candidate of Object.values<any>(methods)) {
        if (candidate?.operationId === 'event.replay') op = candidate;
      }
    }
    expect(op).not.toBeNull();
    expect(op.tags).toContain('internal');
    const schema = op.responses?.['200']?.content?.['application/json']?.schema;
    expect(schema).toBeDefined();
    // 客户端循环/全量重拉判定依赖这些字段，少一个就无法决定是否补齐。
    for (const field of ['events', 'headSeq', 'oldestSeq', 'hasMore', 'nextSince', 'reset', 'truncated']) {
      expect({ field, present: Object.prototype.hasOwnProperty.call(schema.properties ?? {}, field) })
        .toEqual({ field, present: true });
    }
    const item = schema.properties.events.items;
    expect(item.required).toEqual(expect.arrayContaining(['seq', 'ts', 'type', 'sessionId', 'envelope']));
  });

  test('E4-8 真实 builder 快照通过 KernelStatsResponse 校验（shape 不漂移）', () => {
    const input: KernelStatsInput = {
      uptimeSec: 12,
      connections: {
        snapshot: () => ({
          httpOpen: 1,
          sse: 0,
          ws: 0,
          voice: 0,
          terminal: 0,
          limits: { httpConnections: 256, sseClients: 64, wsClients: 64, voiceClients: 16, terminalClients: 16 },
          refused: { sse: 0, ws: 0, voice: 0, terminal: 0 },
        }),
      },
      buffers: {
        snapshot: () => ({
          sseOverflows: 0,
          sseDropped: 0,
          sseWriteErrors: 0,
          sseQueuedFrames: 0,
          sseQueuedBytes: 0,
          wsDropped: 0,
        }),
      },
      timers: { stats: () => ({ active: 1, byName: { 'governor:sample': 1 } }) },
      processes: { snapshot: () => ({ total: 0, byKind: { python: 0, llamacpp: 0, serve: 0 }, entries: [] }) },
      quotas: {
        snapshot: () => ({
          projects: { current: 1, limit: 128 },
          sessions: { current: 2, limit: 1000 },
          sessionRecordsPerProject: { current: 0, limit: 200 },
        }),
      },
      scheduler: { stats: () => ({ queued: 0, running: 0, byPriority: {} }) },
      events: { headSeq: () => 0, appendFailures: () => 0 },
      serve: { running: false, owned: false },
      handles: { total: 2, byType: { Timeout: 2 } },
      quotaCurrents: { projects: 1, sessions: 2, sessionRecordsPerProject: 0 },
    };
    const snapshot = buildKernelStatsSnapshot(input);
    const errors = [...Value.Errors(KernelStatsResponse, snapshot)];
    expect(errors).toEqual([]);
    expect(Value.Check(KernelStatsResponse, snapshot)).toBe(true);
  });
});

describe('api-contract: E8-3 六个核心读接口 response schema', () => {
  const findOp = (operationId: string): any => {
    for (const methods of Object.values<any>(contract.paths)) {
      for (const candidate of Object.values<any>(methods)) {
        if (candidate?.operationId === operationId) return candidate;
      }
    }
    return null;
  };

  /** 每个 op 的承重 property（少一个客户端就无法渲染/分页）。 */
  const EXPECTED: Record<string, string[]> = {
    'session.get': ['id', 'projectID', 'directory', 'title', 'time'],
    'session.messages': ['data', 'nextCursor'],
    'decisions.list': ['items'],
    'attention.list': ['items'],
    'memory.stats': ['embedding', 't1', 'consolidation', 'pipelines', 'abstractionLevels'],
    'pods.get': ['pod', 'members', 'goals', 'attention', 'messageHealth', 'tasks', 'sessions'],
  };

  test('六个 op 的 200 响应都是带 properties 的 JSON schema', () => {
    const problems: string[] = [];
    for (const [operationId, fields] of Object.entries(EXPECTED)) {
      const op = findOp(operationId);
      if (!op) { problems.push(`${operationId}: 未出现在 openapi.json`); continue; }
      const schema = op.responses?.['200']?.content?.['application/json']?.schema;
      if (!schema) { problems.push(`${operationId}: responses.200 缺 application/json schema`); continue; }
      for (const field of fields) {
        if (!Object.prototype.hasOwnProperty.call(schema.properties ?? {}, field)) {
          problems.push(`${operationId}: schema 缺 property '${field}'`);
        }
      }
    }
    if (problems.length) {
      console.error('[api-contract] E8-3 response schema 缺失 — 先跑 emit:openapi + merge-contract:\n' + problems.join('\n'));
    }
    expect(problems).toEqual([]);
  });

  test('session.messages 的 item 仍以 role 为 required（flat DTO 边界）', () => {
    const schema = findOp('session.messages').responses['200'].content['application/json'].schema;
    expect(schema.properties.data.items.required).toEqual(['role']);
    expect(schema.required).toEqual(expect.arrayContaining(['data', 'nextCursor']));
  });

  test('pods.get 声明 Pod 详情骨架（而非空对象）', () => {
    const schema = findOp('pods.get').responses['200'].content['application/json'].schema;
    expect(schema.properties.pod.required).toEqual(expect.arrayContaining(['id', 'projectDir', 'status']));
    expect(schema.properties.goals.items.required).toEqual(expect.arrayContaining(['goalId', 'stage', 'status']));
    expect(schema.properties.sessions.items.required).toEqual(expect.arrayContaining(['sessionId', 'memberId']));
  });

  test('attention.list / decisions.list 的 handler 输出通过各自 schema 校验', () => {
    const view: PodGoalView = {
      id: 'pod_1:goal_1', podId: 'pod_1', goalId: 'goal_1', status: 'active',
      title: 'Ship it', phase: null, verdict: null,
      stage: { owner: 'person', kind: 'plan_approval', action: { type: 'open_plan_review', goalId: 'goal_1' } },
      bucket: 'needs_you', resultReady: false, accepted: false, sourceRef: null, strategy: null,
      assessment: null, currentAssignment: null, activeRevision: 1, revision: 1, priority: 0,
      enqueuedAt: '2026-11-13T00:00:00.000Z', startedAt: null, endedAt: null,
    };
    const attention = handleAttention({ projectDir: '/tmp/project' }, { views: () => [view] });
    expect(Value.Check(AttentionListResponse, attention.body)).toBe(true);
    expect([...Value.Errors(AttentionListResponse, attention.body)]).toEqual([]);

    const record: DecisionRecord = {
      id: 'dec_1', projectDir: '/tmp/project', goalId: 'goal_1', revision: 1,
      kind: 'direction', status: 'draft', question: 'Which way?',
      options: [{ id: 'a', title: 'A' }], evidence: [{ kind: 'goal', ref: 'goal_1' }],
      rationale: null, consequences: null, reviewAt: null, decidedBy: null, decidedAt: null,
      createdAt: '2026-11-13T00:00:00.000Z', updatedAt: '2026-11-13T00:00:00.000Z',
      history: [{ action: 'drafted', by: 'agent', at: '2026-11-13T00:00:00.000Z' }],
    };
    const decisions = handleDecisionList({ projectDir: '/tmp/project' }, {
      service: { list: () => [record] } as any,
    });
    expect(Value.Check(DecisionListResponse, decisions.body)).toBe(true);
    expect([...Value.Errors(DecisionListResponse, decisions.body)]).toEqual([]);
  });
});

describe('api-contract: E10-1 session 读接口 response schema（8 ops）', () => {
  const findOp = (operationId: string): any => {
    for (const methods of Object.values<any>(contract.paths)) {
      for (const candidate of Object.values<any>(methods)) {
        if (candidate?.operationId === operationId) return candidate;
      }
    }
    return null;
  };

  /** 每个 op 的承重 property + 数组元素必填（少一个客户端就无法渲染/分页）。 */
  const EXPECTED: Record<string, { fields: string[]; item?: { at: string; required: string[] } }> = {
    'session.queue.list': {
      fields: ['items'],
      item: { at: 'items', required: ['id', 'sessionID', 'enqueuedAt', 'source'] },
    },
    'session.config': { fields: ['mode', 'thinkingLevelSupported'] },
    'session.todo': {
      fields: ['data'],
      item: { at: 'data', required: ['id', 'content', 'status', 'priority'] },
    },
    'session.children': {
      fields: ['items'],
      item: { at: 'items', required: ['id', 'depth'] },
    },
    'session.tokenSummary': { fields: ['totalTokens', 'totalCost', 'turnCount', 'avgTokensPerTurn'] },
    'session.checkpoints': {
      fields: ['checkpoints'],
      item: {
        at: 'checkpoints',
        required: [
          'id', 'sessionID', 'projectDir', 'anchorMessageID', 'snapshotTree',
          'untracked', 'kind', 'createdAt', 'actions',
        ],
      },
    },
    'session.subagents.list': {
      fields: ['items'],
      item: {
        at: 'items',
        required: ['id', 'parentID', 'depth', 'status', 'createdAt', 'updatedAt'],
      },
    },
    'session.diff': {
      fields: ['files'],
      item: { at: 'files', required: ['file'] },
    },
  };

  test('八个 op 的 200 响应都是带 properties 的 JSON schema（不得整体放宽成空对象）', () => {
    const problems: string[] = [];
    for (const [operationId, spec] of Object.entries(EXPECTED)) {
      const op = findOp(operationId);
      if (!op) { problems.push(`${operationId}: 未出现在 openapi.json`); continue; }
      const schema = op.responses?.['200']?.content?.['application/json']?.schema;
      if (!schema) { problems.push(`${operationId}: responses.200 缺 application/json schema`); continue; }
      const properties = Object.keys(schema.properties ?? {});
      if (properties.length === 0) { problems.push(`${operationId}: schema 不含任何 property（整体放宽）`); continue; }
      for (const field of spec.fields) {
        if (!properties.includes(field)) problems.push(`${operationId}: schema 缺 property '${field}'`);
      }
    }
    if (problems.length) {
      console.error('[api-contract] E10-1 response schema 缺失 — 先跑 emit:openapi + merge-contract:\n' + problems.join('\n'));
    }
    expect(problems).toEqual([]);
  });

  test('数组元素必填字段与 handler 实际 wire 一致（items/data/files）', () => {
    const problems: string[] = [];
    for (const [operationId, spec] of Object.entries(EXPECTED)) {
      if (!spec.item) continue;
      const schema = findOp(operationId).responses['200'].content['application/json'].schema;
      const arraySchema = schema.properties?.[spec.item.at];
      const required = arraySchema?.items?.required ?? [];
      for (const field of spec.item.required) {
        if (!required.includes(field)) problems.push(`${operationId}: ${spec.item.at}.items 缺 required '${field}'`);
      }
    }
    expect(problems).toEqual([]);
  });

  test('tokenSummary / diff 的字段类型钉住（数值 / 可空快照树 / file 必填）', () => {
    const summary = findOp('session.tokenSummary').responses['200'].content['application/json'].schema;
    expect(summary.properties.totalTokens.required).toEqual(['input', 'output', 'reasoning', 'cache']);
    expect(summary.properties.totalCost.type).toBe('number');
    expect(summary.properties.turnCount.type).toBe('number');
    expect(summary.properties.avgTokensPerTurn.required).toEqual(['input', 'output', 'reasoning', 'cache']);

    const checkpoints = findOp('session.checkpoints').responses['200'].content['application/json'].schema;
    const item = checkpoints.properties.checkpoints.items;
    expect(item.properties.snapshotTree.anyOf?.map((entry: any) => entry.type))
      .toEqual(expect.arrayContaining(['string', 'null']));
    expect(item.properties.untracked.type).toBe('array');
    // actions 是 Experience ActionDescriptor 三件套，列表响应恒带（POST 创建响应不带）。
    expect(item.properties.actions.required).toEqual(['restoreConversation', 'restoreFiles', 'restoreBoth']);

    const diff = findOp('session.diff').responses['200'].content['application/json'].schema;
    expect(diff.properties.files.items.properties.file.type).toBe('string');
    expect(diff.properties.files.items.properties.status.anyOf?.map((entry: any) => entry.const))
      .toEqual(expect.arrayContaining(['added', 'modified', 'deleted']));
  });

  test('handler 实际 wire 样本通过各自 schema 校验（Value.Check）', () => {
    const queue = {
      items: [{
        id: 'q_1', sessionID: 's1', text: 'hi', parts: [{ type: 'text', text: 'hi' }],
        agent: 'build', model: { providerID: 'p', modelID: 'm' }, expectReply: true,
        idempotencyKey: 'k1', thinkingLevel: 'high', variant: 'v',
        enqueuedAt: '2026-11-13T00:00:00.000Z', source: 'http',
      }],
    };
    expect(Value.Check(SessionQueueListResponse, queue)).toBe(true);
    expect(Value.Check(SessionQueueListResponse, { items: [] })).toBe(true);

    expect(Value.Check(SessionConfigResponse, {
      mode: 'auto', agent: 'build', model: { providerID: 'p', modelID: 'm' },
      variant: 'v', thinkingLevel: 'high', thinkingLevelSupported: true,
    })).toBe(true);
    // 配置服务在无 stored/agent/model 时只发 mode + thinkingLevelSupported。
    expect(Value.Check(SessionConfigResponse, { mode: 'read-only', thinkingLevelSupported: false })).toBe(true);

    expect(Value.Check(SessionTodoResponse, {
      data: [{ id: 't1', content: 'do it', status: 'pending', priority: 'high' }],
    })).toBe(true);
    expect(Value.Check(SessionTodoResponse, { data: [] })).toBe(true);

    // children：runtime-owned item 字段开放，但 id + gateway 补齐的 depth 必填。
    expect(Value.Check(SessionChildrenResponse, {
      items: [{ id: 'c1', depth: 1, title: 'child', parentID: 's1' }],
    })).toBe(true);
    expect(Value.Check(SessionChildrenResponse, { items: [] })).toBe(true);

    const tokens = { input: 1, output: 2, reasoning: 3, cache: { read: 4, write: 5 } };
    expect(Value.Check(SessionTokenSummaryResponse, {
      totalTokens: tokens, totalCost: 0.5, turnCount: 2, avgTokensPerTurn: tokens,
    })).toBe(true);
    expect(Value.Check(SessionTokenSummaryResponse, {
      totalTokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      totalCost: 0, turnCount: 0,
      avgTokensPerTurn: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    })).toBe(true);

    const descriptor = { supported: true, enabled: true };
    expect(Value.Check(SessionCheckpointsResponse, {
      checkpoints: [{
        id: 'cp_1', sessionID: 's1', projectDir: '/p', anchorMessageID: 'm1',
        snapshotTree: null, untracked: ['a.ts'], kind: 'auto', createdAt: '2026-11-13T00:00:00.000Z',
        actions: {
          restoreConversation: descriptor,
          restoreFiles: { supported: true, enabled: false, reason: 'missing-data' },
          restoreBoth: { ...descriptor, warningKey: 'restore-conversation-only-no-undo' },
        },
      }],
    })).toBe(true);

    expect(Value.Check(SessionSubagentsResponse, {
      items: [{
        id: 'c1', parentID: 's1', depth: 1, agent: 'general', description: 'x',
        status: 'running', background: true, createdAt: 1, updatedAt: 2,
      }],
    })).toBe(true);
    expect(Value.Check(SessionSubagentsResponse, { items: [] })).toBe(true);

    expect(Value.Check(SessionDiffResponse, {
      files: [{ file: 'a.ts', patch: '@@ -1 +1 @@', additions: 1, deletions: 0, status: 'modified' }],
    })).toBe(true);
    expect(Value.Check(SessionDiffResponse, { files: [] })).toBe(true);
  });
});

describe('api-contract: E10-2 pod / work 读接口 response schema（8 ops）', () => {
  const findOp = (operationId: string): any => {
    for (const methods of Object.values<any>(contract.paths)) {
      for (const candidate of Object.values<any>(methods)) {
        if (candidate?.operationId === operationId) return candidate;
      }
    }
    return null;
  };

  /** 每个 op 的承重 property + 数组元素必填（少一个客户端就无法渲染/分页）。 */
  const EXPECTED: Record<string, { fields: string[]; item?: { at: string; required: string[] } }> = {
    'work.overview': { fields: ['projectDir', 'podId', 'groups', 'counts', 'total'] },
    'pod.events.list': {
      fields: ['items', 'unread'],
      item: {
        at: 'items',
        required: [
          'id', 'podId', 'goalId', 'revision', 'kind', 'severity', 'reason', 'title',
          'summary', 'audience', 'state', 'createdAt', 'seenAt',
        ],
      },
    },
    'pods.tasks.list': {
      fields: ['items'],
      item: {
        at: 'items',
        required: [
          'id', 'podId', 'goalId', 'sourceKey', 'externalTaskId', 'kind', 'title',
          'description', 'ownerMemberId', 'status', 'createdAt', 'updatedAt',
        ],
      },
    },
    'pods.messages.list': {
      fields: ['items'],
      item: {
        at: 'items',
        required: [
          'id', 'podId', 'fromMemberId', 'toMemberId', 'kind', 'body', 'createdAt',
          'readAt', 'protocol', 'externalMessageId', 'deliveredAt', 'deliveredSessionId',
        ],
      },
    },
    'pods.goals': {
      fields: ['items'],
      item: {
        at: 'items',
        required: ['id', 'podId', 'goalId', 'status', 'title', 'phase', 'verdict', 'stage', 'resultReady', 'enqueuedAt'],
      },
    },
    'pods.goals.result': {
      fields: [
        'goalId', 'revision', 'verdict', 'resultReady', 'reviewed', 'assessment',
        'goalAcceptance', 'goalConditions', 'goalResults', 'goalEvalValid', 'failure',
        'tasks', 'reviewFeedback', 'receipt', 'artifacts', 'worktree', 'acceptance',
      ],
    },
    'pods.goals.reviewItems': {
      fields: ['revision', 'items'],
      item: {
        at: 'items',
        required: [
          'id', 'podId', 'goalId', 'revision', 'status', 'rel', 'startLine', 'endLine',
          'code', 'comment', 'anchor', 'response', 'originItemId', 'originRevision',
          'createdAt', 'updatedAt', 'respondedAt', 'resolvedAt',
        ],
      },
    },
    'pods.cost': { fields: ['spentUsd', 'limitUsd'] },
  };

  test('八个 op 的 200 响应都是带 properties 的 JSON schema（不得整体放宽成空对象）', () => {
    const problems: string[] = [];
    for (const [operationId, spec] of Object.entries(EXPECTED)) {
      const op = findOp(operationId);
      if (!op) { problems.push(`${operationId}: 未出现在 openapi.json`); continue; }
      const schema = op.responses?.['200']?.content?.['application/json']?.schema;
      if (!schema) { problems.push(`${operationId}: responses.200 缺 application/json schema`); continue; }
      const properties = Object.keys(schema.properties ?? {});
      if (properties.length === 0) { problems.push(`${operationId}: schema 不含任何 property（整体放宽）`); continue; }
      for (const field of spec.fields) {
        if (!properties.includes(field)) problems.push(`${operationId}: schema 缺 property '${field}'`);
      }
    }
    if (problems.length) {
      console.error('[api-contract] E10-2 response schema 缺失 — 先跑 emit:openapi + merge-contract:\n' + problems.join('\n'));
    }
    expect(problems).toEqual([]);
  });

  test('数组元素必填字段与 handler 实际 wire 一致（items）', () => {
    const problems: string[] = [];
    for (const [operationId, spec] of Object.entries(EXPECTED)) {
      if (!spec.item) continue;
      const schema = findOp(operationId).responses['200'].content['application/json'].schema;
      const required = schema.properties?.[spec.item.at]?.items?.required ?? [];
      for (const field of spec.item.required) {
        if (!required.includes(field)) problems.push(`${operationId}: ${spec.item.at}.items 缺 required '${field}'`);
      }
    }
    expect(problems).toEqual([]);
  });

  test('work.overview 的五桶键集与 PodGoalView 元素必填（counts 键集一致）', () => {
    const schema = findOp('work.overview').responses['200'].content['application/json'].schema;
    const buckets = ['needs_you', 'queued', 'in_progress', 'result_ready', 'ended'];
    expect(schema.properties.groups.required).toEqual(buckets);
    expect(schema.properties.counts.required).toEqual(buckets);
    for (const bucket of buckets) {
      expect(schema.properties.groups.properties[bucket].type).toBe('array');
      expect(schema.properties.counts.properties[bucket].type).toBe('number');
    }
    expect(schema.properties.groups.properties.needs_you.items.required)
      .toEqual(expect.arrayContaining(['goalId', 'stage', 'status', 'resultReady', 'enqueuedAt']));
    expect(schema.properties.total.type).toBe('number');
  });

  test('goal result 的可空字段与枚举钉住（不能退化成 unknown/anyOf null）', () => {
    const schema = findOp('pods.goals.result').responses['200']['content']['application/json'].schema;
    expect(schema.properties.revision.type).toBe('number');
    expect(schema.properties.reviewed.type).toBe('boolean');
    expect(schema.properties.assessment.anyOf?.map((entry: any) => entry.const ?? entry.type))
      .toEqual(expect.arrayContaining(['reviewed', 'unreviewed', 'null']));
    expect(schema.properties.failure.anyOf?.map((entry: any) => entry.const ?? entry.type))
      .toEqual(expect.arrayContaining(['review_missing', 'review_invalid', 'goal_eval_invalid', 'null']));
    expect(schema.properties.acceptance.anyOf?.map((entry: any) => entry.const))
      .toEqual(expect.arrayContaining(['pending', 'accepted', 'unavailable']));
    expect(schema.properties.worktree.anyOf?.map((entry: any) => entry.type))
      .toEqual(expect.arrayContaining(['object', 'null']));
    // Goal Eval 条件必须带「要什么证据 / 怎么验」，否则 Reviewer 会漏验。
    expect(schema.properties.goalConditions.items.required)
      .toEqual(['id', 'statement', 'required', 'evidence', 'method']);
    // receipt 是 runtime-owned 回执 JSON：只承诺「有值即可」，不建模内部字段。
    expect(schema.properties.receipt).toBeDefined();
  });

  test('handler 实际 wire 样本通过各自 schema 校验（Value.Check）', () => {
    const goalView: PodGoalView = {
      id: 'pod_1:goal_1', podId: 'pod_1', goalId: 'goal_1', status: 'active',
      title: 'Ship it', phase: null, verdict: null,
      stage: { owner: 'person', kind: 'plan_approval', action: { type: 'open_plan_review', goalId: 'goal_1' } },
      stateMissing: false,
      bucket: 'needs_you', resultReady: false, accepted: false, sourceRef: null, strategy: null,
      assessment: null, currentAssignment: null, activeRevision: 1, revision: 1, priority: 0,
      enqueuedAt: '2026-11-13T00:00:00.000Z', startedAt: null, endedAt: null,
    };
    const buckets = ['needs_you', 'queued', 'in_progress', 'result_ready', 'ended'] as const;
    const groups = Object.fromEntries(buckets.map((bucket) => [bucket, bucket === 'needs_you' ? [goalView] : []]));
    const counts = Object.fromEntries(buckets.map((bucket) => [bucket, bucket === 'needs_you' ? 1 : 0]));
    const work = { projectDir: '/tmp/project', podId: 'pod_1', groups, counts, total: 1 };
    expect(Value.Check(WorkOverviewResponse, work)).toBe(true);
    expect([...Value.Errors(WorkOverviewResponse, work)]).toEqual([]);

    const event = {
      id: 'evt_1', podId: 'pod_1', goalId: 'goal_1', revision: 1, kind: 'goal_result',
      severity: 'p1', reason: 'result', title: 'goal finished', summary: null,
      audience: 'human', state: 'unread',
      createdAt: '2026-11-13T00:00:00.000Z', seenAt: null,
      // 行内的存储列（refsJson / dedupeKey / wake*）不影响契约面校验。
      refsJson: null, dedupeKey: 'goal_1:1:result',
    };
    expect(Value.Check(PodEventsResponse, { items: [event], unread: 1 })).toBe(true);

    const task = {
      id: 'task_1', podId: 'pod_1', goalId: null, sourceKey: 'manual:1', externalTaskId: null,
      kind: 'note', title: 'do it', description: null, ownerMemberId: null, status: 'pending',
      dependenciesJson: null, artifactRefsJson: null, acceptanceJson: null,
      createdAt: '2026-11-13T00:00:00.000Z', updatedAt: '2026-11-13T00:00:00.000Z',
    };
    expect(Value.Check(PodTasksResponse, { items: [task] })).toBe(true);

    const message = {
      id: 'msg_1', podId: 'pod_1', fromMemberId: 'm_lead', toMemberId: null, kind: 'note',
      body: 'hi', createdAt: '2026-11-13T00:00:00.000Z', readAt: null,
      protocol: null, externalMessageId: null, deliveredAt: null, deliveredSessionId: null,
    };
    expect(Value.Check(PodMessagesResponse, { items: [message] })).toBe(true);

    expect(Value.Check(PodGoalsResponse, { items: [goalView] })).toBe(true);

    const result = {
      goalId: 'goal_1', revision: 1, verdict: 'PASS', resultReady: true, reviewed: true,
      assessment: 'reviewed',
      goalAcceptance: ['tests pass'],
      goalConditions: [{ id: 'g1', statement: 'tests pass', required: true, evidence: 'jest', method: 'run' }],
      goalResults: [{ conditionId: 'g1', result: 'pass', evidence: 'jest ok' }],
      goalEvalValid: true,
      failure: null,
      tasks: [{ taskId: 'task_1', result: 'pass', evidence: 'jest ok' }],
      reviewFeedback: 'ok',
      receipt: { merged: false },
      artifacts: ['report.md'],
      worktree: {
        dir: '/repo-wt-g1-r1', branch: 'mafw/g1-r1', baseBranch: 'main',
        status: 'active', mergeCommit: null, mergedAt: null,
      },
      acceptance: 'pending',
      acceptanceRecord: null,
    };
    expect(Value.Check(PodGoalResultResponse, result)).toBe(true);
    expect([...Value.Errors(PodGoalResultResponse, result)]).toEqual([]);
    // worktree 缺失分支：service 只给 worktree: null + acceptance: 'unavailable'（无 acceptanceRecord）。
    expect(Value.Check(PodGoalResultResponse, {
      ...result, worktree: null, acceptance: 'unavailable', acceptanceRecord: undefined, receipt: null,
    })).toBe(true);

    const reviewItem = {
      id: 'ri_1', podId: 'pod_1', goalId: 'goal_1', revision: 1, status: 'pending',
      rel: 'src/a.ts', startLine: 1, endLine: 2, code: 'const a = 1', comment: 'rename',
      anchor: { kind: 'quote', quote: 'const a = 1' },
      response: null, originItemId: null, originRevision: null,
      createdAt: '2026-11-13T00:00:00.000Z', updatedAt: '2026-11-13T00:00:00.000Z',
      respondedAt: null, resolvedAt: null,
    };
    expect(Value.Check(PodReviewItemsResponse, { revision: 1, items: [reviewItem] })).toBe(true);
    expect(Value.Check(PodReviewItemsResponse, { revision: 1, items: [] })).toBe(true);

    expect(Value.Check(PodCostResponse, { spentUsd: 1.5, limitUsd: 10 })).toBe(true);
  });
});

describe('api-contract: E10b-1 goal / pod-goal read response schema (8 ops)', () => {
  const findOp = (operationId: string): any => {
    for (const methods of Object.values<any>(contract.paths)) {
      for (const candidate of Object.values<any>(methods)) {
        if (candidate?.operationId === operationId) return candidate;
      }
    }
    return null;
  };

  /** 每个 op 的承重 property + 数组元素必填（少一个客户端按比较/渲染就会缺字段）。 */
  const EXPECTED: Record<string, { fields: string[]; item?: { at: string; required: string[] } }> = {
    'goals.list': {
      fields: ['goals'],
      item: { at: 'goals', required: ['goalId', 'phase', 'loop', 'error', 'updatedAt'] },
    },
    'goals.plan': {
      fields: [
        'planReview', 'planApproval', 'planFeedback', 'round', 'revision', 'waves',
        'wavePlanPath', 'wavesPath', 'goalEval', 'goalEvalPath', 'goalEvalError',
        'planHash', 'evalHash', 'stale',
      ],
    },
    'goals.sessions': {
      fields: ['sessions'],
      item: { at: 'sessions', required: ['sessionID', 'phase', 'loop'] },
    },
    'goals.timeline': {
      fields: ['goal', 'nodes', 'artifacts'],
      item: {
        at: 'nodes',
        required: [
          'runId', 'loop', 'node', 'attempt', 'status', 'sessionId', 'startedAt',
          'finishedAt', 'durationMs', 'outcome', 'error', 'tokensInput', 'tokensOutput', 'costUsd',
        ],
      },
    },
    'goals.source': { fields: ['sourceRef', 'handoffPath', 'fullText'] },
    'pods.goals.techLead': { fields: ['goalId', 'revision', 'sessionID', 'messages'] },
    'pods.goals.probes': {
      fields: ['items'],
      item: {
        at: 'items',
        required: [
          'id', 'podId', 'goalId', 'revision', 'status', 'request', 'report', 'error',
          'requestPath', 'reportPath', 'createdAt', 'startedAt', 'endedAt',
        ],
      },
    },
    'pods.goals.revisions': {
      fields: ['items'],
      item: {
        at: 'items',
        required: [
          'id', 'podId', 'goalId', 'revision', 'status', 'verdict', 'directionStatus',
          'directionJson', 'planHash', 'evalHash', 'feedback', 'priority',
          'enqueuedAt', 'startedAt', 'endedAt',
        ],
      },
    },
  };

  test('eight ops expose a 200 JSON schema with properties (not a whole-response widening)', () => {
    const problems: string[] = [];
    for (const [operationId, spec] of Object.entries(EXPECTED)) {
      const op = findOp(operationId);
      if (!op) { problems.push(`${operationId}: missing from openapi.json`); continue; }
      const schema = op.responses?.['200']?.content?.['application/json']?.schema;
      if (!schema) { problems.push(`${operationId}: responses.200 missing application/json schema`); continue; }
      const properties = Object.keys(schema.properties ?? {});
      if (properties.length === 0) { problems.push(`${operationId}: schema has no properties (widened)`); continue; }
      for (const field of spec.fields) {
        if (!properties.includes(field)) problems.push(`${operationId}: schema missing property '${field}'`);
      }
    }
    if (problems.length) {
      console.error('[api-contract] E10b-1 response schema missing - run emit:openapi + merge-contract:\n' + problems.join('\n'));
    }
    expect(problems).toEqual([]);
  });

  test('array item required fields match the handler wire (items/goals/sessions/nodes)', () => {
    const problems: string[] = [];
    for (const [operationId, spec] of Object.entries(EXPECTED)) {
      if (!spec.item) continue;
      const schema = findOp(operationId).responses['200'].content['application/json'].schema;
      const required = schema.properties?.[spec.item.at]?.items?.required ?? [];
      for (const field of spec.item.required) {
        if (!required.includes(field)) problems.push(`${operationId}: ${spec.item.at}.items missing required '${field}'`);
      }
    }
    expect(problems).toEqual([]);
  });

  test('goals.list / goals.sessions are code-first now (wave counters optional, time optional)', () => {
    const list = findOp('goals.list').responses['200']['content']['application/json'].schema;
    expect(list.properties.goals.items.required).toEqual(
      expect.arrayContaining(['goalId', 'phase', 'loop', 'error', 'updatedAt']),
    );
    // dashboard projection does not carry wave counters; the shared Goal DTO makes them optional.
    expect(list.properties.goals.items.required).not.toContain('currentWave');
    expect(list.properties.goals.items.required).not.toContain('totalWaves');
    expect(list.properties.goals.items.properties.currentWave).toBeDefined();

    const sessions = findOp('goals.sessions').responses['200']['content']['application/json'].schema;
    // time is runtime-enriched and optional, unlike the legacy override's required object.
    expect(sessions.properties.sessions.items.properties.time).toBeDefined();
    expect(sessions.properties.sessions.items.required).not.toContain('time');
  });

  test('timeline / plan key shapes pinned (node runs, nullable receipts, hashes, wave items)', () => {
    const timeline = findOp('goals.timeline').responses['200']['content']['application/json'].schema;
    expect(timeline.properties.goal.required).toEqual(
      expect.arrayContaining(['goalId', 'phase', 'planReview', 'planApproval']),
    );
    const receipts = timeline.properties.artifacts.properties.receipts;
    expect(receipts.type).toBe('array');
    expect(receipts.items.anyOf?.map((entry: any) => entry.type))
      .toEqual(expect.arrayContaining(['string', 'null']));
    expect(timeline.properties.nodes.items.properties.durationMs.anyOf?.map((entry: any) => entry.type))
      .toEqual(expect.arrayContaining(['number', 'null']));

    const plan = findOp('goals.plan').responses['200']['content']['application/json'].schema;
    expect(plan.properties.stale.type).toBe('boolean');
    expect(plan.properties.planHash.anyOf?.map((entry: any) => entry.type))
      .toEqual(expect.arrayContaining(['string', 'null']));
    // `waves` 是 plan 文档本身（handler 原样透传 `readFileSync(wavesPath)`），
    // 不是 goal-plan wave 数组——数组在 `waves.waves` 里。
    expect(plan.properties.waves.anyOf?.map((entry: any) => entry.type))
      .toEqual(expect.arrayContaining(['object', 'null']));
    expect(plan.properties.waves.anyOf[0].properties.waves.items.required).toEqual(['id']);
    expect(plan.properties.goalEval.anyOf[0].properties.conditions.items.required)
      .toEqual(['id', 'statement', 'required', 'evidence', 'method']);
  });

  test('probes / revisions enums and row-projection boundary (goalMode not modeled)', () => {
    const probes = findOp('pods.goals.probes').responses['200']['content']['application/json'].schema;
    expect(probes.properties.items.items.properties.status.anyOf?.map((entry: any) => entry.const))
      .toEqual(expect.arrayContaining(['queued', 'running', 'completed', 'failed', 'cancelled']));
    expect(probes.properties.items.items.properties.request.properties.scope.required)
      .toEqual(['paths', 'commandClasses', 'network', 'credentials']);

    const revisions = findOp('pods.goals.revisions').responses['200']['content']['application/json'].schema;
    const item = revisions.properties.items.items;
    expect(item.properties.status.anyOf?.map((entry: any) => entry.const))
      .toEqual(expect.arrayContaining(['discussing', 'plan_review', 'implementing', 'completed']));
    expect(item.properties.goalMode).toBeUndefined();
  });

  test('handler wire samples validate against each schema (Value.Check)', () => {
    const listItem = {
      goalId: 'g1', phase: 'execute', loop: 1, nextAction: 'RUNNING_execute',
      error: null, updatedAt: '2026-11-13T00:00:00.000Z',
    };
    expect(Value.Check(GoalListResponse, { goals: [listItem] })).toBe(true);
    expect(Value.Check(GoalListResponse, { goals: [] })).toBe(true);
    // goals.get's same DTO (with wave counters) stays within the list schema.
    expect(Value.Check(GoalListResponse, { goals: [{ ...listItem, currentWave: 1, totalWaves: 3 }] })).toBe(true);

    expect(Value.Check(GoalSessionsResponse, {
      sessions: [
        { sessionID: 's1', phase: 'plan', loop: 1 },
        { sessionID: 's2', phase: 'execute', loop: 2, title: 'wave 2', time: { created: 1, updated: 2 } },
      ],
    })).toBe(true);

    const planApproval = {
      id: 'ap_1', status: 'pending', round: 1, revision: 2,
      planHash: 'w-hash', evalHash: null,
    };
    const plan = {
      planReview: 'manual', planApproval, planFeedback: null, round: 1, revision: 2,
      waves: {
        status: 'ready',
        taskType: 'feature',
        waves: [{ id: 'w1', tasks: [{ id: 't1', title: 'do it' }] }],
      },
      wavePlanPath: '/g/waves.json', wavesPath: '/g/waves.json',
      goalEval: {
        outcome: 'tests pass',
        conditions: [{ id: 'c1', statement: 'jest green', required: true, evidence: 'jest', method: 'run' }],
        failureConditions: ['jest red'], constraints: ['no new deps'], nonGoals: [],
        mapping: { c1: { tasks: ['t1'], probes: [], artifacts: [] } },
      },
      goalEvalPath: '/g/goal-eval.json', goalEvalError: null,
      planHash: 'w-hash', evalHash: 'e-hash', stale: false,
    };
    expect(Value.Check(GoalPlanResponse, plan)).toBe(true);
    expect([...Value.Errors(GoalPlanResponse, plan)]).toEqual([]);
    expect(Value.Check(GoalPlanResponse, {
      ...plan, waves: null, goalEval: null, goalEvalPath: null, planHash: null, planApproval: null,
    })).toBe(true);
    // A bare wave array is the pre-E10b-5 (wrong) wire shape: reject it, so the
    // schema cannot silently drift back to `GoalPlanWave[]`.
    expect(Value.Check(GoalPlanResponse, { ...plan, waves: [{ id: 'w1' }] })).toBe(false);
    // need_clarification documents carry `ambiguities` and no waves.
    expect(Value.Check(GoalPlanResponse, {
      ...plan, waves: { status: 'need_clarification', ambiguities: ['which DB?'] },
    })).toBe(true);

    const node = {
      runId: 7, loop: 1, node: 'execute', attempt: 1, status: 'completed', sessionId: 's1',
      startedAt: '2026-11-13T00:00:00.000Z', finishedAt: '2026-11-13T00:01:00.000Z',
      durationMs: 60000, outcome: 'ok', error: null,
      tokensInput: 10, tokensOutput: 20, costUsd: 0.01,
    };
    const timeline = {
      goal: {
        goalId: 'g1', title: 'Ship', phase: 'review', round: 1, maxRounds: 3,
        verdict: null, nextNode: 'review', nextAction: 'RUNNING_review',
        lastError: null, updatedAt: '2026-11-13T00:01:00.000Z',
        planReview: 'auto', planApproval: null,
      },
      nodes: [node, { ...node, runId: 8, outcome: null, error: null }],
      artifacts: { wavesPath: '/g/waves.json', receipts: ['ok', null], reviewsDir: '/g/reviews' },
    };
    expect(Value.Check(GoalTimelineResponse, timeline)).toBe(true);
    expect([...Value.Errors(GoalTimelineResponse, timeline)]).toEqual([]);
    // Unarchived goals omit outcome (undefined never reaches JSON).
    expect(Value.Check(GoalTimelineResponse, { ...timeline, outcome: undefined })).toBe(true);

    expect(Value.Check(GoalSourceResponse, {
      sourceRef: {
        sessionID: 's1', messageID: 'm1', snapshot: 'lead handoff text',
        capturedAt: '2026-11-13T00:00:00.000Z', topicId: 'topic_1',
        messageRange: { from: 'm1', to: 'm2' },
      },
      handoffPath: '/g/context/lead-handoff.md', fullText: '# handoff',
    })).toBe(true);
    expect(Value.Check(GoalSourceResponse, {
      sourceRef: null, handoffPath: null, fullText: null,
    })).toBe(true);

    const techLead = {
      goalId: 'g1', revision: 2, sessionID: 'sess_tl',
      messages: [{ info: { id: 'm1' }, parts: [{ type: 'text', text: 'hi' }] }],
      nextCursor: 'c1',
    };
    expect(Value.Check(PodTechLeadHistoryResponse, techLead)).toBe(true);
    expect(Value.Check(PodTechLeadHistoryResponse, {
      goalId: 'g1', revision: 2, sessionID: null, messages: [], sessionError: 'boot failed',
    })).toBe(true);

    const probe = {
      id: 'probe_1', podId: 'pod_1', goalId: 'g1', revision: 1, status: 'completed',
      request: {
        id: 'probe_1', podId: 'pod_1', goalId: 'g1', revision: 1,
        question: 'does it build?', hypothesis: 'yes',
        scope: { paths: ['.'], commandClasses: ['build'], network: false, credentials: [] },
        budget: { maxMinutes: 10, maxUsd: 1 },
        evidenceRequired: ['log'], affects: { planAssertions: ['a1'] },
      },
      report: {
        probeId: 'probe_1', conclusion: 'supports', commands: ['npm run build'], keyOutput: 'ok',
        repro: ['npm run build'], remainingAssumptions: [], impact: { plan: 'keep' },
      },
      error: null, requestPath: '/g/probes/probe_1/request.json',
      reportPath: '/g/probes/probe_1/report.json',
      createdAt: '2026-11-13T00:00:00.000Z',
      startedAt: '2026-11-13T00:00:01.000Z', endedAt: '2026-11-13T00:00:02.000Z',
    };
    expect(Value.Check(PodProbesResponse, { items: [probe] })).toBe(true);
    expect(Value.Check(PodProbesResponse, { items: [] })).toBe(true);

    const revision = {
      id: 'rev_1', podId: 'pod_1', goalId: 'g1', revision: 1, status: 'implementing',
      verdict: null, directionStatus: 'decided', directionJson: null,
      planHash: 'w-hash', evalHash: 'e-hash', feedback: null, priority: 0,
      enqueuedAt: '2026-11-13T00:00:00.000Z', startedAt: '2026-11-13T00:00:01.000Z',
      endedAt: null,
      // Row projection column (not part of the contract) must not break validation.
      goalMode: 'standard',
    };
    expect(Value.Check(PodGoalRevisionsResponse, { items: [revision] })).toBe(true);
    expect(Value.Check(PodGoalRevisionsResponse, { items: [] })).toBe(true);
  });
});

describe('api-contract: E10b-2 human-gate / permission read response schema (7 ops)', () => {
  const findOp = (operationId: string): any => {
    for (const methods of Object.values<any>(contract.paths)) {
      for (const candidate of Object.values<any>(methods)) {
        if (candidate?.operationId === operationId) return candidate;
      }
    }
    return null;
  };

  const schemaOf = (operationId: string): any =>
    findOp(operationId).responses['200']['content']['application/json'].schema;

  /** 每个 op 的承重 property + 数组元素必填（handler 恒发的字段）。 */
  const EXPECTED: Record<string, { fields: string[]; item?: { at: string; required: string[] } }> = {
    'approvals.list': {
      fields: ['approvals'],
      item: { at: 'approvals', required: ['id', 'question', 'status'] },
    },
    'questions.list': {
      fields: ['items'],
      item: { at: 'items', required: ['id', 'sessionID', 'questions'] },
    },
    'triage.list': {
      fields: ['items'],
      item: {
        at: 'items',
        required: [
          'id', 'automationId', 'discoveredAt', 'source', 'summary',
          'state', 'userAction', 'deadline',
        ],
      },
    },
    'permissions.list': {
      fields: ['items'],
      item: { at: 'items', required: ['id', 'sessionID', 'kind', 'targets'] },
    },
    'permissions.getMode': { fields: ['mode', 'autoApprovals', 'budget'] },
    'permissions.listAllowlist': {
      fields: ['entries'],
      item: { at: 'entries', required: ['tool'] },
    },
    'permissions.listRules': {
      fields: ['entries'],
      item: { at: 'entries', required: ['tool', 'action'] },
    },
  };

  test('seven ops expose a 200 JSON schema with properties (not a whole-response widening)', () => {
    const problems: string[] = [];
    for (const [operationId, spec] of Object.entries(EXPECTED)) {
      const op = findOp(operationId);
      if (!op) { problems.push(`${operationId}: missing from openapi.json`); continue; }
      const schema = op.responses?.['200']?.content?.['application/json']?.schema;
      if (!schema) { problems.push(`${operationId}: responses.200 missing application/json schema`); continue; }
      const properties = Object.keys(schema.properties ?? {});
      if (properties.length === 0) { problems.push(`${operationId}: schema has no properties (widened)`); continue; }
      for (const field of spec.fields) {
        if (!properties.includes(field)) problems.push(`${operationId}: schema missing property '${field}'`);
      }
    }
    if (problems.length) {
      console.error('[api-contract] E10b-2 response schema missing - run emit:openapi + merge-contract:\n' + problems.join('\n'));
    }
    expect(problems).toEqual([]);
  });

  test('array item required fields match the handler wire (approvals/items/entries)', () => {
    const problems: string[] = [];
    for (const [operationId, spec] of Object.entries(EXPECTED)) {
      if (!spec.item) continue;
      const required = schemaOf(operationId).properties?.[spec.item.at]?.items?.required ?? [];
      for (const field of spec.item.required) {
        if (!required.includes(field)) problems.push(`${operationId}: ${spec.item.at}.items missing required '${field}'`);
      }
    }
    expect(problems).toEqual([]);
  });

  test('overrides are gone: approvals / questions / triage now describe handler truth', () => {
    // approvals.list: handler scans user-questions files; goalId/createdAt are legacy-optional,
    // status is derived from `answered` and never 'expired' (the old override claimed otherwise).
    const approval = schemaOf('approvals.list').properties.approvals.items;
    expect(approval.required).toEqual(['id', 'question', 'status']);
    expect(approval.properties.goalId).toBeDefined();
    expect(approval.required).not.toContain('goalId');
    expect(approval.required).not.toContain('createdAt');
    expect(approval.properties.status.anyOf?.map((entry: any) => entry.const))
      .toEqual(['pending', 'answered']);

    // questions.list: projection always emits id/sessionID/questions; time only when createdAt exists.
    const question = schemaOf('questions.list').properties.items.items;
    expect(question.required).toEqual(['id', 'sessionID', 'questions']);
    expect(question.properties.time).toBeDefined();
    expect(question.required).not.toContain('time');
    expect(question.properties.questions.items.required).toEqual(['question', 'options']);

    // triage.list: automation-engine TriageItem (disk JSON passthrough), not the phantom
    // {goalId, reason, severity, createdAt} shape the override described.
    const triage = schemaOf('triage.list').properties.items.items;
    expect(triage.properties.goalId).toBeUndefined();
    expect(triage.properties.reason).toBeUndefined();
    expect(triage.properties.severity).toBeUndefined();
    expect(triage.properties.automationId).toBeDefined();
    expect(triage.properties.proposedGoal).toBeDefined();
    // axiom-distill writer omits proposedGoal -> optional.
    expect(triage.required).not.toContain('proposedGoal');
    expect(triage.properties.state.anyOf?.map((entry: any) => entry.const))
      .toEqual(['PENDING_CONFIRMATION', 'CONFIRMED', 'REJECTED']);
  });

  test('permissions.* pin the projection / policy / store shapes', () => {
    const perm = schemaOf('permissions.list').properties.items.items;
    expect(perm.properties.kind.type).toBe('string');
    expect(perm.properties.targets.type).toBe('array');
    expect(perm.properties.suggestedRule.properties.scope.anyOf?.map((entry: any) => entry.const))
      .toEqual(['tool', 'prefix']);

    const mode = schemaOf('permissions.getMode');
    expect(mode.required).toEqual(expect.arrayContaining(['mode', 'autoApprovals', 'budget']));
    expect(mode.properties.mode.anyOf?.map((entry: any) => entry.const))
      .toEqual(['read-only', 'auto', 'full-access']);

    const allow = schemaOf('permissions.listAllowlist').properties.entries.items;
    expect(allow.required).toEqual(['tool']);
    expect(allow.properties.prefix.type).toBe('string');

    const rules = schemaOf('permissions.listRules').properties.entries.items;
    expect(rules.required).toEqual(expect.arrayContaining(['tool', 'action']));
    expect(rules.properties.action.const).toBe('allow');
    expect(rules.properties.pattern.type).toBe('string');
  });

  test('handler wire samples validate against each schema (Value.Check)', () => {
    // Flat legacy file (goalId + createdAt) and nested legacy (goalId from dir name).
    expect(Value.Check(ApprovalListResponse, {
      approvals: [
        { id: 'flat-1', goalId: 'g1', question: 'Q1', status: 'pending', createdAt: 't1' },
        { id: 'q_1', question: 'Q2', status: 'answered' },
      ],
    })).toBe(true);
    expect([...Value.Errors(ApprovalListResponse, {
      approvals: [{ id: 'q_1', question: 'Q2', status: 'paused' }],
    })]).not.toEqual([]);

    expect(Value.Check(QuestionListResponse, {
      items: [{
        id: 'que_1', sessionID: 's1',
        questions: [{ question: 'Pick', header: 'H', options: [{ label: 'a' }, { label: 'b', description: 'B' }], multiple: true }],
        tool: { messageID: 'm1', callID: 'c1' },
        time: { created: 1 },
        // residual runtime fields are passed through untouched
        form: { mode: 'single' },
      }],
    })).toBe(true);

    const triage = {
      id: 'triage-1', automationId: 'auto-1', discoveredAt: '2026-11-13T00:00:00.000Z',
      source: 'skill-promotion', summary: { skillDraft: { name: 'x', memoryId: 'mem-1' } },
      proposedGoal: { title: 'Materialize skill x', boundaries: [], estimatedLoops: 1 },
      state: 'PENDING_CONFIRMATION', userAction: null,
      deadline: '2026-11-20T00:00:00.000Z', llmSuggestions: [],
      updatedAt: '2026-11-13T00:00:00.000Z',
    };
    expect(Value.Check(TriageListResponse, { items: [triage] })).toBe(true);
    // axiom-distill writer: no proposedGoal, no llmSuggestions.
    expect(Value.Check(TriageListResponse, {
      items: [{ ...triage, proposedGoal: undefined, llmSuggestions: undefined, summary: { axiomDraft: { candidates: ['a'] } } }],
    })).toBe(true);
    expect(Value.Check(TriageListResponse, { items: [] })).toBe(true);

    expect(Value.Check(PermissionListResponse, {
      items: [{
        id: 'per_1', sessionID: 's1', kind: 'bash', targets: ['ls'],
        suggestedRule: { scope: 'prefix', value: 'ls' },
        tool: { messageID: 'm1', callID: 'c1' },
        time: { created: 1 },
        extensions: { metadata: { impact: 'read' }, risk: 'low' },
      }],
    })).toBe(true);
    expect(Value.Check(PermissionListResponse, { items: [{ id: 'per_2', sessionID: 's1', kind: 'tool', targets: [] }] })).toBe(true);

    expect(Value.Check(PermissionModeResponse, { mode: 'read-only', autoApprovals: 0, budget: 25 })).toBe(true);
    expect(Value.Check(AllowlistListResponse, { entries: [{ tool: 'read' }, { tool: 'bash', prefix: 'git' }] })).toBe(true);
    expect(Value.Check(PermissionRulesListResponse, {
      entries: [{ tool: 'bash', action: 'allow' }, { tool: 'edit', pattern: 'src/**', action: 'allow' }],
    })).toBe(true);
  });
});

describe('api-contract: E11-1 human token rotation response schema', () => {
  const findOp = (operationId: string): any => {
    for (const methods of Object.values<any>(contract.paths)) {
      for (const candidate of Object.values<any>(methods)) {
        if (candidate?.operationId === operationId) return candidate;
      }
    }
    return null;
  };

  test('humanToken.rotate is catalogued as an auth POST returning {token, rotatedAt}', () => {
    const op = findOp('humanToken.rotate');
    expect(op).toBeTruthy();
    expect(op.tags).toContain('auth');
    const schema = op.responses?.['200']?.content?.['application/json']?.schema;
    expect(schema).toBeTruthy();
    expect(Object.keys(schema.properties).sort()).toEqual(['rotatedAt', 'token']);
    expect([...schema.required].sort()).toEqual(['rotatedAt', 'token']);
    expect(schema.properties.token.type).toBe('string');
    expect(schema.properties.rotatedAt.type).toBe('string');
  });
});

describe('api-contract: contract 产物新鲜度', () => {
  test('openapi.json paths/operationId ≡ catalog 当前生成结果', () => {
    const expected = registry.toOpenApiPaths();
    const contractPaths = contract.paths as Record<string, any>;
    const missing = Object.keys(expected).filter((p) => !(p in contractPaths));
    const extra = Object.keys(contractPaths).filter((p) => !(p in expected));
    const idDrift: string[] = [];
    for (const [p, methods] of Object.entries<any>(expected)) {
      const cp = contractPaths[p];
      if (!cp) continue;
      for (const [m, op] of Object.entries<any>(methods)) {
        if (!cp[m]) { idDrift.push(`${m.toUpperCase()} ${p} 缺失`); continue; }
        if (cp[m].operationId !== op.operationId) idDrift.push(`${m.toUpperCase()} ${p}: ${cp[m].operationId} ≠ ${op.operationId}`);
      }
    }
    const problems = [...missing.map((p) => `contract 缺 path ${p}`), ...extra.map((p) => `contract 多 path ${p}`), ...idDrift];
    if (problems.length) {
      console.error('[api-contract] 契约产物过期 —— 先跑: (gateway) npm run emit:openapi && (sdk) npm run merge-contract\n' + problems.join('\n'));
    }
    expect(problems).toEqual([]);
  });
});

describe('api-contract: E10c-1 memory / recall / lead read response schema (8 ops)', () => {
  const findOp = (operationId: string): any => {
    for (const methods of Object.values<any>(contract.paths)) {
      for (const candidate of Object.values<any>(methods)) {
        if (candidate?.operationId === operationId) return candidate;
      }
    }
    return null;
  };

  const schemaOf = (operationId: string): any =>
    findOp(operationId).responses['200']['content']['application/json'].schema;

  /** ÿ�� op �ĳ��� property + ����Ԫ�ر��handler �㷢���ֶΣ��� */
  const EXPECTED: Record<string, { fields: string[]; item?: { at: string; required: string[] } }> = {
    'memory.search': {
      fields: ['results', 't1Results'],
      item: {
        at: 'results',
        required: ['id', 'type', 'primary_abstraction', 'cue_anchors', 'memory_value', 'energy'],
      },
    },
    'recall.context': { fields: ['pointers'] },
    'recall.pinned': {
      fields: ['profile', 'entries', 'budget'],
      item: { at: 'entries', required: ['id', 'type', 'primary_abstraction', 'memory_value', 'energy'] },
    },
    'recall.instructions': {
      fields: ['managed', 'revision', 'missing', 'staleKeys', 'erroredKeys', 'blocks'],
    },
    'recall.priors': { fields: ['block', 'used', 'budget'] },
    'lead.recall': {
      fields: ['candidates'],
      item: { at: 'candidates', required: ['topicId', 'title', 'score', 'matches'] },
    },
    'lead.workingSet': {
      fields: ['resident', 'warm', 'cold', 'pinned', 'evicted', 'topics'],
      item: {
        at: 'topics',
        required: ['id', 'title', 'summary', 'state', 'lastActiveAt', 'goalId', 'resumedFrom'],
      },
    },
  };

  test('seven flat ops expose a 200 JSON schema with properties (not a whole-response widening)', () => {
    const problems: string[] = [];
    for (const [operationId, spec] of Object.entries(EXPECTED)) {
      const op = findOp(operationId);
      if (!op) { problems.push(`${operationId}: missing from openapi.json`); continue; }
      const schema = op.responses?.['200']?.content?.['application/json']?.schema;
      if (!schema) { problems.push(`${operationId}: responses.200 missing application/json schema`); continue; }
      const properties = Object.keys(schema.properties ?? {});
      if (properties.length === 0) { problems.push(`${operationId}: schema has no properties (widened)`); continue; }
      for (const field of spec.fields) {
        if (!properties.includes(field)) problems.push(`${operationId}: schema missing property '${field}'`);
      }
    }
    if (problems.length) {
      console.error('[api-contract] E10c-1 response schema missing - run emit:openapi + merge-contract:\n' + problems.join('\n'));
    }
    expect(problems).toEqual([]);
  });

  test('array item required fields match the handler wire', () => {
    const problems: string[] = [];
    for (const [operationId, spec] of Object.entries(EXPECTED)) {
      if (!spec.item) continue;
      const required = schemaOf(operationId).properties?.[spec.item.at]?.items?.required ?? [];
      for (const field of spec.item.required) {
        if (!required.includes(field)) problems.push(`${operationId}: ${spec.item.at}.items missing required '${field}'`);
      }
    }
    expect(problems).toEqual([]);
  });

  test('memory.search is code-first: override entry gone, layer-dependent t1Results stays optional', () => {
    const overrides = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'packages', 'gateway-sdk', 'contract', 'overrides.json'), 'utf-8'));
    expect(overrides.operations['memory.search']).toBeUndefined();
    const schema = schemaOf('memory.search');
    expect(schema.required).toEqual(['results']);
    // handler only emits t1Results for layer=t1|both -> optional, never required.
    expect(schema.properties.t1Results).toBeDefined();
    expect(schema.required).not.toContain('t1Results');
    const unit = schema.properties.results.items;
    expect(unit.properties.salience).toBeDefined();
    expect(unit.required).not.toContain('salience');
    expect(unit.properties.created_at).toBeDefined();
    expect(unit.required).not.toContain('created_at');
    expect(unit.properties.type.anyOf?.map((entry: any) => entry.const))
      .toEqual(['episodic', 'semantic', 'procedural', 'global']);
    const t1 = schema.properties.t1Results.items;
    expect(t1.required).toEqual(expect.arrayContaining(['sessionId', 'turnId', 'cosine', 'excerpt']));
    expect(t1.properties.traceId).toBeDefined();
    expect(t1.required).not.toContain('traceId');
  });

  test('memory.get models the three success bodies as a union, 404 error envelope excluded', () => {
    const schema = schemaOf('memory.get');
    expect(schema.anyOf).toHaveLength(3);
    // Variant 1: harmonic unit (+ optional latest / source).
    const unit = schema.anyOf[0];
    expect([...unit.required].sort()).toEqual(['memory', 'success']);
    expect(unit.properties.memory.required).toEqual(expect.arrayContaining([
      'id', 'type', 'primary_abstraction', 'cue_anchors', 'memory_value',
      'energy', 'updated_at',
    ]));
    // Legacy OKF files may omit created_at (same store.read() source as recall.pinned).
    expect(unit.properties.memory.required).not.toContain('created_at');
    expect(unit.properties.latest).toBeDefined();
    expect(unit.properties.source).toBeDefined();
    // Variants 2/3: t1 pointer payloads (legacy session tail vs permanent trace).
    const legacyRows = schema.anyOf[1].properties.t1.properties.rows.items.required;
    expect(legacyRows).toEqual(['source', 'content']);
    const trace = schema.anyOf[2].properties.t1;
    expect(trace.required).toEqual(expect.arrayContaining([
      'traceId', 'sessionId', 'turnId', 'archived', 'legacyAmbiguous', 'rows',
    ]));
    // The error envelope ({success:false,error,candidates?}) ships on 404, not on the 200 schema.
    for (const variant of schema.anyOf) {
      expect(variant.properties.error).toBeUndefined();
    }
  });

  test('handler wire samples validate against each schema (Value.Check)', () => {
    const unit = {
      id: 'mem-1', type: 'semantic', primary_abstraction: 'abstraction',
      cue_anchors: ['gateway/src/routes/recall.ts'], memory_value: 'value', energy: 0.7,
    };
    expect(Value.Check(MemorySearchResponse, { results: [unit] })).toBe(true);
    expect(Value.Check(MemorySearchResponse, { results: [{ ...unit, salience: 1, created_at: 't' }] })).toBe(true);
    // layer=both / t1: results + t1Results (raw dense hit without traceId).
    expect(Value.Check(MemorySearchResponse, {
      results: [],
      t1Results: [
        { sessionId: 's1', turnId: 3, cosine: 0.4, excerpt: 'raw' },
        { sessionId: 's1', turnId: 4, traceId: null, cosine: 0, excerpt: 'lex', sources: ['lexical'], score: 0.03 },
        { sessionId: 's1', turnId: 5, traceId: 'tr_1', cosine: 0.2, excerpt: 'fused', sources: ['dense', 'lexical'], score: 0.05 },
      ],
    })).toBe(true);
    // memory_value is load-bearing: the degraded index row still carries it.
    expect(Value.Check(MemorySearchResponse, { results: [{ ...unit, memory_value: undefined }] })).toBe(false);

    const harmonic = {
      id: 'mem-1', type: 'procedural', primary_abstraction: 'a', cue_anchors: ['c'],
      memory_value: 'v', energy: 0.5, created_at: '2026-11-14T00:00:00.000Z',
      updated_at: '2026-11-14T00:00:00.000Z', pinned: true, authority: 'user',
      superseded_by: 'mem-2', distinct_from: ['mem-3'], novelty: 0.1,
    };
    expect(Value.Check(MemoryGetResponse, {
      success: true, memory: harmonic,
      latest: { ...harmonic, id: 'mem-2', superseded_by: undefined },
      source: {
        sessionId: 's1',
        traces: [{ traceId: 'tr_1', sessionId: 's1', turnId: 7, archived: false, excerpt: 'e' }],
      },
    })).toBe(true);
    // C0 fallback: evidence instead of traces.
    expect(Value.Check(MemoryGetResponse, { success: true, memory: harmonic, source: { sessionId: 's1', evidence: 'raw' } })).toBe(true);
    // t1 legacy pointer + permanent trace pointer.
    expect(Value.Check(MemoryGetResponse, {
      success: true,
      t1: { sessionId: 's1', turnId: 7, rows: [{ source: 'user', content: 'hi' }] },
    })).toBe(true);
    expect(Value.Check(MemoryGetResponse, {
      success: true,
      t1: {
        traceId: 'tr_1', sessionId: 's1', turnId: 7, archived: true, legacyAmbiguous: false,
        rows: [{ source: 'user', content: 'hi', observationKey: 'obs_1' }],
      },
    })).toBe(true);
    // The 404 error envelope is not a 200 body.
    expect(Value.Check(MemoryGetResponse, { success: false, error: 'memory not found: x' })).toBe(false);

    expect(Value.Check(RecallContextResponse, { pointers: null })).toBe(true);
    expect(Value.Check(RecallContextResponse, { pointers: '<recall>��</recall>' })).toBe(true);
    expect(Value.Check(RecallContextResponse, {})).toBe(false);

    expect(Value.Check(RecallPinnedResponse, { profile: null, entries: [], budget: { max: 20, maxChars: 2000, used: 0 } })).toBe(true);
    expect(Value.Check(RecallPinnedResponse, {
      profile: '<user-profile>��</user-profile>',
      entries: [{ id: 'mem-1', type: 'semantic', primary_abstraction: 'a', memory_value: 'v', energy: 0.9, salience: 2, created_at: 't' }],
      budget: { max: 20, maxChars: 2000, used: 1 },
    })).toBe(true);

    expect(Value.Check(RecallInstructionsResponse, {
      managed: false, revision: 'r1', missing: ['memory_guide'], staleKeys: [], erroredKeys: [],
      blocks: { memoryGuide: '# guide' },
    })).toBe(true);
    // managed:true carries an empty blocks object (no duplicate injection) + optional reason.
    expect(Value.Check(RecallInstructionsResponse, {
      managed: true, revision: 'r1', missing: [], staleKeys: ['k'], erroredKeys: [], reason: 'stale', blocks: {},
    })).toBe(true);
    expect(Value.Check(RecallInstructionsResponse, { managed: true, revision: '', missing: [], staleKeys: [], erroredKeys: [] })).toBe(false);

    expect(Value.Check(RecallPriorsResponse, { block: null, used: 0, budget: { maxChars: 800 } })).toBe(true);
    expect(Value.Check(RecallPriorsResponse, { block: '<agent-priors>��', used: 5, budget: { maxChars: 800 } })).toBe(true);

    expect(Value.Check(LeadRecallResponse, {
      candidates: [{ topicId: 'topic_1', title: 'Ship E10c', score: 0.9, matches: ['e10c'] }],
    })).toBe(true);
    expect(Value.Check(LeadRecallResponse, { candidates: [] })).toBe(true);

    const topic = {
      id: 'topic_1', title: 'Ship E10c', summary: null, state: 'warm',
      lastActiveAt: '2026-11-14T00:00:00.000Z', goalId: 'g1', resumedFrom: null,
    };
    expect(Value.Check(LeadWorkingSetResponse, {
      resident: ['topic_1'], warm: [], cold: [], pinned: [], evicted: [], topics: [topic],
    })).toBe(true);
    expect(Value.Check(LeadWorkingSetResponse, {
      resident: [], warm: [], cold: [], pinned: [], evicted: [], topics: [{ ...topic, summary: 's', state: 'resident' }],
    })).toBe(true);
    // state is a closed vocabulary (lead-topic-store normalizeState).
    expect(Value.Check(LeadWorkingSetResponse, {
      resident: [], warm: [], cold: [], pinned: [], evicted: [], topics: [{ ...topic, state: 'hot' }],
    })).toBe(false);
  });
});

describe('api-contract: E10d-1 memory extra / lead.context / pod read response schema (8 ops)', () => {
  const findOp = (operationId: string): any => {
    for (const methods of Object.values<any>(contract.paths)) {
      for (const candidate of Object.values<any>(methods)) {
        if (candidate?.operationId === operationId) return candidate;
      }
    }
    return null;
  };

  const schemaOf = (operationId: string): any =>
    findOp(operationId).responses['200']['content']['application/json'].schema;

  /** 每个 op 的承重 property + 数组元素必填（handler 恒发的字段）。 */
  const EXPECTED: Record<string, { fields: string[]; item?: { at: string; required: string[] } }> = {
    'memory.mergedSearch': {
      fields: ['results'],
      item: { at: 'results', required: ['source', 'type', 'content', 'energy'] },
    },
    'memory.getEnergyDistribution': {
      fields: ['critical', 'high', 'medium', 'low', 'total'],
    },
    'memory.getL5Axioms': {
      fields: ['axioms', 'heuristics'],
      item: { at: 'axioms', required: ['id', 'content', 'source', 'energy', 'created_at'] },
    },
    'memory.listSticky': {
      fields: ['entries', 'budget'],
      item: { at: 'entries', required: ['id', 'type', 'primary_abstraction', 'memory_value', 'energy'] },
    },
    'lead.context': {
      fields: ['blocks', 'totalTokens', 'recalledTopicIds', 'trimmed'],
      item: { at: 'blocks', required: ['kind', 'text', 'tokens'] },
    },
    'pods.lookup': {
      fields: ['pod', 'members', 'goals', 'attention', 'messageHealth', 'tasks', 'sessions'],
    },
    'pods.transcript': { fields: ['transcript'] },
    'pods.goals.worktree.diff': {
      fields: ['goalId', 'revision', 'branch', 'baseRef', 'files'],
      item: { at: 'files', required: ['file', 'patch', 'additions', 'deletions', 'status'] },
    },
  };

  test('all eight ops expose a 200 JSON schema with the handler wire properties', () => {
    const problems: string[] = [];
    for (const [operationId, spec] of Object.entries(EXPECTED)) {
      const op = findOp(operationId);
      if (!op) { problems.push(`${operationId}: missing from openapi.json`); continue; }
      const schema = op.responses?.['200']?.content?.['application/json']?.schema;
      if (!schema) { problems.push(`${operationId}: responses.200 missing application/json schema`); continue; }
      const properties = Object.keys(schema.properties ?? {});
      if (properties.length === 0) { problems.push(`${operationId}: schema has no properties (widened)`); continue; }
      for (const field of spec.fields) {
        if (!properties.includes(field)) problems.push(`${operationId}: schema missing property '${field}'`);
      }
    }
    if (problems.length) {
      console.error('[api-contract] E10d-1 response schema missing - run emit:openapi + merge-contract:\n' + problems.join('\n'));
    }
    expect(problems).toEqual([]);
  });

  test('array item required fields match the handler wire', () => {
    const problems: string[] = [];
    for (const [operationId, spec] of Object.entries(EXPECTED)) {
      if (!spec.item) continue;
      const required = schemaOf(operationId).properties?.[spec.item.at]?.items?.required ?? [];
      for (const field of spec.item.required) {
        if (!required.includes(field)) problems.push(`${operationId}: ${spec.item.at}.items missing required '${field}'`);
      }
    }
    expect(problems).toEqual([]);
  });

  test('nested shapes: L5 heuristics, note-board budget, lead block vocabulary', () => {
    const l5 = schemaOf('memory.getL5Axioms');
    expect([...l5.required].sort()).toEqual(['axioms', 'heuristics']);
    expect([...l5.properties.heuristics.items.required].sort()).toEqual([
      'created_at', 'energy', 'id', 'pattern', 'source_goal_ids', 'success_rate', 'trigger_context',
    ]);
    expect(l5.properties.axioms.items.properties.source.anyOf.map((entry: any) => entry.const))
      .toEqual(['manual', 'distilled']);

    const sticky = schemaOf('memory.listSticky');
    expect([...sticky.properties.budget.required].sort()).toEqual(['max', 'maxChars', 'used']);
    expect([...sticky.properties.entries.items.required].sort())
      .toEqual(['energy', 'id', 'memory_value', 'primary_abstraction', 'type']);
    // HarmonicUnit.type vocabulary, same as memory.search results.
    expect(sticky.properties.entries.items.properties.type.anyOf.map((entry: any) => entry.const))
      .toEqual(['episodic', 'semantic', 'procedural', 'global']);

    const lead = schemaOf('lead.context');
    const block = lead.properties.blocks.items;
    expect(block.properties.kind.anyOf.map((entry: any) => entry.const))
      .toEqual(['goal-status', 'topic-index', 'recalled-topic']);
    // topicId/title only exist on recalled-topic blocks -> optional, never required.
    expect(block.required).toContain('kind');
    expect(block.required).toContain('text');
    expect(block.required).toContain('tokens');
    expect(block.required).not.toContain('topicId');
    expect(block.required).not.toContain('title');
  });

  test('pods.transcript.transcript stays a runtime-owned boundary object', () => {
    const schema = schemaOf('pods.transcript');
    expect(schema.required).toEqual(['transcript']);
    // Boundary object: the payload is the runtime session history (owner = runtime).
    // An empty JSON Schema means "any JSON value" — no whole-response widening beyond
    // the one key the handler always sends.
    expect(schema.properties.transcript).toEqual({});
    expect(Object.keys(schema.properties)).toEqual(['transcript']);
  });

  test('pods.goals.worktree.diff response mirrors the SDK PodWorktreeDiff field set', () => {
    const schema = schemaOf('pods.goals.worktree.diff');
    expect([...schema.required].sort()).toEqual(['baseRef', 'branch', 'files', 'goalId', 'revision']);
    expect(Object.keys(schema.properties).sort()).toEqual(['baseRef', 'branch', 'files', 'goalId', 'revision']);
    expect(schema.properties.revision.type).toBe('number');
    const file = schema.properties.files.items;
    expect([...file.required].sort()).toEqual(['additions', 'deletions', 'file', 'patch', 'status']);
    expect(file.properties.additions.type).toBe('number');
    expect(file.properties.deletions.type).toBe('number');
  });

  test('handler wire samples validate against each new schema (Value.Check)', () => {
    // memory.mergedSearch: MemoryFact (parametric delta vs harmonic unit).
    const fact = { source: 'harmonic', type: 'semantic', content: 'abstraction', energy: 0.8 };
    expect(Value.Check(MemoryMergedSearchResponse, { results: [fact] })).toBe(true);
    expect(Value.Check(MemoryMergedSearchResponse, {
      results: [{ source: 'parametric', type: 'delta', content: '[Δ] x', energy: 0.8 }],
    })).toBe(true);
    expect(Value.Check(MemoryMergedSearchResponse, { results: [] })).toBe(true);
    expect(Value.Check(MemoryMergedSearchResponse, { results: [{ ...fact, source: 'index' }] })).toBe(false);

    // memory.getEnergyDistribution: exactly the five bucket counters.
    expect(Value.Check(MemoryEnergyDistributionResponse, {
      critical: 1, high: 2, medium: 3, low: 4, total: 10,
    })).toBe(true);
    expect(Value.Check(MemoryEnergyDistributionResponse, { critical: 1, high: 2, medium: 3, low: 4 })).toBe(false);

    // memory.getL5Axioms: L5Store.getTop() pass-through.
    expect(Value.Check(MemoryL5AxiomsResponse, {
      axioms: [{ id: 'l5_1', content: 'a', source: 'manual', energy: 0.8, created_at: 't' }],
      heuristics: [{
        id: 'l5_2', pattern: 'p', trigger_context: ['c'], success_rate: 0.9,
        source_goal_ids: ['g1'], energy: 0.8, created_at: 't',
      }],
    })).toBe(true);
    expect(Value.Check(MemoryL5AxiomsResponse, {
      axioms: [{ id: 'l5_1', content: 'a', source: 'dreamed', energy: 0.8, created_at: 't' }],
      heuristics: [],
    })).toBe(false);

    // memory.listSticky: note-board entries + budget; the 503/fail-open body is shape-identical.
    const note = {
      id: 'mem-1', type: 'semantic', primary_abstraction: 'a', memory_value: 'v', energy: 0.9,
      created_at: 't', sticky_until: '2026-11-21T00:00:00.000Z',
    };
    expect(Value.Check(MemoryStickyResponse, { entries: [note], budget: { max: 12, maxChars: 1200, used: 1 } })).toBe(true);
    expect(Value.Check(MemoryStickyResponse, { entries: [], budget: { max: 12, maxChars: 1200, used: 0 } })).toBe(true);
    expect(Value.Check(MemoryStickyResponse, {
      entries: [{ ...note, type: 'hot' }], budget: { max: 12, maxChars: 1200, used: 1 },
    })).toBe(false);

    // lead.context: LeadContext (blocks + counters); empty context is the fail-open body.
    expect(Value.Check(LeadContextResponse, {
      blocks: [
        { kind: 'goal-status', text: '<goal-status>\n</goal-status>', tokens: 3 },
        { kind: 'recalled-topic', topicId: 'topic_1', title: 'Ship E10d', text: 'x', tokens: 5 },
      ],
      totalTokens: 8,
      recalledTopicIds: ['topic_1'],
      trimmed: ['topic-index'],
    })).toBe(true);
    expect(Value.Check(LeadContextResponse, {
      blocks: [], totalTokens: 0, recalledTopicIds: [], trimmed: [],
    })).toBe(true);
    expect(Value.Check(LeadContextResponse, {
      blocks: [{ kind: 'summary', text: 'x', tokens: 1 }], totalTokens: 1, recalledTopicIds: [], trimmed: [],
    })).toBe(false);

    // pods.lookup is the same schema as pods.get: same PodDetail wire.
    expect(schemaOf('pods.lookup')).toEqual(schemaOf('pods.get'));

    // pods.transcript: runtime-owned payload passes through untouched.
    expect(Value.Check(PodTranscriptResponse, { transcript: null })).toBe(true);
    expect(Value.Check(PodTranscriptResponse, { transcript: { messages: [{ role: 'user' }] } })).toBe(true);
    expect(Value.Check(PodTranscriptResponse, {})).toBe(false);

    // pods.goals.worktree.diff: PodWorktreeService.branchDiff() return value.
    const diff = {
      goalId: 'g1', revision: 2, branch: 'pod/g1/r2', baseRef: 'main',
      files: [{ file: 'gateway/src/index.ts', patch: '@@', additions: 3, deletions: 1, status: 'M' }],
    };
    expect(Value.Check(PodWorktreeDiffResponse, diff)).toBe(true);
    expect(Value.Check(PodWorktreeDiffResponse, { ...diff, files: [{ file: 'x' }] })).toBe(false);
    expect(Value.Check(PodWorktreeDiffResponse, { ...diff, files: [] })).toBe(true);
  });
});
