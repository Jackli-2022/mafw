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
import {
  AttentionListResponse,
  DecisionListResponse,
  OrchestrationOutcomesResponse,
} from '../../src/routes/schemas/read-models';
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
  PodMemoryResponse,
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
import {
  TaskCancelResponse,
  TaskGetResponse,
  TaskListResponse,
  TaskMessageResponse,
  TaskOutputResponse,
  TaskSubmitResponse,
} from '../../src/routes/schemas/tasks';
import { SessionCreateResponse } from '../../src/routes/schemas/session';
import {
  SessionCheckpointResponse,
  SessionCommandResponse,
  SessionDeleteLegacyResponse,
  SessionPromptAsyncResponse,
  SessionPromptResponse,
  SessionQueueCancelResponse,
  SessionQueueClearResponse,
  SessionSubagentSpawnResponse,
  SessionSuspendResponse,
  SessionUsagePluginsReloadResponse,
  StructuredSubmitResponse,
} from '../../src/routes/schemas/session-write-responses';
import {
  SessionDiscoveryResponse,
  SessionDiscoverySkillResponse,
  SessionRunResponse,
  SessionStructuredResponse,
  SessionTrajectoryResponse,
} from '../../src/routes/schemas/session-runtime';
import { CognitionRulesResponse, ExperienceActionsResponse } from '../../src/routes/schemas/experience';
import {
  BackgroundJobCancelResponse,
  BackgroundJobOutputResponse,
  BackgroundJobsListResponse,
} from '../../src/routes/schemas/background';
import {
  TerminalConnectTicketResponse,
  TerminalCreateResponse,
  TerminalListResponse,
  TerminalRemoveResponse,
} from '../../src/routes/schemas/terminal';
import {
  FileHistoryRestoreResponse,
  FileHistorySnapshotResponse,
} from '../../src/routes/schemas/project-meta';
import {
  PodA2AResponse,
  PodEventSeenAllResponse,
  PodEventSeenResponse,
  PodGoalAcceptResponse,
  PodGoalCancelResponse,
  PodGoalCreateResponse,
  PodGoalDirectionResponse,
  PodGoalHandoffResponse,
  PodGoalRejectResponse,
  PodLeadEnsureResponse,
  PodMemoryWriteResponse,
  PodMessageCreateResponse,
  PodMessageDeliveryDismissResponse,
  PodMessageDeliveryRetryResponse,
  PodMessageReadResponse,
  PodTaskDeleteResponse,
  PodTechLeadMessageResponse,
} from '../../src/routes/schemas/pod-write-responses';
import {
  SessionUsageResponse,
  UsagePluginSourceResponse,
  UsagePluginsListResponse,
} from '../../src/routes/schemas/usage';
import {
  AgentListResponse,
  ConfigGetResponse,
  McpServersResponse,
  PluginsListResponse,
  ProviderListResponse,
  SchedulerStatusResponse,
  SkillsListResponse,
  ToolsListResponse,
} from '../../src/routes/schemas/meta';
import {
  FileHistoryListResponse,
  MafwCommandsListResponse,
  ManagerSessionResponse,
  ProjectCurrentResponse,
} from '../../src/routes/schemas/project-meta';
import {
  PluginsClientResponse,
  RuntimeConfigGetResponse,
  RuntimeContractResponse,
  RuntimeGetResponse,
} from '../../src/routes/schemas/runtime-surface';
import {
  AgentCapabilitiesResponse,
  EmbeddingGetResponse,
  MediaPluginsResponse,
  MediaResolveTaskResponse,
  ModelConfigGetResponse,
  PythonStatusResponse,
  TtsVoicesResponse,
  VoiceStatusResponse,
} from '../../src/routes/schemas/media-voice';
import {
  LeadBoundariesResponse,
  LeadTopicGetResponse,
  LeadTopicsResponse,
} from '../../src/routes/schemas/lead';
import {
  EventDeliveriesResponse,
  EventSourcesResponse,
  EventSubscriptionsResponse,
  EventThreadsResponse,
  EventTriggersResponse,
} from '../../src/routes/schemas/events';
import {
  StandingGoalListResponse,
  StandingGoalRunsResponse,
} from '../../src/routes/schemas/standing';
import {
  AutomationGetResponse,
  AutomationHistoryResponse,
  AutomationsListResponse,
} from '../../src/routes/schemas/automations';
import { DeviceListResponse, PairingCodeResponse } from '../../src/routes/schemas/devices';
import {
  DashboardStatsResponse,
  HealthResponse,
  SessionSubagentResultResponse,
} from '../../src/routes/schemas/observability';
import { A2AAgentCardResponse } from '../../src/routes/schemas/a2a';
import { PluginsAuditResponse, PluginLastGoodResponse } from '../../src/routes/schemas/plugin-recovery';
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
    // E10f-E: the formatter budget carries the anti-starvation per-note cap
    // (`NOTE_BOARD_BUDGET = { max, maxChars, perNoteCap }` + `used`).
    expect([...sticky.properties.budget.required].sort()).toEqual(['max', 'maxChars', 'perNoteCap', 'used']);
    expect(sticky.properties.budget.properties.perNoteCap.type).toBe('number');
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
    expect(Value.Check(MemoryStickyResponse, {
      entries: [note], budget: { max: 10, maxChars: 1600, perNoteCap: 240, used: 1 },
    })).toBe(true);
    expect(Value.Check(MemoryStickyResponse, {
      entries: [], budget: { max: 10, maxChars: 1600, perNoteCap: 240, used: 0 },
    })).toBe(true);
    // E10f-E: perNoteCap is part of every budget body — including the 503 shell.
    expect(Value.Check(MemoryStickyResponse, {
      entries: [], budget: { max: 10, maxChars: 1600, used: 0 },
    })).toBe(false);
    expect(Value.Check(MemoryStickyResponse, {
      entries: [{ ...note, type: 'hot' }], budget: { max: 10, maxChars: 1600, perNoteCap: 240, used: 1 },
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

describe('api-contract: E10e-1 metadata / registry read response schema (8 ops)', () => {
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
    'agents.list': {
      fields: ['items'],
      item: { at: 'items', required: ['id', 'label', 'source', 'selectable'] },
    },
    'providers.list': {
      fields: ['items', 'connected', 'default'],
      item: { at: 'items', required: ['id', 'name', 'models'] },
    },
    'mcp.servers': {
      fields: ['servers'],
      item: { at: 'servers', required: ['name', 'status'] },
    },
    'plugins.list': {
      fields: ['plugins', 'packages'],
      item: {
        at: 'plugins',
        required: ['type', 'name', 'file', 'status', 'size', 'mtime'],
      },
    },
    'skills.list': {
      fields: ['skills'],
      item: {
        at: 'skills',
        required: [
          'name', 'version', 'status', 'sourceMemoryIds', 'sourceTraceIds',
          'installedAt', 'updatedAt', 'deoptReason', 'stats',
        ],
      },
    },
    'tools.list': {
      fields: ['tools'],
      item: { at: 'tools', required: ['name', 'description', 'parameters'] },
    },
    'config.get': { fields: CONFIG_SECTION_KEYS_FOR_TEST() },
    'scheduler.status': { fields: ['active', 'queued', 'capacity', 'plan'] },
  };

  /** `GatewayConfig` 顶层 section 名（与 schemas/meta.ts 的台账一致，测试侧独立抄写）。 */
  function CONFIG_SECTION_KEYS_FOR_TEST(): string[] {
    return [
      'server', 'paths', 'timeouts', 'loop', 'goal', 'mobile', 'search', 'memory',
      'decay', 'llm', 'logging', 'mcpserver', 'metrics', 'chat', 'manager', 'recall',
      'usage', 'trajectory', 'approval', 'media', 'cognition', 'events', 'runtime',
      'alignment', 'resources', 'env',
    ];
  }

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
      console.error('[api-contract] E10e-1 response schema missing - run emit:openapi + merge-contract:\n' + problems.join('\n'));
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

  test('view DTO projections pin the closed vocabularies (agent source, model refs, mcp state)', () => {
    const agent = schemaOf('agents.list').properties.items.items;
    expect(agent.properties.source.anyOf?.map((entry: any) => entry.const)).toEqual(['mafw', 'runtime']);
    expect(agent.properties.model.required).toEqual(['providerID', 'modelID']);
    // 投影条件展开的字段不能变成 required（runtime 原生 agent 可能不带 mode/model）。
    expect(agent.required).not.toContain('model');
    expect(agent.required).not.toContain('mode');
    expect(agent.required).not.toContain('description');

    const provider = schemaOf('providers.list').properties;
    expect(provider.items.items.required).toEqual(['id', 'name', 'models']);
    expect(provider.items.items.properties.models.items.required).toEqual(['id', 'name']);
    // 信封残余由 runtime 拥有：connected = 已连接 providerID，default = providerID→modelID。
    expect(provider.connected.type).toBe('array');
    expect(provider.default.type).toBe('object');
    expect(schemaOf('providers.list').required).toEqual(['items']);

    const mcp = schemaOf('mcp.servers').properties.servers.items;
    expect(mcp.properties.status.anyOf?.map((entry: any) => entry.const))
      .toEqual(['connected', 'disabled', 'failed', 'needs_auth', 'unknown']);
    expect(mcp.properties.type.anyOf?.map((entry: any) => entry.const)).toEqual(['local', 'remote']);
    expect(schemaOf('mcp.servers').required).toEqual(['servers']);
  });

  test('plugins.list mirrors PluginsListResult (legacy entries + unified package rows)', () => {
    const schema = schemaOf('plugins.list');
    expect(schema.required).toEqual(['plugins']);
    expect(schema.properties.revision.type).toBe('string');
    const entry = schema.properties.plugins.items;
    expect(entry.properties.type.anyOf?.map((e: any) => e.const)).toEqual(['runtime', 'media', 'usage', 'ui']);
    expect(entry.properties.status.anyOf?.map((e: any) => e.const))
      .toEqual(['enabled', 'disabled', 'error', 'config-disabled']);
    const pkg = schema.properties.packages.items;
    expect(pkg.required).toEqual(['name', 'source', 'status', 'enabled', 'contributions']);
    expect(pkg.properties.status.anyOf?.map((e: any) => e.const)).toEqual(['ok', 'error', 'disabled']);
    // revision 只在 envelope provider 存在时下发 → 不 required。
    expect(schema.required).not.toContain('revision');
    expect(schema.required).not.toContain('packages');
  });

  test('skills.list / tools.list model the kernel rows and the tool spec surface', () => {
    const skill = schemaOf('skills.list').properties.skills.items;
    expect(skill.properties.status.anyOf?.map((e: any) => e.const))
      .toEqual(['staging', 'active', 'paused', 'deprecated']);
    expect(skill.properties.stats.required).toEqual(['total', 'success', 'failure', 'unknown', 'lastAt']);
    expect(skill.properties.lastAt).toBeUndefined();
    expect(skill.properties.stats.properties.lastAt.anyOf?.map((e: any) => e.type))
      .toEqual(expect.arrayContaining(['number', 'null']));
    expect(schemaOf('skills.list').required).toEqual(['skills']);

    const tool = schemaOf('tools.list').properties.tools.items;
    expect(tool.required).toEqual(['name', 'description', 'parameters']);
    // parameters / outputSchema 是工具作者的 JSON Schema 对象（边界）。
    expect(tool.properties.parameters.type).toBe('object');
    expect(tool.properties.outputSchema.type).toBe('object');
    expect(tool.properties.annotations.properties.readOnlyHint.type).toBe('boolean');
  });

  test('config.get documents the GatewayConfig envelope without widening the whole response', () => {
    const schema = schemaOf('config.get');
    const sections = CONFIG_SECTION_KEYS_FOR_TEST();
    expect(Object.keys(schema.properties).sort()).toEqual([...sections].sort());
    expect([...schema.required].sort()).toEqual([...sections].sort());
    // 每个 section 是韧性边界对象（defaults + config.yaml 深合并 → 键集运营可扩展），
    // 但顶层键集必须封闭：不得退化成 Record<string, unknown>。
    expect(schema.additionalProperties).toBeUndefined();
    expect(schema.patternProperties).toBeUndefined();
    for (const section of sections) {
      expect({ section, type: schema.properties[section].type }).toEqual({ section, type: 'object' });
      // TypeBox 的 Record(String, Unknown) 投影成 patternProperties['^(.*)$'] = {}（任意 JSON 值）。
      expect(schema.properties[section].patternProperties?.['^(.*)$']).toEqual({});
    }
  });

  test('scheduler.status pins SchedulerStatus.plan (human slot + capacity)', () => {
    const schema = schemaOf('scheduler.status');
    expect([...schema.required].sort()).toEqual(['active', 'capacity', 'plan', 'queued']);
    expect(schema.properties.plan.required).toEqual(['start', 'waiting', 'humanSlot', 'capacity']);
    expect(schema.properties.plan.properties.humanSlot.type).toBe('boolean');
    expect(schema.properties.plan.properties.capacity.type).toBe('number');
  });

  test('handler wire samples validate against each schema (Value.Check)', () => {
    // agents.list: projectAgents() 的规范投影（mfaw 身份 + runtime 原生 agent）。
    expect(Value.Check(AgentListResponse, {
      items: [
        { id: 'build', label: 'build', source: 'mafw', selectable: true, default: true },
        {
          id: 'review', label: 'review', description: 'reviewer', source: 'runtime',
          selectable: false, mode: 'subagent', model: { providerID: 'p', modelID: 'm' },
        },
      ],
    })).toBe(true);
    expect(Value.Check(AgentListResponse, {
      items: [{ id: 'x', label: 'x', source: 'registry', selectable: true }],
    })).toBe(false);
    expect(Value.Check(AgentListResponse, { items: [{ id: 'x', label: 'x', source: 'runtime' }] })).toBe(false);

    // providers.list: envelope = items + runtime 残余（default / connected）。
    expect(Value.Check(ProviderListResponse, {
      items: [{
        id: 'anthropic', name: 'Anthropic', connected: true,
        models: [{ id: 'claude', name: 'Claude', providerID: 'anthropic', contextLimit: 200000 }],
      }],
      connected: ['anthropic'],
      default: { anthropic: 'claude' },
    })).toBe(true);
    expect(Value.Check(ProviderListResponse, { items: [] })).toBe(true);
    // models 恒为数组（原生对象映射也被投影成数组）。
    expect(Value.Check(ProviderListResponse, { items: [{ id: 'p', name: 'P', models: {} }] })).toBe(false);

    // mcp.servers: runtime mcp channel list() 原样条目。
    expect(Value.Check(McpServersResponse, {
      servers: [
        { name: 'fs', status: 'connected', type: 'local', command: ['npx', 'mcp'], source: 'project' },
        { name: 'remote', status: 'needs_auth', type: 'remote', url: 'https://x', disabled: true },
      ],
    })).toBe(true);
    expect(Value.Check(McpServersResponse, { servers: [{ name: 'fs', status: 'ready' }] })).toBe(false);

    // plugins.list: legacy inventory + unified packages + revision。
    const legacyEntry = {
      type: 'usage', name: 'demo', file: 'demo.js', status: 'enabled', size: 12,
      mtime: '2026-11-14T00:00:00.000Z', builtin: true,
    };
    expect(Value.Check(PluginsListResponse, {
      plugins: [legacyEntry, { ...legacyEntry, status: 'config-disabled', overridden: true }],
      packages: [{
        name: 'pkg', source: '/x/pkg', status: 'ok', enabled: true, contributions: ['ui'],
        version: '1.0.0', revision: 'boot:1', fingerprint: 'sha',
      }],
      revision: 'boot:1',
    })).toBe(true);
    expect(Value.Check(PluginsListResponse, { plugins: [] })).toBe(true);
    expect(Value.Check(PluginsListResponse, { plugins: [{ ...legacyEntry, status: 'pending' }] })).toBe(false);
    // disabled 合成行的最小形状（source 空串 + 无 error/version）。
    expect(Value.Check(PluginsListResponse, {
      plugins: [],
      packages: [{ name: 'gone', source: '', status: 'disabled', enabled: false, contributions: [] }],
    })).toBe(true);

    // skills.list: DB 行 + 调用统计（无调用记录 lastAt 为 null）。
    const skillRow = {
      name: 'office-editing', version: 2, status: 'active',
      sourceMemoryIds: ['mem-1'], sourceTraceIds: [], installedAt: 1, updatedAt: 2,
      deoptReason: null,
      stats: { total: 3, success: 2, failure: 0, unknown: 1, lastAt: 2 },
    };
    expect(Value.Check(SkillsListResponse, { skills: [skillRow] })).toBe(true);
    expect(Value.Check(SkillsListResponse, {
      skills: [{ ...skillRow, stats: { total: 0, success: 0, failure: 0, unknown: 0, lastAt: null } }],
    })).toBe(true);
    expect(Value.Check(SkillsListResponse, { skills: [{ ...skillRow, status: 'retired' }] })).toBe(false);

    // tools.list: MAFW_TOOL_SPECS（parameters 是任意 JSON Schema 对象）。
    expect(Value.Check(ToolsListResponse, {
      tools: [{
        name: 'mafw_add_memory', label: 'MAFW 记忆写入',
        description: '保存一条记忆',
        parameters: { type: 'object', properties: { content: { type: 'string' } }, required: ['content'] },
        annotations: { readOnlyHint: false },
      }],
    })).toBe(true);
    expect(Value.Check(ToolsListResponse, { tools: [{ name: 'x', parameters: {} }] })).toBe(false);

    // config.get: 26 个 section 全在；缺一即失败（envelope 是封闭的）。
    const config = Object.fromEntries(CONFIG_SECTION_KEYS_FOR_TEST().map((k) => [k, { sample: 1 }]));
    expect(Value.Check(ConfigGetResponse, config)).toBe(true);
    expect(Value.Check(ConfigGetResponse, { ...config, server: undefined })).toBe(false);
    // section 内是运营可扩展的边界：任意 JSON 键都接受。
    expect(Value.Check(ConfigGetResponse, { ...config, memory: { unknownFutureKey: [1, 2, 3] } })).toBe(true);
    expect(Value.Check(ConfigGetResponse, { ...config, memory: 'not-an-object' })).toBe(false);

    // scheduler.status: plan 四键恒在；404 的 {error} 不是 200 body。
    expect(Value.Check(SchedulerStatusResponse, {
      active: ['goal_1'], queued: [], capacity: 3,
      plan: { start: ['goal_2'], waiting: ['goal_3'], humanSlot: true, capacity: 4 },
    })).toBe(true);
    expect(Value.Check(SchedulerStatusResponse, {
      active: [], queued: [], capacity: 2, plan: { start: [], waiting: ['goal_3'] },
    })).toBe(false);
    expect(Value.Check(SchedulerStatusResponse, { error: 'pod not found' })).toBe(false);
  });
});

describe('api-contract: E10f-A session / task / terminal / usage read response schema (16 ops)', () => {
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

  /** Load-bearing properties per op (a missing one breaks rendering / pagination / cursoring). */
  const EXPECTED: Record<string, { fields: string[]; item?: { at: string; required: string[] } }> = {
    'cognition.rules': {
      fields: ['rules', 'errors'],
      item: { at: 'rules', required: ['on', 'action'] },
    },
    'session.structured': { fields: ['sessionID', 'schema', 'errors', 'updatedAt'] },
    'tasks.list': {
      fields: ['items'],
      item: { at: 'items', required: ['id', 'kind', 'parentSessionID', 'title', 'status', 'createdAt', 'updatedAt'] },
    },
    'tasks.get': { fields: ['id', 'kind', 'status', 'title', 'createdAt', 'updatedAt'] },
    'tasks.output': { fields: ['output', 'cursor', 'size', 'truncated'] },
    'session.trajectory': {
      fields: ['turns', 'events'],
      item: {
        at: 'turns',
        required: [
          'projectID', 'sessionID', 'turnID', 'turnStartMs', 'turnEndMs', 'durationMs',
          'toolCount', 'toolErrorCount', 'reasoningCount', 'agentSwitchCount', 'tokens',
          'cost', 'finish', 'model', 'provider', 'agent', 'userText',
        ],
      },
    },
    'session.run': { fields: ['run'] },
    'session.discovery': {
      fields: [
        'sessionID', 'directory', 'revision', 'commandsRevision', 'generatedAt',
        'commands', 'skills', 'instructions', 'degraded', 'warnings', 'skillInvokeSupported',
      ],
    },
    'session.discoverySkill': {
      fields: ['id', 'name', 'slash', 'scope', 'contentLength', 'content'],
    },
    'experience.actions': { fields: ['experienceVersion', 'minClientVersion', 'actions'] },
    'background.jobs.list': {
      fields: ['items'],
      item: { at: 'items', required: ['id', 'source', 'kind', 'status', 'sessionID'] },
    },
    'background.jobs.output': { fields: ['cursor', 'data', 'truncated'] },
    'terminal.list': {
      fields: ['protocol', 'supported', 'sessions'],
      item: { at: 'sessions', required: ['id', 'status'] },
    },
    'session.usage': { fields: ['summary', 'providers', 'updatedAt'] },
    'session.usagePluginsList': { fields: ['plugins', 'templates', 'builtins'] },
    'session.usagePluginSourceGet': { fields: ['source', 'origin'] },
  };

  test('all sixteen ops expose a 200 JSON schema with properties (not a whole-response widening)', () => {
    expect(Object.keys(EXPECTED)).toHaveLength(16);
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
      console.error('[api-contract] E10f-A response schema missing - run emit:openapi + merge-contract:\n' + problems.join('\n'));
    }
    expect(problems).toEqual([]);
  });

  test('array item required fields match the handler wire (items/rules/turns/sessions)', () => {
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

  test('tasks.* pin the task state machine and keep the output snapshot bookkeeping optional', () => {
    const list = schemaOf('tasks.list').properties.items.items;
    expect(list.properties.kind.anyOf?.map((e: any) => e.const)).toEqual(['shell', 'subagent']);
    expect(list.properties.status.anyOf?.map((e: any) => e.const))
      .toEqual(['working', 'input_required', 'completed', 'failed', 'cancelled']);
    // publicTask() strips only `output`/`resumeAt`; the snapshot cursors are extra gateway bookkeeping.
    expect(list.properties.output).toBeUndefined();
    expect(list.properties.outputCursor).toBeDefined();
    expect(list.required).not.toContain('outputCursor');
    expect(list.required).not.toContain('outputSize');
    expect(list.required).not.toContain('outputTruncated');
    expect(schemaOf('tasks.get')).toEqual(schemaOf('tasks.list').properties.items.items);
  });

  test('tasks.output stays a runtime shell boundary (known keys optional, open index)', () => {
    const schema = schemaOf('tasks.output');
    // Live tasks pass `shell.output()` through untouched -> no required key, open index,
    // but the four keys the SDK guards on keep their types (see contract-compat checks).
    expect(schema.required ?? []).toEqual([]);
    expect(schema.additionalProperties).toBe(true);
    for (const field of ['output', 'cursor', 'size', 'truncated']) {
      expect(schema.properties[field]).toBeDefined();
    }
  });

  test('session.trajectory models gateway turn/event rows (SDK TrajectoryTurn is a legacy subset)', () => {
    const schema = schemaOf('session.trajectory');
    expect(schema.required).toEqual(['turns', 'events']);
    const turn = schema.properties.turns.items;
    // gateway-owned fields the SDK subset lacks: sessionID / provider / workerRole.
    expect(turn.required).toEqual(expect.arrayContaining(['sessionID', 'provider']));
    expect(turn.properties.workerRole).toBeDefined();
    expect(turn.properties.turnEndMs.anyOf?.map((e: any) => e.type)).toEqual(expect.arrayContaining(['number', 'null']));
    const event = schema.properties.events.items;
    expect(event.properties.eventType.anyOf?.map((e: any) => e.const)).toEqual(expect.arrayContaining([
      'tool_start', 'tool_end', 'reasoning_start', 'step_finish', 'turn_start', 'turn_end', 'text_end',
    ]));
    // Empty store / rebuild failure still returns the same two arrays.
    expect(Value.Check(SessionTrajectoryResponse, { turns: [], events: [] })).toBe(true);
  });

  test('session.run mirrors toRunDto (brief four keys, nullable run, optional resumed/finished)', () => {
    const schema = schemaOf('session.run');
    expect(schema.properties.run.anyOf?.map((e: any) => e.type)).toEqual(expect.arrayContaining(['object', 'null']));
    const run = schema.properties.run.anyOf[0];
    expect(run.required).toEqual(expect.arrayContaining([
      'id', 'sessionID', 'projectDir', 'status', 'brief', 'createdAt', 'suspendedAt',
    ]));
    expect(run.required).not.toContain('resumedAt');
    expect(run.required).not.toContain('finishedAt');
    expect(run.required).not.toContain('reason');
    expect(run.properties.brief.required).toEqual([
      'lastUserText', 'lastAssistantTail', 'anchorMessageID', 'queuedCount',
    ]);
    expect(run.properties.status.anyOf?.map((e: any) => e.const))
      .toEqual(['suspended', 'resumed', 'completed', 'failed', 'cancelled']);
    expect(Value.Check(SessionRunResponse, { run: null })).toBe(true);
  });

  test('session.discovery pins the snapshot envelope and optional degradedReason', () => {
    const schema = schemaOf('session.discovery');
    expect([...schema.required].sort()).toEqual([
      'commands', 'commandsRevision', 'degraded', 'directory', 'generatedAt',
      'instructions', 'revision', 'sessionID', 'skillInvokeSupported', 'skills', 'warnings',
    ]);
    expect(schema.properties.degradedReason.anyOf?.map((e: any) => e.const)).toEqual([
      'capability_absent', 'runtime_error', 'partial', 'instructions_error',
    ]);
    expect(schema.required).not.toContain('degradedReason');
    const skill = schema.properties.skills.items;
    expect(skill.properties.scope.anyOf?.map((e: any) => e.const)).toEqual(['user', 'project', 'path']);
    const shadow = schemaOf('session.discoverySkill');
    // contentLength is bytes of the full text; content only ships on the single-skill op.
    expect(shadow.required).toEqual(expect.arrayContaining(['id', 'name', 'slash', 'scope', 'contentLength', 'content']));
    expect(schema.properties.skills.items.properties.content).toBeUndefined();
  });

  test('experience.actions derives the closed action vocabulary from the contract constant', () => {
    const schema = schemaOf('experience.actions');
    expect(schema.required).toEqual(['experienceVersion', 'minClientVersion', 'actions']);
    // actions is a Partial map: every action id is optional, unknown ids are not in the schema.
    const ids = Object.keys(schema.properties.actions.properties ?? {});
    expect(ids).toHaveLength(20);
    expect(ids).toContain('checkpoint.restore');
    expect(ids).toContain('mcp.config.write');
    expect(schema.properties.actions.required ?? []).toEqual([]);
    expect(schema.properties.actions.additionalProperties).toBeFalsy();
    const descriptor = schema.properties.actions.properties['run.control'];
    expect(descriptor.required).toEqual(['supported', 'enabled']);
    expect(descriptor.properties.reason.anyOf?.map((e: any) => e.const)).toEqual([
      'unsupported', 'busy', 'missing-data', 'non-invertible-patch', 'unsafe',
    ]);
    expect(descriptor.properties.operationId).toBeDefined();
  });

  test('cognition.rules keeps config-authored data open but pins on/action', () => {
    const rule = schemaOf('cognition.rules').properties.rules.items;
    expect(rule.required).toEqual(['on', 'action']);
    expect(rule.additionalProperties).toBe(true);
    expect(rule.properties.on.anyOf?.map((e: any) => e.const)).toEqual(['tool_call', 'prompt', 'tool_result']);
    expect(rule.properties.action.anyOf?.map((e: any) => e.const))
      .toEqual(['deny', 'ask', 'rewrite', 'transform', 'redact']);
    expect(schemaOf('cognition.rules').required).toEqual(['rules', 'errors']);
  });

  test('background / terminal read surfaces speak only MAFW DTOs', () => {
    const job = schemaOf('background.jobs.list').properties.items.items;
    expect(job.properties.source.anyOf?.map((e: any) => e.const))
      .toEqual(['runtime-shell', 'mafw-task', 'subagent']);
    expect(job.properties.status.anyOf?.map((e: any) => e.const))
      .toEqual(['running', 'input_required', 'completed', 'failed', 'cancelled']);
    // cursor is the next read offset in bytes -> number, and the three output keys are required.
    expect(schemaOf('background.jobs.output').required).toEqual(['cursor', 'data', 'truncated']);

    const terminal = schemaOf('terminal.list');
    expect(terminal.required).toEqual(['protocol', 'supported', 'sessions']);
    expect(terminal.properties.sessions.items.properties.status.anyOf?.map((e: any) => e.const))
      .toEqual(['running', 'exited', 'unknown']);
    // Unsupported runtime is still 200: supported:false + empty list, never a fabricated PTY.
    expect(Value.Check(TerminalListResponse, { protocol: 'mafw-terminal/1', supported: false, sessions: [] })).toBe(true);
  });

  test('session.usage documents both branches (success + fail-open 200)', () => {
    const schema = schemaOf('session.usage');
    expect(schema.required).toEqual(['summary', 'providers', 'updatedAt']);
    // summary is null on the fail-open branch, an object on success.
    expect(schema.properties.summary.anyOf?.map((e: any) => e.type)).toEqual(expect.arrayContaining(['object', 'null']));
    // memory / modelStats are omitted by the fail-open catch branch.
    expect(schema.required).not.toContain('memory');
    expect(schema.required).not.toContain('modelStats');
    const summary = schema.properties.summary.anyOf[0];
    expect(summary.properties.session.required).toEqual(expect.arrayContaining([
      'totalTokens', 'totalCost', 'turnCount', 'avgTokensPerTurn',
    ]));
    expect(summary.properties.project.required).toEqual(
      expect.arrayContaining(['totalTokens', 'totalCost', 'turnCount', 'sessionCount']),
    );
    expect(schema.properties.modelStats.properties.windows.required).toEqual(['today', '7d', '30d', 'all']);
    expect(schema.properties.providers.items.required).toEqual(['name', 'windows']);
    // window/unit vocabulary belongs to the usage plugins (user JS) -> open strings.
    expect(schema.properties.providers.items.properties.windows.items.properties.window.type).toBe('string');
  });

  test('usage plugin surface pins the inventory rows and template fields', () => {
    const plugin = schemaOf('session.usagePluginsList').properties.plugins.items;
    expect(plugin.required).toEqual(['file', 'status', 'disabled', 'origin', 'config']);
    expect(plugin.properties.origin.anyOf?.map((e: any) => e.const)).toEqual(['builtin', 'override', 'user']);
    expect(plugin.properties.status.anyOf?.map((e: any) => e.const)).toEqual(['ok', 'error']);
    expect(plugin.properties.configSchema.items.properties.type.anyOf?.map((e: any) => e.const))
      .toEqual(['number', 'string', 'boolean', 'select']);
    const tpl = schemaOf('session.usagePluginsList').properties.templates.items;
    expect(tpl.required).toEqual(['id', 'label', 'description', 'fields']);
    expect(tpl.properties.fields.items.properties.type.anyOf?.map((e: any) => e.const))
      .toEqual(['string', 'number', 'boolean', 'select', 'textarea']);
    // 200 body only: 403 (builtin read-only) / 404 envelopes are error bodies.
    expect(schemaOf('session.usagePluginSourceGet').required).toEqual(['source', 'origin']);
    expect(schemaOf('session.usagePluginSourceGet').properties.origin.anyOf?.map((e: any) => e.const))
      .toEqual(['override', 'user']);
  });

  test('handler wire samples validate against each new schema (Value.Check)', () => {
    // tasks.list: durable task row (shell, terminal snapshot bookkeeping included).
    const task = {
      id: 'task_1', kind: 'shell', parentSessionID: 's1', shellID: 'sh_1', title: 'npm test',
      status: 'completed', directory: '/p', createdAt: 1, updatedAt: 2, finishedAt: 3, exitCode: 0,
      metadata: { command: 'npm test' }, outputCursor: 12, outputSize: 12, outputTruncated: false,
    };
    expect(Value.Check(TaskListResponse, { items: [task] })).toBe(true);
    expect(Value.Check(TaskListResponse, { items: [] })).toBe(true);
    expect(Value.Check(TaskListResponse, { items: [{ ...task, status: 'paused' }] })).toBe(false);
    expect(Value.Check(TaskGetResponse, task)).toBe(true);
    expect(Value.Check(TaskGetResponse, { id: 'task_1', kind: 'subagent', parentSessionID: 's1', title: 'x', status: 'working', createdAt: 1, updatedAt: 1 })).toBe(true);

    // tasks.output: terminal snapshot + runtime passthrough (unknown runtime-only keys allowed).
    expect(Value.Check(TaskOutputResponse, { output: 'ok', cursor: 2, size: 2, truncated: false })).toBe(true);
    expect(Value.Check(TaskOutputResponse, { output: '', cursor: 0, size: 0, truncated: true })).toBe(true);
    expect(Value.Check(TaskOutputResponse, { output: 'x', runtimeCursorExt: 7 })).toBe(true);

    // session.structured: unsubmitted (no name / submitted) and submitted forms.
    expect(Value.Check(SessionStructuredResponse, {
      sessionID: 's1', schema: { type: 'object', properties: { ok: { type: 'boolean' } } },
      errors: [], updatedAt: 1,
    })).toBe(true);
    expect(Value.Check(SessionStructuredResponse, {
      sessionID: 's1', name: 'report', schema: { type: 'object' }, submitted: { ok: true }, errors: ['a: bad'], updatedAt: 2,
    })).toBe(true);
    expect(Value.Check(SessionStructuredResponse, { sessionID: 's1', errors: [], updatedAt: 1 })).toBe(false);

    // session.run: toRunDto row (suspended + resumed).
    const tokens = { input: 1, output: 2, reasoning: 3, cache: { read: 4, write: 5 } };
    const run = {
      id: 'run_1', sessionID: 's1', projectDir: '/p', status: 'suspended',
      brief: { lastUserText: 'go', lastAssistantTail: 'doing', anchorMessageID: 'm1', queuedCount: 0 },
      createdAt: '2026-11-14T00:00:00.000Z', suspendedAt: '2026-11-14T00:00:01.000Z',
    };
    expect(Value.Check(SessionRunResponse, { run })).toBe(true);
    expect(Value.Check(SessionRunResponse, { run: { ...run, status: 'resumed', resumedAt: '2026-11-14T00:00:02.000Z', reason: 'user' } })).toBe(true);
    expect(Value.Check(SessionRunResponse, { run: { ...run, status: 'paused' } })).toBe(false);

    // session.discovery: degraded snapshot (optional reason) + warnings.
    const snapshot = {
      sessionID: 's1', directory: '/p', revision: 'r1', commandsRevision: 'c1',
      generatedAt: '2026-11-14T00:00:00.000Z',
      commands: [{ name: 'goal', description: 'd', source: 'mafw', scope: 'gateway', destructive: false }],
      skills: [{ id: 'sk_1', name: 'office-editing', slash: true, scope: 'user', contentLength: 42 }],
      instructions: [{ id: 'in_1', path: '/p/AGENTS.md', scope: 'project', kind: 'agents-md', bytes: 10, mtime: 't' }],
      degraded: true, degradedReason: 'partial',
      warnings: [{ source: 'skills', message: 'failed' }], skillInvokeSupported: false,
    };
    expect(Value.Check(SessionDiscoveryResponse, snapshot)).toBe(true);
    expect(Value.Check(SessionDiscoveryResponse, { ...snapshot, degraded: false, degradedReason: undefined })).toBe(true);
    expect(Value.Check(SessionDiscoveryResponse, { ...snapshot, degradedReason: 'slow' })).toBe(false);
    expect(Value.Check(SessionDiscoverySkillResponse, { ...snapshot.skills[0], content: '# skill' })).toBe(true);

    // experience.actions: full projection (all 20 ids) + sessionID echo.
    const descriptor = { supported: true, enabled: true, operationId: 'session.diff' };
    const actions = Object.fromEntries(
      ['checkpoint.restore', 'checkpoint.create', 'branch.fork', 'branch.revert', 'branch.unrevert',
       'branch.diff', 'run.control', 'session.worktree', 'session.summarize', 'session.switch-agent',
       'session.switch-model', 'session.discovery', 'approval.permission', 'approval.question',
       'background.jobs', 'terminal.attach', 'prompt.steer', 'session.background', 'mcp.manage',
       'mcp.config.write'].map((id) => [id, descriptor]),
    );
    expect(Value.Check(ExperienceActionsResponse, {
      experienceVersion: '2026.11.1', minClientVersion: '2026.11.0', sessionID: 's1', actions,
    })).toBe(true);
    expect(Value.Check(ExperienceActionsResponse, {
      experienceVersion: '2026.11.1', minClientVersion: '2026.11.0',
      actions: { 'run.control': { supported: true, enabled: false, reason: 'busy', warningKey: 'w', semantics: { any: 1 } } },
    })).toBe(true);
    expect(Value.Check(ExperienceActionsResponse, {
      experienceVersion: '2026.11.1', minClientVersion: '2026.11.0',
      actions: { 'run.control': { supported: true, enabled: false, reason: 'tired' } },
    })).toBe(false);

    // cognition.rules: raw config entry passthrough (extra keys survive) + validation errors.
    expect(Value.Check(CognitionRulesResponse, {
      rules: [
        { on: 'tool_call', tool: 'bash', match: 'rm -rf', action: 'deny', reason: 'no', name: 'no-rm' },
        { on: 'prompt', action: 'transform', text: '{{text}}', customFutureKey: true },
      ],
      errors: ['rule[2]: invalid action \'explode\''],
    })).toBe(true);
    expect(Value.Check(CognitionRulesResponse, { rules: [{ on: 'model', action: 'deny' }], errors: [] })).toBe(false);

    // background.jobs: merged three-source rows + cursor output.
    expect(Value.Check(BackgroundJobsListResponse, {
      items: [
        { id: 'task_1', source: 'mafw-task', kind: 'shell', status: 'running', sessionID: 's1', taskID: 'task_1', title: 'npm test', command: 'npm test', time: { created: 1, updated: 2 }, runtimeShellID: 'sh_1' },
        { id: 'sub_1', source: 'subagent', kind: 'subagent', status: 'completed', sessionID: 's1', childSessionID: 'sub_1', extensions: { error: 'x' } },
      ],
    })).toBe(true);
    expect(Value.Check(BackgroundJobsListResponse, { items: [{ id: 'x', source: 'cron', kind: 'shell', status: 'running', sessionID: 's1' }] })).toBe(false);
    expect(Value.Check(BackgroundJobOutputResponse, { cursor: 128, data: 'ok', truncated: false })).toBe(true);
    expect(Value.Check(BackgroundJobOutputResponse, { data: 'ok' })).toBe(false);

    // terminal.list: supported + unsupported forms.
    expect(Value.Check(TerminalListResponse, {
      protocol: 'mafw-terminal/1', supported: true,
      sessions: [{ id: 'pty_1', directory: '/p', title: 'zsh', status: 'running', cwd: '/p' }],
    })).toBe(true);
    expect(Value.Check(TerminalListResponse, {
      protocol: 'mafw-terminal/1', supported: true, sessions: [{ id: 'pty_2', status: 'unknown' }],
    })).toBe(true);

    // session.usage: success branch (store present) and fail-open branch (query failed).
    const scope = { totalTokens: tokens, totalCost: 0.1, turnCount: 2, sessionCount: 1 };
    const usage = {
      summary: {
        session: { totalTokens: tokens, totalCost: 0.1, turnCount: 2, avgTokensPerTurn: tokens },
        project: scope,
        global: scope,
      },
      memory: { ...scope, byRole: { builder: scope } },
      modelStats: {
        windows: {
          today: [{ provider: 'anthropic', model: 'claude', turns: 1, tokens, estimatedCost: null }],
          '7d': [], '30d': [], all: [],
        },
      },
      providers: [{
        name: 'anthropic', plan: 'pro', type: 'api', severity: 'low',
        windows: [{ window: '5h', used: 1, limit: 10, unit: '$', pct: 10, resetAt: 1, pacing: 'on-track', remaining: 9, detailLines: ['claude: 1'] }],
      }],
      updatedAt: 1,
    };
    expect(Value.Check(SessionUsageResponse, usage)).toBe(true);
    expect(Value.Check(SessionUsageResponse, { summary: null, providers: [], updatedAt: 2 })).toBe(true);
    // memory is nullable when the trajectory store is absent.
    expect(Value.Check(SessionUsageResponse, { ...usage, memory: null })).toBe(true);
    expect(Value.Check(SessionUsageResponse, { ...usage, summary: { session: null } })).toBe(false);

    // usage plugin inventory: builtin override row (config non-null) + user row.
    const tplField = { key: 'endpoint', label: 'Endpoint', type: 'string', required: true, placeholder: 'https://x' };
    const usagePlugins = {
      plugins: [
        {
          file: 'opencode-go.js', name: 'opencode-go', status: 'ok', disabled: false, origin: 'builtin',
          pluginType: 'token-plan',
          configSchema: [{ key: 'endpoint', label: 'Endpoint', type: 'string', default: 'https://x' }],
          config: { endpoint: 'https://x' },
        },
        { file: 'broken.js', name: 'broken', status: 'error', error: 'boom', disabled: true, origin: 'user', config: null },
      ],
      templates: [{ id: 'token-plan', label: '套餐窗口型', description: 'd', fields: [tplField] }],
      builtins: ['opencode-go', 'zen'],
    };
    expect(Value.Check(UsagePluginsListResponse, usagePlugins)).toBe(true);
    expect(Value.Check(UsagePluginsListResponse, {
      ...usagePlugins, templates: [{ id: 'x', label: 'x', description: 'x', fields: [{ key: 'k', label: 'l', type: 'slider' }] }],
    })).toBe(false);

    // session.usagePluginSourceGet: success body only (403/404 carry {error, builtin?}).
    expect(Value.Check(UsagePluginSourceResponse, { source: 'module.exports = {}', origin: 'user' })).toBe(true);
    expect(Value.Check(UsagePluginSourceResponse, { source: 'x', origin: 'builtin' })).toBe(false);
    expect(Value.Check(UsagePluginSourceResponse, { error: 'plugin file not found' })).toBe(false);
  });
});

describe('api-contract: E10f-B project / runtime / metadata read response schema (16 ops)', () => {
  const findOp = (operationId: string): any => {
    for (const pathItem of Object.values(contract.paths || {}) as any[]) {
      for (const op of Object.values(pathItem) as any[]) {
        if (op?.operationId === operationId) return op;
      }
    }
    return undefined;
  };
  const schemaOf = (operationId: string): any =>
    findOp(operationId).responses['200'].content['application/json'].schema;

  const EXPECTED: Record<string, {
    fields: string[];
    union?: true;
    item?: { at: string; required: string[] };
  }> = {
    'mafwCommands.list': {
      fields: ['commands'],
      item: { at: 'commands', required: ['name', 'description', 'category', 'kind'] },
    },
    // Dual shape: single object with ?projectDir=, array without.
    'manager.session': { fields: [], union: true },
    'project.current': { fields: ['project'] },
    'fileHistory.list': {
      fields: ['entries'],
      item: {
        at: 'entries',
        required: ['id', 'sessionID', 'projectDir', 'rel', 'blob', 'size', 'mtimeMs', 'createdAt', 'seq', 'reason'],
      },
    },
    'runtime.get': {
      fields: ['active', 'plugins', 'unknownEvents', 'validation', 'translationErrors', 'translationDrops'],
      item: { at: 'plugins', required: ['file', 'status'] },
    },
    'runtime.contract': { fields: ['manifest', 'coverage'] },
    'runtime.config.get': { fields: ['config'] },
    'plugins.client': {
      fields: ['revision', 'plugins'],
      item: { at: 'plugins', required: ['name', 'version', 'revision', 'ui', 'actions', 'events'] },
    },
    'models.get': { fields: ['recall', 'media', 'goal', 'available'] },
    'media.plugins': { fields: ['plugins'], item: { at: 'plugins', required: ['file', 'status'] } },
    'tts.voices': {
      fields: ['voices', 'engine', 'capabilities', 'engines', 'models', 'defaultVoice', 'defaultModel'],
    },
    'voice.status': {
      fields: ['ok', 'config', 'engines', 'routing'],
      item: { at: 'engines', required: ['name', 'capabilities', 'source'] },
    },
    'python.status': { fields: ['running'] },
    'agent.capabilities': {
      fields: ['ledger', 'failureTaxonomy'],
      item: { at: 'failureTaxonomy', required: ['pattern', 'count', 'energy', 'id'] },
    },
    'media.resolveTask': { fields: ['artifactId'] },
    'embedding.get': { fields: ['current', 'runtime', 'available'] },
  };

  test('all sixteen ops expose a 200 JSON schema with properties (not a whole-response widening)', () => {
    expect(Object.keys(EXPECTED)).toHaveLength(16);
    const problems: string[] = [];
    for (const [operationId, spec] of Object.entries(EXPECTED)) {
      const op = findOp(operationId);
      if (!op) { problems.push(`${operationId}: missing from openapi.json`); continue; }
      const schema = op.responses?.['200']?.content?.['application/json']?.schema;
      if (!schema) { problems.push(`${operationId}: responses.200 missing application/json schema`); continue; }
      if (spec.union) {
        if ((schema.anyOf ?? []).length !== 2) problems.push(`${operationId}: expected a two-branch union`);
        continue;
      }
      const properties = Object.keys(schema.properties ?? {});
      if (properties.length === 0) { problems.push(`${operationId}: schema has no properties (widened)`); continue; }
      for (const field of spec.fields) {
        if (!properties.includes(field)) problems.push(`${operationId}: schema missing property '${field}'`);
      }
    }
    if (problems.length) {
      console.error('[api-contract] E10f-B response schema missing - run emit:openapi + gen:api:\n' + problems.join('\n'));
    }
    expect(problems).toEqual([]);
  });

  test('array item required fields match the handler wire (commands/entries/plugins/sources)', () => {
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

  test('manager.session is dual-shaped and project.current may be absent', () => {
    const manager = schemaOf('manager.session');
    expect(manager.anyOf.map((branch: any) => branch.type)).toEqual(['object', 'array']);
    const row = manager.anyOf[0];
    expect(row.required).toEqual(['projectDir', 'sessionId', 'createdAt']);
    // Handler always emits createdAt with an explicit null fallback.
    expect(row.properties.createdAt.anyOf.map((e: any) => e.type)).toEqual(['string', 'null']);
    expect(manager.anyOf[1].items).toEqual(row);

    const current = schemaOf('project.current');
    expect(current.required).toEqual(['project']);
    const branches = current.properties.project.anyOf;
    expect(branches.map((e: any) => e.type)).toEqual(['object', 'null']);
    expect(branches[0].required).toEqual(['id', 'worktree', 'mafwDir']);
  });

  test('runtime.get / runtime.contract keep runtime-owned payloads as boundary objects', () => {
    const runtime = schemaOf('runtime.get');
    expect(runtime.required).toEqual([
      'active', 'plugins', 'unknownEvents', 'validation', 'translationErrors', 'translationDrops',
    ]);
    expect(runtime.properties.active.required).toEqual([
      'name', 'capabilities', 'envOverride', 'dialect', 'coverage',
    ]);
    // Capability flags are runtime-declared booleans, never an enumerated key set.
    expect(runtime.properties.active.properties.capabilities.type).toBe('object');
    expect(runtime.properties.active.properties.capabilities.patternProperties['^(.*)$'].type).toBe('boolean');
    expect(runtime.properties.active.properties.capabilities.properties).toBeUndefined();
    expect(runtime.properties.active.properties.dialect.anyOf.map((e: any) => e.type))
      .toEqual(['string', 'null']);
    // Diagnostic telemetry has gateway-owned shapes.
    expect(runtime.properties.unknownEvents.patternProperties['^(.*)$']
      .patternProperties['^(.*)$'].type).toBe('number');
    expect(runtime.properties.translationErrors.patternProperties['^(.*)$'].required)
      .toEqual(['transformEvent', 'normalizeMessages']);
    expect(runtime.properties.translationDrops.patternProperties['^(.*)$'].required)
      .toEqual(['unmatched', 'suppressed']);
    expect(runtime.properties.plugins.items.properties.status.anyOf.map((e: any) => e.const))
      .toEqual(['ok', 'error']);

    const contractSchema = schemaOf('runtime.contract');
    expect(contractSchema.required).toEqual(['manifest', 'coverage']);
    const manifest = contractSchema.properties.manifest;
    expect(manifest.required).toEqual([
      'schemaVersion', 'contractVersion', 'generatedFrom',
      'domains', 'surfaces', 'capabilities', 'events', 'cognition', 'presets',
    ]);
    expect(manifest.properties.domains.items.required).toEqual(['id', 'title', 'description']);
    // surfaces/capabilities/events/cognition/presets stay open (contract package owns the entries).
    for (const key of ['surfaces', 'capabilities', 'events', 'cognition', 'presets']) {
      expect(manifest.properties[key].items.type).toBe('object');
      expect(manifest.properties[key].items.properties).toBeUndefined();
    }
    const coverageBranches = contractSchema.properties.coverage.anyOf;
    expect(coverageBranches.map((e: any) => e.type)).toEqual(['object', 'null']);
    expect(coverageBranches[0].required).toEqual(['runtime', 'contractVersion', 'static']);
    expect(coverageBranches[0].properties.behavioral).toBeDefined();
  });

  test('plugins.client / runtime.config.get only promise the envelope (owner payloads stay open)', () => {
    const client = schemaOf('plugins.client');
    expect(client.required).toEqual(['revision', 'plugins']);
    const descriptor = client.properties.plugins.items;
    expect(descriptor.required).toEqual(['name', 'version', 'revision', 'ui', 'actions', 'events']);
    // Descriptor internals belong to @mafw/plugin-contract: nested contributions stay open.
    expect(descriptor.additionalProperties).toBe(true);
    for (const key of ['ui']) {
      expect(descriptor.properties[key].patternProperties['^(.*)$']).toBeDefined();
    }
    expect(descriptor.properties.actions.items.patternProperties['^(.*)$']).toBeDefined();
    expect(descriptor.properties.events.items.patternProperties['^(.*)$']).toBeDefined();

    const runtimeConfig = schemaOf('runtime.config.get');
    expect(runtimeConfig.required).toEqual(['config']);
    // runtime Config model is runtime-owned -> object with an open index, no copied keys.
    expect(runtimeConfig.properties.config.type).toBe('object');
    expect(runtimeConfig.properties.config.properties).toBeUndefined();
  });

  test('model/media/tts/voice/embedding surfaces pin their enumerations', () => {
    const models = schemaOf('models.get');
    expect(models.required).toEqual(['recall', 'media', 'goal', 'available']);
    expect(models.properties.recall.required).toEqual(['workerModel']);
    expect(models.properties.recall.properties.workerModel.required).toEqual(['providerID', 'modelID']);
    // available is nullable (provider scan unavailable), never a fabricated empty error.
    expect(models.properties.available.anyOf.map((e: any) => e.type)).toEqual(['array', 'null']);
    expect(models.properties.available.anyOf[0].items.required).toEqual(['providerID', 'providerName', 'models']);
    expect(Object.keys(models.properties.media.properties).sort())
      .toEqual(['audio', 'image', 'model', 'provider', 'video']);
    expect(models.properties.media.required ?? []).toEqual([]);
    expect(Object.keys(models.properties.goal.properties).sort()).toEqual(['nodeModel', 'techLeadModel']);

    const media = schemaOf('media.plugins').properties.plugins.items;
    expect(media.properties.status.anyOf.map((e: any) => e.const)).toEqual(['ok', 'error']);

    const tts = schemaOf('tts.voices');
    expect(tts.required).toEqual([
      'voices', 'engine', 'capabilities', 'engines', 'models', 'defaultVoice', 'defaultModel',
    ]);
    expect(tts.properties.voices.items.required).toEqual(['id', 'label', 'lang']);
    expect(tts.properties.capabilities.properties.streaming.anyOf.map((e: any) => e.const))
      .toEqual(['native', 'none']);
    expect(tts.properties.capabilities.required)
      .toEqual(['streaming', 'voiceCloning', 'styleControl', 'languages', 'sampleRate']);
    expect(tts.properties.engines.items.properties.source.anyOf.map((e: any) => e.const))
      .toEqual(['builtin', 'legacy', 'package']);

    const voice = schemaOf('voice.status');
    expect(voice.properties.config.properties.tier.anyOf.map((e: any) => e.const))
      .toEqual(['auto', 'local', 'cloud']);
    expect(voice.properties.config.properties.localTier.anyOf.map((e: any) => e.const))
      .toEqual(['dgpu', 'igpu']);
    expect(voice.properties.config.required).toEqual([
      'tier', 'localTier', 'asrEngine', 'ttsEngine', 'cloudConsent', 'modelsDir', 'sidecarPort', 'duplexV1',
    ]);
    expect(voice.properties.routing.properties.status.anyOf.map((e: any) => e.const))
      .toEqual(['local_accelerated', 'local_cpu', 'cloud', 'degraded']);

    const embedding = schemaOf('embedding.get');
    expect(embedding.properties.current.required).toEqual([
      'provider', 'engine', 'model', 'dimensions', 'baseUrl', 'threads', 'llamacpp',
    ]);
    expect(embedding.properties.current.properties.provider.anyOf.map((e: any) => e.const))
      .toEqual(['off', 'local', 'dashscope']);
    expect(embedding.properties.current.properties.engine.anyOf.map((e: any) => e.const))
      .toEqual(['onnx', 'llamacpp']);
    expect(embedding.properties.current.properties.llamacpp.required)
      .toEqual(['gpu', 'threads', 'contextSize', 'batchSize']);
    // Live runtime identity is nullable when the provider is off.
    expect(embedding.properties.runtime.properties.active.anyOf.map((e: any) => e.type))
      .toEqual(['string', 'null']);
    expect(embedding.properties.available.required).toEqual(['providers', 'engines', 'gpus']);
  });

  test('orphan read surfaces document both branches (fail-open agent ledger, null artifact)', () => {
    expect(Value.Check(PythonStatusResponse, { running: true })).toBe(true);
    expect(Value.Check(PythonStatusResponse, { running: false })).toBe(true);
    expect(Value.Check(PythonStatusResponse, { running: 'yes' })).toBe(false);

    // media.resolveTask: explicit null on a miss (not a 404).
    expect(Value.Check(MediaResolveTaskResponse, { artifactId: 'art_1' })).toBe(true);
    expect(Value.Check(MediaResolveTaskResponse, { artifactId: null })).toBe(true);
    expect(Value.Check(MediaResolveTaskResponse, {})).toBe(false);

    // agent.capabilities: the catch branch is 200 {total, passRate} only.
    expect(Value.Check(AgentCapabilitiesResponse, {
      ledger: { total: 0, passRate: 0 },
      failureTaxonomy: [],
    })).toBe(true);
    expect(Value.Check(AgentCapabilitiesResponse, {
      ledger: {
        total: 4, passRate: 0.5, avgRounds: 2.5, avgCostUsd: 0.3, thumbsUp: 2, thumbsDown: 1,
        byFailureKind: { tests: 2 }, byTaskType: { feature: { total: 2, passRate: 0.5, avgRounds: 1, avgCostUsd: 0.1 } },
      },
      failureTaxonomy: [{ pattern: 'flaky tests', count: 2, energy: 1.5, id: 'mem_1' }],
    })).toBe(true);
    expect(Value.Check(AgentCapabilitiesResponse, {
      ledger: { total: 1, passRate: 1 },
      failureTaxonomy: [{ pattern: 'x', count: 1, energy: 1 }],
    })).toBe(false);
  });

  test('handler wire samples validate against each new schema (Value.Check)', () => {
    expect(Value.Check(MafwCommandsListResponse, {
      commands: [{
        name: 'goal', description: 'submit', argumentHint: '<target>',
        category: 'goals', kind: 'builtin', destructive: false,
      }],
    })).toBe(true);
    expect(Value.Check(MafwCommandsListResponse, {
      commands: [{ name: 'x', description: 'x', category: 'shell', kind: 'builtin' }],
    })).toBe(false);

    // manager.session both branches (single object / array), createdAt nullable.
    expect(Value.Check(ManagerSessionResponse, {
      projectDir: '/p', sessionId: 'ses_1', createdAt: null,
    })).toBe(true);
    expect(Value.Check(ManagerSessionResponse, [
      { projectDir: '/p', sessionId: 'ses_1', createdAt: '2026-11-14T00:00:00.000Z' },
    ])).toBe(true);
    expect(Value.Check(ManagerSessionResponse, [])).toBe(true);
    expect(Value.Check(ManagerSessionResponse, { projectDir: '/p', sessionID: 'ses_1', createdAt: null })).toBe(false);

    expect(Value.Check(ProjectCurrentResponse, { project: null })).toBe(true);
    expect(Value.Check(ProjectCurrentResponse, {
      project: { id: '/p', worktree: '/p', mafwDir: '/p/.mafw' },
    })).toBe(true);
    expect(Value.Check(ProjectCurrentResponse, { project: { id: '/p', worktree: '/p' } })).toBe(false);

    const entry = {
      id: 'fh_1', sessionID: 'ses_1', projectDir: '/p', rel: 'src/a.ts', blob: 'sha256',
      size: 10, mtimeMs: 1, createdAt: '2026-11-14T00:00:00.000Z', seq: 1, reason: 'pre-write',
    };
    expect(Value.Check(FileHistoryListResponse, { entries: [entry] })).toBe(true);
    expect(Value.Check(FileHistoryListResponse, { entries: [] })).toBe(true);
    expect(Value.Check(FileHistoryListResponse, { entries: [{ ...entry, rel: undefined }] })).toBe(false);

    // runtime.get: builtin/package loader rows + diagnostics telemetry.
    expect(Value.Check(RuntimeGetResponse, {
      active: {
        name: 'opencode@v2', capabilities: { sessionApi: true, eventStream: false },
        envOverride: false, dialect: 'v2', coverage: null,
      },
      plugins: [{
        file: 'builtin:opencode', name: 'opencode', status: 'ok',
        capabilities: { sessionApi: true }, alias: 'oc',
      }, { file: 'broken.js', status: 'error', error: 'boom' }],
      unknownEvents: { 'api': { 'x.y': 2 } },
      validation: ['eventStream declared but missing'],
      translationErrors: { opencode: { transformEvent: 1, normalizeMessages: 0, lastError: 'bad' } },
      translationDrops: { opencode: { unmatched: { 'turn.x': 1 }, suppressed: {} } },
    })).toBe(true);
    expect(Value.Check(RuntimeGetResponse, {
      active: { name: 'x', capabilities: {}, envOverride: false, dialect: null, coverage: null },
      plugins: [{ file: 'a.js', status: 'pending' }],
      unknownEvents: {}, validation: [], translationErrors: {}, translationDrops: {},
    })).toBe(false);

    expect(Value.Check(RuntimeContractResponse, {
      manifest: {
        schemaVersion: 1, contractVersion: '1.2.3', generatedFrom: 'gateway/src/runtime/contract-manifest.ts',
        domains: [{ id: 'meta', title: 'Meta', description: 'd' }],
        surfaces: [{ id: 'plugin.tools' }], capabilities: [], events: [], cognition: [], presets: [],
      },
      coverage: { runtime: 'opencode', contractVersion: '1.2.3', static: { missing: [] } },
    })).toBe(true);
    expect(Value.Check(RuntimeContractResponse, {
      manifest: { schemaVersion: 1, contractVersion: 'x', generatedFrom: 'y', domains: [] },
      coverage: null,
    })).toBe(false);

    expect(Value.Check(RuntimeConfigGetResponse, { config: {} })).toBe(true);
    expect(Value.Check(RuntimeConfigGetResponse, { config: { provider: { openai: {} } } })).toBe(true);
    expect(Value.Check(RuntimeConfigGetResponse, { config: null })).toBe(false);

    // plugins.client: committed snapshot; descriptor internals stay open.
    expect(Value.Check(PluginsClientResponse, {
      revision: 'boot:1',
      plugins: [{
        name: 'demo', version: '1.0.0', revision: 'boot:1',
        ui: { panels: [{ title: 'Demo' }] },
        actions: [{ id: 'run' }], events: [{ name: 'ran' }],
        diagnostics: [{ level: 'warn', message: 'm' }],
        futureKey: true,
      }],
    })).toBe(true);
    expect(Value.Check(PluginsClientResponse, { revision: 'boot:1', plugins: [{ name: 'demo' }] })).toBe(false);

    expect(Value.Check(ModelConfigGetResponse, {
      recall: { workerModel: { providerID: 'p', modelID: 'm' } },
      media: { provider: 'dashscope', model: 'wan', image: { provider: 'p', model: 'i' } },
      goal: { nodeModel: { providerID: 'p', modelID: 'm' }, techLeadModel: null },
      available: [{ providerID: 'p', providerName: 'P', models: [{ id: 'm', name: 'M' }] }],
    })).toBe(true);
    // Provider scan unavailable: available null is a valid 200.
    expect(Value.Check(ModelConfigGetResponse, {
      recall: { workerModel: { providerID: 'p', modelID: 'm' } },
      media: {},
      goal: {},
      available: null,
    })).toBe(true);

    expect(Value.Check(MediaPluginsResponse, {
      plugins: [{ file: 'dashscope.js', name: 'dashscope', status: 'ok', modalities: ['image', 'video'] }],
    })).toBe(true);

    expect(Value.Check(TtsVoicesResponse, {
      voices: [{ id: 'Mia', label: 'Mia', lang: 'en' }],
      engine: 'mimo',
      capabilities: { streaming: 'native', voiceCloning: false, styleControl: true, languages: ['zh'], sampleRate: 24000 },
      engines: [{ name: 'mimo', source: 'builtin' }, { name: 'legacy', source: 'legacy' }],
      models: [{ id: 'mimo-v2.5-tts', description: 'preset' }],
      defaultVoice: '茉莉',
      defaultModel: 'mimo-v2.5-tts',
    })).toBe(true);
    expect(Value.Check(TtsVoicesResponse, {
      voices: [], engine: 'mimo',
      capabilities: { streaming: 'sse', voiceCloning: false, styleControl: false, languages: [], sampleRate: 1 },
      engines: [], models: [], defaultVoice: 'x', defaultModel: 'y',
    })).toBe(false);

    const voiceStatus = {
      ok: true,
      config: {
        tier: 'local', localTier: 'dgpu', asrEngine: 'qwen3-asr-1.7b-vllm', ttsEngine: 'cosyvoice3-0.5b',
        cloudConsent: false, modelsDir: '/m', sidecarPort: 3911, duplexV1: false,
      },
      engines: [{
        name: 'qwen3-asr', source: 'builtin',
        capabilities: { streaming: 'native', languages: ['zh'], punctuation: true, timestamps: 'segment', sampleRate: 16000 },
      }],
      routing: { status: 'local_accelerated' },
    };
    expect(Value.Check(VoiceStatusResponse, voiceStatus)).toBe(true);
    // Sidecar not initialized: still 200 with an empty engine list.
    expect(Value.Check(VoiceStatusResponse, { ...voiceStatus, engines: [] })).toBe(true);
    expect(Value.Check(VoiceStatusResponse, {
      ...voiceStatus, routing: { status: 'network' },
    })).toBe(false);

    expect(Value.Check(EmbeddingGetResponse, {
      current: {
        provider: 'local', engine: 'llamacpp', model: 'qwen3', dimensions: 1024, baseUrl: 'http://127.0.0.1:1',
        threads: 4, llamacpp: { gpu: 'vulkan', threads: 4, contextSize: 2048, batchSize: 256 },
      },
      runtime: { active: 'llamacpp:qwen3', providerId: 'local', modelTag: 'qwen3', dims: 1024, vectors: 10, indexEntries: 10, coverage: 1 },
      available: { providers: ['off', 'local', 'dashscope'], engines: ['onnx', 'llamacpp'], gpus: ['cpu', 'vulkan', 'cuda'] },
    })).toBe(true);
    expect(Value.Check(EmbeddingGetResponse, {
      current: {
        provider: 'off', engine: 'onnx', model: 'm', dimensions: 1, baseUrl: '', threads: 1,
        llamacpp: { gpu: 'cpu', threads: 1, contextSize: 1, batchSize: 1 },
      },
      runtime: { active: null, providerId: null, modelTag: null, dims: null, vectors: 0, indexEntries: 0, coverage: 1 },
      available: { providers: [], engines: [], gpus: [] },
    })).toBe(true);
    expect(Value.Check(EmbeddingGetResponse, {
      current: {
        provider: 'remote', engine: 'onnx', model: 'm', dimensions: 1, baseUrl: '', threads: 1,
        llamacpp: { gpu: 'cpu', threads: 1, contextSize: 1, batchSize: 1 },
      },
      runtime: { active: null, providerId: null, modelTag: null, dims: null, vectors: 0, indexEntries: 0, coverage: 1 },
      available: { providers: [], engines: [], gpus: [] },
    })).toBe(false);
  });
});

describe('api-contract: E10f-C goal / lead / event / standing / automation / pod read response schema (16 ops)', () => {
  const findOp = (operationId: string): any => {
    for (const pathItem of Object.values(contract.paths || {}) as any[]) {
      for (const op of Object.values(pathItem) as any[]) {
        if (op?.operationId === operationId) return op;
      }
    }
    return undefined;
  };
  const schemaOf = (operationId: string): any =>
    findOp(operationId).responses['200'].content['application/json'].schema;

  const ISO = '2026-11-14T00:00:00.000Z';

  const EXPECTED: Record<string, {
    fields: string[];
    union?: true;
    item?: { at: string; required: string[] };
  }> = {
    'lead.boundaries.list': {
      fields: ['items'],
      item: {
        at: 'items',
        required: [
          'id', 'projectDir', 'leadSessionId', 'fromTopicId', 'toTopicId', 'trigger', 'confidence',
          'status', 'text', 'createdAt',
        ],
      },
    },
    'lead.topics.list': {
      fields: ['items'],
      item: { at: 'items', required: ['id', 'title', 'summary', 'state', 'lastActiveAt', 'goalId', 'resumedFrom'] },
    },
    'lead.topics.get': {
      fields: ['topic', 'messages'],
      item: { at: 'messages', required: ['topicId', 'messageId', 'role', 'text', 'tokenEstimate', 'createdAt'] },
    },
    'events.sources.list': {
      fields: ['items'],
      item: { at: 'items', required: ['id', 'kind', 'name', 'enabled', 'cursor', 'updatedAt'] },
    },
    'events.threads.list': {
      fields: ['items'],
      item: {
        at: 'items',
        required: ['id', 'sourceId', 'projectDir', 'externalKey', 'title', 'state', 'lastTriggerAt', 'createdAt'],
      },
    },
    'events.threads.triggers': {
      fields: ['items'],
      item: {
        at: 'items',
        required: [
          'id', 'sourceId', 'threadId', 'externalId', 'kind', 'actor', 'payload', 'occurredAt',
          'receivedAt', 'idempotencyKey', 'disposition',
        ],
      },
    },
    'events.threads.subscriptions.list': {
      fields: ['items'],
      item: {
        at: 'items',
        required: [
          'id', 'threadId', 'subscriberType', 'subscriberId', 'mode', 'createdAt', 'expiresAt', 'droppedAt',
        ],
      },
    },
    'events.deliveries.list': {
      fields: ['items'],
      item: {
        at: 'items',
        required: [
          'id', 'triggerId', 'subscriptionId', 'state', 'attempts', 'lastError', 'deliveredAt',
          'readAt', 'ackAt', 'answeredAt', 'nextRetryAt',
        ],
      },
    },
    'standingGoals.list': {
      fields: ['items'],
      item: {
        at: 'items',
        required: [
          'id', 'projectDir', 'title', 'objective', 'template', 'triggers', 'state', 'concurrency',
          'cooldownMs', 'budget', 'approval', 'createdBy', 'createdAt', 'updatedAt', 'lastRunAt', 'nextRunAt',
        ],
      },
    },
    'standingGoals.runs': {
      fields: ['items'],
      item: {
        at: 'items',
        required: [
          'id', 'standingGoalId', 'triggerType', 'triggerKey', 'payload', 'status', 'mode', 'rationale',
          'goalId', 'sessionId', 'worktree', 'result', 'costUsd', 'tokens', 'startedAt', 'endedAt',
        ],
      },
    },
    'automations.list': {
      fields: ['rules'],
      item: { at: 'rules', required: ['id', 'enabled', 'trigger', 'nextTriggers', 'recentHistory'] },
    },
    'automations.get': { fields: ['id', 'enabled', 'trigger', 'nextTriggers', 'history'] },
    'automations.history': { fields: ['history'], item: { at: 'history', required: ['timestamp', 'event'] } },
    'pods.ensure': {
      fields: ['pod', 'members', 'goals', 'attention', 'messageHealth', 'tasks', 'sessions'],
    },
    // ?file= → {content}；无 file → {context}（文件缺失时两者都是 null，不是 404）。
    'pods.memory.get': { fields: [], union: true },
    'orchestration.outcomes': {
      fields: ['outcomes'],
      item: {
        at: 'outcomes',
        required: [
          'goal_id', 'project_id', 'verdict', 'rounds', 'duration_ms', 'tokens_input', 'tokens_output',
          'total_cost', 'tool_error_count', 'thumbs_up', 'thumbs_down', 'policy_version',
          'evolution_proposal_id', 'failure_kind', 'failure_signature', 'created_at', 'archived_at',
        ],
      },
    },
  };

  test('all sixteen ops expose a 200 JSON schema with properties (not a whole-response widening)', () => {
    expect(Object.keys(EXPECTED)).toHaveLength(16);
    const problems: string[] = [];
    for (const [operationId, spec] of Object.entries(EXPECTED)) {
      const op = findOp(operationId);
      if (!op) { problems.push(`${operationId}: missing from openapi.json`); continue; }
      const schema = op.responses?.['200']?.content?.['application/json']?.schema;
      if (!schema) { problems.push(`${operationId}: responses.200 missing application/json schema`); continue; }
      if (spec.union) {
        if ((schema.anyOf ?? []).length !== 2) problems.push(`${operationId}: expected a two-branch union`);
        continue;
      }
      const properties = Object.keys(schema.properties ?? {});
      if (properties.length === 0) { problems.push(`${operationId}: schema has no properties (widened)`); continue; }
      for (const field of spec.fields) {
        if (!properties.includes(field)) problems.push(`${operationId}: schema missing property '${field}'`);
      }
    }
    if (problems.length) {
      console.error('[api-contract] E10f-C response schema missing - run emit:openapi + gen:api:\n' + problems.join('\n'));
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

  test('lead topics / boundaries expose the full wire row (view projection + index rows)', () => {
    const topics = schemaOf('lead.topics.list').properties.items.items;
    expect(topics.properties.summary.anyOf.map((e: any) => e.type)).toEqual(['string', 'null']);
    expect(topics.properties.resumedFrom.anyOf.map((e: any) => e.type)).toEqual(['string', 'null']);
    expect(topics.properties.state.anyOf.map((e: any) => e.const))
      .toEqual(['resident', 'warm', 'cold', 'archived']);
    // topic detail carries the searchable index rows, not the transcript.
    expect(Object.keys(schemaOf('lead.topics.get').properties).sort()).toEqual(['messages', 'topic']);
    const boundary = schemaOf('lead.boundaries.list').properties.items.items;
    // `text` is on the wire (`TopicBoundaryRow.text`) and was missing from the SDK DTO before E10f-C.
    expect(boundary.required).toContain('text');
    expect(boundary.properties.trigger.anyOf.map((e: any) => e.const))
      .toEqual(['explicit', 'semantic', 'idle', 'goal_closed', 'keyword']);
    expect(boundary.properties.toTopicId.anyOf.map((e: any) => e.type)).toEqual(['string', 'null']);
  });

  test('event layer rows keep storage columns; sources are the owned view projection', () => {
    // sources: sourceView() drops projectDir/config/createdAt (SDK EventSourceView).
    expect(Object.keys(schemaOf('events.sources.list').properties.items.items.properties).sort())
      .toEqual(['cursor', 'enabled', 'id', 'kind', 'name', 'updatedAt']);
    const cursor = schemaOf('events.sources.list').properties.items.items.properties.cursor;
    // Cursor internals are per-adapter → boundary object (open index), not a whole-response widening.
    expect(cursor.type).toBe('object');
    expect(cursor.patternProperties).toEqual({ '^(.*)$': {} });

    for (const op of ['events.threads.list', 'events.threads.triggers',
      'events.threads.subscriptions.list', 'events.deliveries.list']) {
      expect(Object.keys(schemaOf(op).properties)).toEqual(['items']);
    }
    expect(schemaOf('events.threads.list').properties.items.items.required).toContain('projectDir');
    expect(schemaOf('events.threads.list').properties.items.items.properties.state.anyOf.map((e: any) => e.const))
      .toEqual(['open', 'closed', 'archived']);
    expect(schemaOf('events.deliveries.list').properties.items.items.properties.state.anyOf
      .map((e: any) => e.const))
      .toEqual(['pending', 'delivered', 'read', 'acknowledged', 'answered', 'handed_back', 'failed', 'dropped']);
  });

  test('standing goals keep optional template/budget facets and nullable run outcome', () => {
    const goal = schemaOf('standingGoals.list').properties.items.items;
    expect(goal.properties.state.anyOf.map((e: any) => e.const)).toEqual(['active', 'paused', 'stopped']);
    expect(goal.properties.stateReason.anyOf.map((e: any) => e.type)).toEqual(['string', 'null']);
    // stateReason is optional (legacy rows never wrote it).
    expect(goal.required).not.toContain('stateReason');
    expect(Object.keys(goal.properties.template.properties).sort())
      .toEqual(['acceptance', 'boundaries', 'planReview', 'taskType']);
    expect(Object.keys(goal.properties.budget.properties).sort())
      .toEqual(['perDayCostUsd', 'perRunCostUsd', 'perRunTurns']);
    expect(goal.properties.triggers.items.properties.type.anyOf.map((e: any) => e.const))
      .toEqual(['cron', 'event', 'manual']);

    const run = schemaOf('standingGoals.runs').properties.items.items;
    expect(run.properties.mode.anyOf.map((e: any) => e.const ?? e.type))
      .toEqual(['goal', 'report', 'action', 'skip', 'null']);
    // result is an engine-owned summary object, nullable until the run finishes.
    expect(run.properties.result.anyOf.map((e: any) => e.type)).toEqual(['object', 'null']);
  });

  test('automations.list is now handler truth (trigger union + enrichment, no stale override shape)', () => {
    const rules = schemaOf('automations.list').properties.rules;
    const item = rules.items;
    // The deleted override marked only id/enabled required and had no name-less trigger union.
    expect(item.required).toEqual(['id', 'enabled', 'trigger', 'nextTriggers', 'recentHistory']);
    expect(item.properties.trigger.anyOf.map((branch: any) => branch.properties.type.const))
      .toEqual(['cron', 'event']);
    expect(item.properties.trigger.anyOf[0].required).toEqual(['type', 'schedule', 'timezone']);
    expect(item.properties.trigger.anyOf[1].required).toEqual(['type', 'on', 'perGoalCooldown']);
    // No writer emits `name`; it is gone from both schema and DTO.
    expect(item.properties.name).toBeUndefined();
    // automations.get shares the rule body + derives nextTriggers/history.
    expect(Object.keys(schemaOf('automations.get').properties)).toEqual(expect.arrayContaining([
      'id', 'enabled', 'trigger', 'skill', 'args', 'onResult', 'goal_defaults', 'action',
      'nextTriggers', 'history',
    ]));
    expect(schemaOf('automations.history').properties.history.items.required)
      .toEqual(['timestamp', 'event']);
  });

  test('automations.list + session.list override entries are deleted (code-first now)', () => {
    const overrides = JSON.parse(readFileSync(
      join(__dirname, '..', '..', '..', 'packages', 'gateway-sdk', 'contract', 'overrides.json'),
      'utf-8',
    ));
    expect(overrides.operations['automations.list']).toBeUndefined();
    // E10f-E: `session.list` was inert (catalog already supplied the response schema,
    // merge-contract printed "catalog wins") -> deleted as dead weight, 11 -> 10.
    expect(overrides.operations['session.list']).toBeUndefined();
    expect(Object.keys(overrides.operations)).toHaveLength(10);
    // Deleting the override must NOT remove the schema: the catalog is the fact source.
    expect(schemaOf('session.list').properties.sessions.type).toBe('array');
  });

  test('E10f-E: note-board budget carries perNoteCap; recall.pinned budget does not', () => {
    // memory.listSticky wire = { ...NOTE_BOARD_BUDGET, used } -> perNoteCap is required
    // on both the 200 body and the 503 fail-open shell (same shape).
    const stickyBudget = schemaOf('memory.listSticky').properties.budget;
    expect([...stickyBudget.required].sort()).toEqual(['max', 'maxChars', 'perNoteCap', 'used']);

    // recall.pinned renders <user-profile> from PINNED_BUDGET (20 entries / 2000 chars)
    // and formatPinnedProfile does not truncate per note -> declaring perNoteCap there
    // would make the schema reject the handler's own body. Documented deviation from
    // the E10f-E brief; pinned identity text must stay whole.
    const pinnedBudget = schemaOf('recall.pinned').properties.budget;
    expect([...pinnedBudget.required].sort()).toEqual(['max', 'maxChars', 'used']);
    expect(pinnedBudget.properties.perNoteCap).toBeUndefined();
    expect(Value.Check(RecallPinnedResponse, {
      profile: null, entries: [], budget: { max: 20, maxChars: 2000, used: 0 },
    })).toBe(true);
  });

  test('pods.ensure reuses the pods.get detail shape; pods.memory.get is dual-shaped', () => {
    expect(schemaOf('pods.ensure')).toEqual(schemaOf('pods.get'));
    const memory = schemaOf('pods.memory.get');
    expect(memory.anyOf.map((branch: any) => branch.required))
      .toEqual([['content'], ['context']]);
    expect(memory.anyOf.map((branch: any) => branch.properties.content?.anyOf?.[1]?.type
      ?? branch.properties.context?.anyOf?.[1]?.type)).toEqual(['null', 'null']);
  });

  test('orchestration.outcomes keeps the gateway.db snake_case row', () => {
    const row = schemaOf('orchestration.outcomes').properties.outcomes.items;
    expect(row.properties.goal_id.type).toBe('string');
    expect(row.properties.archived_at.type).toBe('string');
    // legacy rows have no task_type value → optional/nullable, never required-as-string.
    expect(row.properties.task_type.anyOf.map((e: any) => e.type)).toEqual(['string', 'null']);
    expect(row.required).not.toContain('task_type');
  });

  test('error envelopes are not part of the 200 schema', () => {
    expect(Value.Check(LeadBoundariesResponse, { error: 'topic id is required' })).toBe(false);
    expect(Value.Check(LeadTopicGetResponse, { error: 'topic not found' })).toBe(false);
    expect(Value.Check(EventSourcesResponse, { error: 'event layer disabled' })).toBe(false);
    expect(Value.Check(StandingGoalListResponse, { error: 'standing goals disabled' })).toBe(false);
    expect(Value.Check(StandingGoalRunsResponse, { error: 'standing goal not found: sg_1' })).toBe(false);
    expect(Value.Check(AutomationGetResponse, { error: 'Rule not found' })).toBe(false);
    expect(Value.Check(OrchestrationOutcomesResponse, { error: 'boom' })).toBe(false);
  });

  test('handler wire samples validate against each new schema (Value.Check)', () => {
    const topic = {
      id: 'tp_1', title: 'Goal intake', summary: null, state: 'warm',
      lastActiveAt: ISO, goalId: 'g_1', resumedFrom: null,
    };
    expect(Value.Check(LeadTopicsResponse, { items: [topic] })).toBe(true);
    expect(Value.Check(LeadTopicsResponse, { items: [{ ...topic, state: 'hot' }] })).toBe(false);

    const message = {
      topicId: 'tp_1', messageId: 'm_1', role: 'user', text: 'hi', tokenEstimate: 1, createdAt: ISO,
    };
    expect(Value.Check(LeadTopicGetResponse, { topic, messages: [message] })).toBe(true);
    expect(Value.Check(LeadTopicGetResponse, { topic, messages: [{ ...message, role: 'system' }] })).toBe(false);

    const boundary = {
      id: 'bd_1', projectDir: '/p', leadSessionId: 'ses_1', fromTopicId: 'tp_1', toTopicId: null,
      trigger: 'semantic', confidence: 0.62, status: 'proposed', text: 'let us switch', createdAt: ISO,
    };
    expect(Value.Check(LeadBoundariesResponse, { items: [boundary] })).toBe(true);
    expect(Value.Check(LeadBoundariesResponse, { items: [{ ...boundary, trigger: 'manual' }] })).toBe(false);

    const source = {
      id: 'src_1', kind: 'webhook', name: 'hook', enabled: true, cursor: { etag: 'x' }, updatedAt: ISO,
    };
    expect(Value.Check(EventSourcesResponse, { items: [source] })).toBe(true);
    expect(Value.Check(EventSourcesResponse, { items: [{ ...source, kind: 'slack' }] })).toBe(false);

    const thread = {
      id: 'th_1', sourceId: 'src_1', projectDir: '/p', externalKey: 'o/r#1', title: 'issue',
      state: 'open', lastTriggerAt: null, createdAt: ISO,
    };
    expect(Value.Check(EventThreadsResponse, { items: [thread] })).toBe(true);
    expect(Value.Check(EventThreadsResponse, { items: [{ ...thread, state: 'pending' }] })).toBe(false);

    const trigger = {
      id: 'tr_1', sourceId: 'src_1', threadId: 'th_1', externalId: 'evt_1', kind: 'issues.opened',
      actor: null, payload: { number: 1 }, occurredAt: ISO, receivedAt: ISO,
      idempotencyKey: 'src_1:evt_1', disposition: 'pending',
    };
    expect(Value.Check(EventTriggersResponse, { items: [trigger] })).toBe(true);
    expect(Value.Check(EventTriggersResponse, { items: [{ ...trigger, disposition: 'done' }] })).toBe(false);

    const subscription = {
      id: 'sub_1', threadId: 'th_1', subscriberType: 'goal', subscriberId: 'g_1',
      mode: 'work', createdAt: ISO, expiresAt: null, droppedAt: null,
    };
    expect(Value.Check(EventSubscriptionsResponse, { items: [subscription] })).toBe(true);
    expect(Value.Check(EventSubscriptionsResponse, { items: [{ ...subscription, subscriberType: 'user' }] }))
      .toBe(false);

    const delivery = {
      id: 'dl_1', triggerId: 'tr_1', subscriptionId: 'sub_1', state: 'delivered', attempts: 1,
      lastError: null, deliveredAt: ISO, readAt: null, ackAt: null, answeredAt: null, nextRetryAt: null,
    };
    expect(Value.Check(EventDeliveriesResponse, { items: [delivery] })).toBe(true);
    expect(Value.Check(EventDeliveriesResponse, { items: [{ ...delivery, state: 'ok' }] })).toBe(false);

    const standingGoal = {
      id: 'sg_1', projectDir: '/p', title: 'Nightly flake hunt', objective: 'Fix flaky tests',
      template: { taskType: 'bug', acceptance: ['tests pass'], boundaries: ['no deps'], planReview: 'auto' },
      triggers: [{ id: 'tg_1', type: 'cron', schedule: '0 3 * * *', timezone: 'UTC' }],
      state: 'active', stateReason: null, concurrency: 1, cooldownMs: 60000,
      budget: { perRunTurns: 20, perRunCostUsd: 1.5, perDayCostUsd: 5 },
      approval: 'plan', createdBy: 'user', createdAt: ISO, updatedAt: ISO,
      lastRunAt: null, nextRunAt: ISO,
    };
    expect(Value.Check(StandingGoalListResponse, { items: [standingGoal] })).toBe(true);
    expect(Value.Check(StandingGoalListResponse, { items: [{ ...standingGoal, state: 'done' }] })).toBe(false);

    const run = {
      id: 'run_1', standingGoalId: 'sg_1', triggerType: 'event', triggerKey: 'tr_1', payload: { number: 1 },
      status: 'queued', mode: null, rationale: null, goalId: null, sessionId: null, worktree: null,
      result: null, costUsd: null, tokens: null, startedAt: null, endedAt: null,
    };
    expect(Value.Check(StandingGoalRunsResponse, { items: [run] })).toBe(true);
    expect(Value.Check(StandingGoalRunsResponse, { items: [{ ...run, status: 'active' }] })).toBe(false);

    const ledger = { timestamp: ISO, event: 'AUTOMATION_TRIGGERED', ruleId: 'rule_1', source: 'user', reason: 'enabled' };
    const rule = {
      id: 'rule_1', enabled: true,
      trigger: { type: 'cron', schedule: '0 * * * *', timezone: 'UTC' },
      skill: 'daily-triage', nextTriggers: [ISO], recentHistory: [ledger],
    };
    expect(Value.Check(AutomationsListResponse, { rules: [rule] })).toBe(true);
    expect(Value.Check(AutomationsListResponse, {
      rules: [{ ...rule, trigger: { type: 'event', on: ['issues.opened'], perGoalCooldown: '5m' }, nextTriggers: [] }],
    })).toBe(true);
    // Pre-E10f-C override shape (no discriminator, no enrichment) is no longer valid.
    expect(Value.Check(AutomationsListResponse, {
      rules: [{ id: 'rule_1', enabled: true, trigger: { schedule: '0 * * * *', timezone: 'UTC' } }],
    })).toBe(false);

    expect(Value.Check(AutomationGetResponse, {
      id: 'rule_1', enabled: true,
      trigger: { type: 'event', on: ['issues.opened'], perGoalCooldown: '5m' },
      nextTriggers: [], history: [ledger],
    })).toBe(true);
    expect(Value.Check(AutomationHistoryResponse, { history: [ledger] })).toBe(true);
    expect(Value.Check(AutomationHistoryResponse, { history: [{ event: 'x' }] })).toBe(false);

    // pods.memory.get both branches; a missing file is null, not an error envelope.
    expect(Value.Check(PodMemoryResponse, { content: '# POD' })).toBe(true);
    expect(Value.Check(PodMemoryResponse, { content: null })).toBe(true);
    expect(Value.Check(PodMemoryResponse, { context: '[POD CONTEXT]' })).toBe(true);
    expect(Value.Check(PodMemoryResponse, { context: null })).toBe(true);
    expect(Value.Check(PodMemoryResponse, {})).toBe(false);
    expect(Value.Check(PodMemoryResponse, { content: 1 })).toBe(false);

    const outcome = {
      goal_id: 'g_1', project_id: 'proj_1', verdict: 'PASS', rounds: 3, duration_ms: 1200,
      tokens_input: 10, tokens_output: 20, total_cost: 0.02, tool_error_count: 1,
      thumbs_up: 0, thumbs_down: 0, policy_version: 'builtin-v1', evolution_proposal_id: null,
      failure_kind: null, failure_signature: null, task_type: 'feature', created_at: ISO, archived_at: ISO,
    };
    expect(Value.Check(OrchestrationOutcomesResponse, { outcomes: [outcome] })).toBe(true);
    expect(Value.Check(OrchestrationOutcomesResponse, { outcomes: [] })).toBe(true);
    const { verdict: _verdict, ...withoutVerdict } = outcome;
    expect(Value.Check(OrchestrationOutcomesResponse, { outcomes: [withoutVerdict] })).toBe(false);
  });
});

describe('api-contract: E10f-D observability / device / A2A read response schema (8 ops)', () => {
  const findOp = (operationId: string): any => {
    for (const pathItem of Object.values(contract.paths || {}) as any[]) {
      for (const op of Object.values(pathItem) as any[]) {
        if (op?.operationId === operationId) return op;
      }
    }
    return undefined;
  };
  const schemaOf = (operationId: string): any =>
    findOp(operationId).responses['200'].content['application/json'].schema;

  const EXPECTED: Record<string, {
    fields: string[];
    item?: { at: string; required: string[] };
  }> = {
    'dashboard.stats': {
      fields: [
        'activeGoals', 'registeredProjects', 'sseClients', 'serveRunning',
        'eventAppendFailures', 'tokens',
      ],
    },
    'mobile.devicesList': {
      fields: ['devices'],
      item: { at: 'devices', required: ['id', 'fcmToken', 'platform', 'lastSeen'] },
    },
    'mobile.pairingCode': { fields: ['url'] },
    'devices.list': {
      fields: ['devices'],
      item: { at: 'devices', required: ['id', 'fcmToken', 'platform', 'lastSeen'] },
    },
    'session.subagents.result': { fields: ['status', 'structured', 'text'] },
    'health.root': {
      fields: [
        'status', 'serveRunning', 'registeredProjects', 'activeGoals', 'media',
        'gatewayVersion', 'experienceVersion', 'minimumClientExperienceVersion',
        'schemaEpoch', 'instanceId', 'distribution', 'channel', 'pid',
      ],
    },
    'a2a.agentCard': {
      fields: [
        'name', 'description', 'url', 'version', 'provider', 'capabilities',
        'defaultInputModes', 'defaultOutputModes', 'skills', 'securitySchemes',
        'securityRequirements', 'signatures',
      ],
      item: { at: 'skills', required: ['id', 'name', 'description'] },
    },
    'pods.a2aCard': {
      fields: [
        'name', 'description', 'url', 'version', 'provider', 'capabilities',
        'defaultInputModes', 'defaultOutputModes', 'skills', 'securitySchemes',
        'securityRequirements', 'signatures',
      ],
      item: { at: 'skills', required: ['id', 'name', 'description'] },
    },
  };

  test('all eight ops expose a 200 JSON schema with properties (not a whole-response widening)', () => {
    expect(Object.keys(EXPECTED)).toHaveLength(8);
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
      console.error('[api-contract] E10f-D response schema missing - run emit:openapi + gen:api:\n' + problems.join('\n'));
    }
    expect(problems).toEqual([]);
  });

  test('array item required fields match the handler wire (devices/skills)', () => {
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

  test('dashboard.stats keeps the optional token/event facets out of required', () => {
    const stats = schemaOf('dashboard.stats');
    // E2-5 / trajectory fail-open: both facets are omitted on some 200 paths.
    expect(stats.required).toEqual(['activeGoals', 'registeredProjects', 'sseClients', 'serveRunning']);
    expect(stats.properties.eventAppendFailures.type).toBe('number');
    // tokens reuses the usage.summary projection (getGlobalTokenSummary).
    expect(stats.properties.tokens.required).toEqual(['totalTokens', 'totalCost', 'turnCount', 'sessionCount']);
    expect(stats.properties.tokens.properties.totalTokens.required)
      .toEqual(['input', 'output', 'reasoning', 'cache']);
    expect(stats.properties.tokens.properties.totalTokens.properties.cache.required)
      .toEqual(['read', 'write']);
  });

  test('health.root is the liveness envelope with all-or-nothing release identity', () => {
    const health = schemaOf('health.root');
    expect(health.required).toEqual([
      'status', 'serveRunning', 'registeredProjects', 'activeGoals', 'media',
    ]);
    expect(health.properties.status.const).toBe('ok');
    expect(health.properties.media.required).toEqual(['configured']);
    expect(health.properties.registeredProjects.items.type).toBe('string');
    expect(health.properties.activeGoals.items.type).toBe('string');
    // gatewayHealthFields() returns all eight or {} -> provenance fields optional.
    for (const field of ['gatewayVersion', 'experienceVersion', 'minimumClientExperienceVersion',
      'schemaEpoch', 'instanceId', 'distribution', 'channel', 'pid']) {
      expect(health.required).not.toContain(field);
      expect(health.properties[field]).toBeDefined();
    }
    expect(health.properties.distribution.anyOf.map((e: any) => e.const))
      .toEqual(['desktop-managed', 'standalone']);
  });

  test('device lists promise the PublicDeviceEntry projection only (no credential hashes)', () => {
    const device = schemaOf('mobile.devicesList').properties.devices.items;
    expect(device.required).toEqual(['id', 'fcmToken', 'platform', 'lastSeen']);
    expect(Object.keys(device.properties).sort())
      .toEqual(['deviceName', 'fcmToken', 'id', 'lastSeen', 'platform', 'tokenIssuedAt']);
    expect(device.properties.apiTokenHash).toBeUndefined();
    expect(device.properties.deviceTokenHash).toBeUndefined();
    // legacy GET /api/devices is the same listPublicDevices() wire.
    expect(schemaOf('devices.list')).toEqual(schemaOf('mobile.devicesList'));
    expect(schemaOf('mobile.pairingCode').required).toEqual(['url']);
  });

  test('session.subagents.result pins the service status union and keeps structured/text exclusive', () => {
    const result = schemaOf('session.subagents.result');
    expect(result.required).toEqual(['status']);
    expect(result.properties.status.anyOf.map((e: any) => e.const))
      .toEqual(['running', 'completed', 'failed', 'aborted']);
    // outputSchema-owned JSON / last assistant text: present one at a time.
    expect(result.required).not.toContain('structured');
    expect(result.required).not.toContain('text');
  });

  test('A2A agent cards are protocol boundary documents shared by both emitters', () => {
    const card = schemaOf('a2a.agentCard');
    expect(card.required).toEqual([
      'name', 'description', 'url', 'version', 'provider', 'capabilities',
      'defaultInputModes', 'defaultOutputModes', 'skills', 'securitySchemes',
      'securityRequirements', 'signatures',
    ]);
    // owner = A2A protocol: v0.3 card-level version + v1.0 interfaces are optional.
    expect(card.properties.protocolVersion.type).toBe('string');
    expect(card.properties.supportedInterfaces.type).toBe('array');
    expect(card.properties.supportedInterfaces.items.required)
      .toEqual(['url', 'protocolBinding', 'protocolVersion']);
    expect(card.properties.capabilities.required)
      .toEqual(['streaming', 'pushNotifications', 'extensions']);
    // Nested protocol-owned entries stay open (protocol evolution must not break).
    expect(card.properties.skills.items.additionalProperties).toBe(true);
    expect(card.properties.capabilities.additionalProperties).toBe(true);
    expect(card.additionalProperties).toBe(true);
    expect(card.properties.securitySchemes.type).toBe('object');
    // pods.a2aCard is the same AgentCard document (Pod handoff agent).
    expect(schemaOf('pods.a2aCard')).toEqual(card);
  });

  test('error envelopes are not part of the 200 schema', () => {
    expect(Value.Check(PairingCodeResponse, { error: 'rate limit exceeded' })).toBe(false);
    expect(Value.Check(DeviceListResponse, { error: 'push gateway unavailable' })).toBe(false);
    expect(Value.Check(SessionSubagentResultResponse, { error: 'subagent not found: sub_1' })).toBe(false);
    expect(Value.Check(HealthResponse, { error: 'boom' })).toBe(false);
    expect(Value.Check(A2AAgentCardResponse, { error: 'pod not found' })).toBe(false);
  });

  test('handler wire samples validate against each new schema (Value.Check)', () => {
    // dashboard.stats: base-only (no event store) and enriched with tokens.
    expect(Value.Check(DashboardStatsResponse, {
      activeGoals: 2, registeredProjects: 3, sseClients: 1, serveRunning: true,
    })).toBe(true);
    expect(Value.Check(DashboardStatsResponse, {
      activeGoals: 0, registeredProjects: 0, sseClients: 0, serveRunning: false,
      eventAppendFailures: 0,
      tokens: {
        totalTokens: { input: 10, output: 20, reasoning: 1, cache: { read: 3, write: 4 } },
        totalCost: 0.25, turnCount: 7, sessionCount: 2,
      },
    })).toBe(true);
    expect(Value.Check(DashboardStatsResponse, {
      activeGoals: 0, registeredProjects: 0, sseClients: 0, serveRunning: true,
      tokens: { totalTokens: { input: 1, output: 1, reasoning: 0 }, totalCost: 0, turnCount: 0, sessionCount: 0 },
    })).toBe(false);

    // health.root: release metadata not loaded yet -> envelope only.
    expect(Value.Check(HealthResponse, {
      status: 'ok', serveRunning: true, registeredProjects: ['/p'], activeGoals: ['g_1'],
      media: { configured: false },
    })).toBe(true);
    // managed desktop payload carries the full release identity.
    expect(Value.Check(HealthResponse, {
      status: 'ok', serveRunning: true, registeredProjects: [], activeGoals: [],
      media: { configured: true },
      gatewayVersion: '4.16.1', experienceVersion: '1.0', minimumClientExperienceVersion: '1.0',
      schemaEpoch: 3, instanceId: 'uuid', distribution: 'desktop-managed', channel: 'managed', pid: 123,
    })).toBe(true);
    expect(Value.Check(HealthResponse, {
      status: 'ok', serveRunning: true, registeredProjects: [], activeGoals: [],
      media: { configured: true }, distribution: 'cloud',
    })).toBe(false);

    // devices: listPublicDevices() rows (credential hashes already stripped).
    const device = {
      id: 'dev_1', fcmToken: 'fcm', platform: 'android', lastSeen: '2026-11-14T00:00:00.000Z',
    };
    expect(Value.Check(DeviceListResponse, { devices: [device] })).toBe(true);
    expect(Value.Check(DeviceListResponse, { devices: [] })).toBe(true);
    expect(Value.Check(DeviceListResponse, {
      devices: [{ ...device, deviceName: 'Pixel', tokenIssuedAt: '2026-11-14T00:00:00.000Z' }],
    })).toBe(true);
    const { platform: _platform, ...withoutPlatform } = device;
    expect(Value.Check(DeviceListResponse, { devices: [withoutPlatform] })).toBe(false);

    expect(Value.Check(PairingCodeResponse, {
      url: 'orcalore://pair?url=https%3A%2F%2Fx&v=2&exp=1&nonce=abc',
    })).toBe(true);
    expect(Value.Check(PairingCodeResponse, {})).toBe(false);

    // subagent result: structured output branch / final assistant text branch.
    expect(Value.Check(SessionSubagentResultResponse, { status: 'completed', text: 'done' })).toBe(true);
    expect(Value.Check(SessionSubagentResultResponse, {
      status: 'completed', structured: { answer: 42 },
    })).toBe(true);
    expect(Value.Check(SessionSubagentResultResponse, { status: 'running' })).toBe(true);
    expect(Value.Check(SessionSubagentResultResponse, { status: 'cancelled' })).toBe(false);
    expect(Value.Check(SessionSubagentResultResponse, {})).toBe(false);

    // A2A media card (no protocolVersion / supportedInterfaces) and Pod card (both).
    const mediaCard = {
      name: 'MAFW MediaAgent',
      description: 'multimodal agent',
      url: 'http://127.0.0.1:3000/a2a',
      version: '1.0.0',
      provider: { url: 'http://127.0.0.1:3000', organization: 'MAFW' },
      capabilities: { streaming: false, pushNotifications: false, extensions: [] },
      defaultInputModes: ['text', 'image'],
      defaultOutputModes: ['text'],
      skills: [{
        id: 'media_analyze', name: 'media_analyze', description: 'answer media questions',
        tags: ['media'], examples: [], inputModes: ['text'], outputModes: ['text'],
        securityRequirements: [],
      }],
      supportedInterfaces: [],
      securitySchemes: {},
      securityRequirements: [],
      signatures: [],
    };
    expect(Value.Check(A2AAgentCardResponse, mediaCard)).toBe(true);
    expect(Value.Check(A2AAgentCardResponse, {
      ...mediaCard,
      name: 'MAFW Pod pod_1',
      protocolVersion: '1.0',
      supportedInterfaces: [{
        url: 'http://127.0.0.1:3000/a2a/pods/pod_1',
        protocolBinding: 'JSONRPC',
        protocolVersion: '1.0',
      }],
    })).toBe(true);
    // Protocol-owned extension key is tolerated (boundary, not a closed shape).
    expect(Value.Check(A2AAgentCardResponse, { ...mediaCard, futureProtocolField: true })).toBe(true);
    const { skills: _skills, ...withoutSkills } = mediaCard;
    expect(Value.Check(A2AAgentCardResponse, withoutSkills)).toBe(false);
    expect(Value.Check(A2AAgentCardResponse, {
      ...mediaCard, capabilities: { streaming: false },
    })).toBe(false);
  });
});

describe('api-contract: E10g request bodies (W1 session writes)', () => {
  function opById(operationId: string): any {
    for (const methods of Object.values<any>(contract.paths)) {
      for (const op of Object.values<any>(methods)) {
        if (op?.operationId === operationId) return op;
      }
    }
    return null;
  }

  function bodyOf(operationId: string): any {
    const op = opById(operationId);
    expect(`${operationId}:${op ? 'present' : 'missing'}`).toBe(`${operationId}:present`);
    const body = op.requestBody;
    expect(`${operationId}:requestBody`).toBe(`${operationId}:${body ? 'requestBody' : 'missing'}`);
    return body;
  }

  test('write ops with a requestBody count matches the coverage ledger (189 = P0 3 + W1 35 + W2W3 33 + W4 29 + W5 24 + W6 26 + W7 30 + W8 2 + P6 7)', () => {
    const withBody: string[] = [];
    for (const methods of Object.values<any>(contract.paths)) {
      for (const [method, op] of Object.entries<any>(methods)) {
        if (method === 'get' || !op?.operationId) continue;
        if (op.requestBody) withBody.push(op.operationId);
      }
    }
    expect(withBody).toHaveLength(189);
    expect(withBody).toEqual(expect.arrayContaining([
      // Phase 6 plugin recovery (E10g-fix): quarantine has a body, the rest are
      // empty-object opt-in bodies, so all seven carry a requestBody.
      'plugins.quarantine', 'plugins.doctor', 'plugins.doctorAll', 'plugins.kill',
      'plugins.resume', 'plugins.unquarantine', 'plugins.rollback',
      'session.create', 'tasks.submit', 'pods.tasks.create',
      'session.config.set', 'session.promptAsync', 'structured.submit',
      'tasks.message', 'terminal.create', 'fileHistory.snapshot',
      'pods.update', 'pods.messages.create', 'pods.goals.accept',
      'pod.events.seenAll',
      'goals.planApproval', 'decisions.draft', 'standingGoals.create',
      'lead.compact', 'goals.control', 'goalRuns.approve',
      'event.publish', 'automations.draft', 'approvals.respond',
      'questions.reply', 'triage.propose', 'permissions.reply',
      'mcp.configApply', 'plugins.installPackage', 'runtime.switch',
      'config.set', 'project.setCurrent', 'manager.rotate',
      'mafwCommands.run',
      'memory.add', 'memory.setSticky', 'memory.merge', 'embedding.update',
      'media.switch', 'media.createTaskApi', 'tts.speak', 'chat.send',
      'python.execute', 'obs.capture', 'models.update', 'tools.execute',
      'eval.chatCompletions', 'llm.compress', 'mobile.devicesRegister',
      'devices.register', 'humanToken.rotate', 'skills.deopt',
      'cognition.gate', 'cognition.rewrite',
    ]));
    // Binary / multipart / A2A pass-through inputs have no JSON body schema:
    // they stay out of the ledger (E10g spec §1.3; the closing REQUEST_EXCLUDED
    // ledger records `media.upload`, `media.uploadAndCreate`, `media.createTask`,
    // `mobile.mediaTaskUpload`, `pods.a2a` and W6's `plugins.install`).
    for (const id of [
      'plugins.install',
      'media.upload',
      'media.uploadAndCreate',
      'media.createTask',
      'mobile.mediaTaskUpload',
      'pods.a2a',
    ]) {
      expect(`${id}:${withBody.includes(id)}`).toBe(`${id}:false`);
    }
  });

  test('session.config.set: category+value required, category is a closed enum', () => {
    const body = bodyOf('session.config.set');
    expect(body.required).toBe(true);
    const schema = body.content['application/json'].schema;
    expect(schema.required).toEqual(['category', 'value']);
    expect(schema.properties.category.anyOf.map((v: any) => v.const))
      .toEqual(['mode', 'agent', 'model', 'model_config', 'thought_level']);
    // value is required but its shape depends on category (null clears thought_level).
    expect(schema.properties.value.description).toContain('null clears thought_level');
    expect(schema.properties.value.type).toBeUndefined();
  });

  test('session.switchModel / switchAgent: required payload, variant optional', () => {
    const model = bodyOf('session.switchModel');
    expect(model.required).toBe(true);
    const modelSchema = model.content['application/json'].schema;
    expect(modelSchema.required).toEqual(['model']);
    expect(modelSchema.properties.model.required).toEqual(['providerID', 'modelID']);
    expect(modelSchema.properties.variant).toBeDefined();
    expect(modelSchema.required).not.toContain('variant');

    const agent = bodyOf('session.switchAgent');
    expect(agent.content['application/json'].schema.required).toEqual(['agent']);
  });

  test('session.promptAsync: message/parts optional, delivery enum pinned', () => {
    const body = bodyOf('session.promptAsync');
    expect(body.required).toBe(true);
    const schema = body.content['application/json'].schema;
    expect(schema.required).toBeUndefined();
    expect(schema.properties.message.description).toContain('parts is absent');
    expect(schema.properties.parts.description).toContain('message is absent');
    expect(schema.properties.delivery.anyOf.map((v: any) => v.const))
      .toEqual(['steer', 'followup', 'queue']);
    expect(schema.properties.maxTurns.type).toBe('number');
  });

  test('session.rename / session.revert / session.restoreCheckpoint: required fields', () => {
    expect(bodyOf('session.rename').content['application/json'].schema.required).toEqual(['title']);
    expect(bodyOf('session.revert').content['application/json'].schema.required).toEqual(['messageID']);
    const restore = bodyOf('session.restoreCheckpoint').content['application/json'].schema;
    expect(restore.required).toEqual(['scope', 'confirm']);
    expect(restore.properties.scope.anyOf.map((v: any) => v.const)).toEqual(['session', 'files', 'both']);
    expect(restore.properties.confirm.const).toBe(true);
  });

  test('session.revertDiff: non-empty patches with integer hunk indices', () => {
    const schema = bodyOf('session.revertDiff').content['application/json'].schema;
    expect(schema.required).toEqual(['patches']);
    expect(schema.properties.patches.minItems).toBe(1);
    expect(schema.properties.patches.items.required).toEqual(['patch', 'hunkIndices']);
    expect(schema.properties.patches.items.properties.hunkIndices.minItems).toBe(1);
    expect(schema.properties.patches.items.properties.hunkIndices.items.type).toBe('integer');
  });

  test('structured.submit / session.data / subagents.spawn keep their required anchors', () => {
    expect(bodyOf('structured.submit').content['application/json'].schema.required).toEqual(['sessionID', 'data']);
    const data = bodyOf('session.data').content['application/json'].schema;
    expect(data.required).toEqual(['name']);
    expect(data.properties.name.pattern).toBe('^[a-z0-9][a-z0-9_-]{0,31}$');
    const spawn = bodyOf('session.subagents.spawn').content['application/json'].schema;
    expect(spawn.required).toEqual(['prompt']);
    expect(spawn.properties.background.type).toBe('boolean');
    expect(bodyOf('session.subagents.message').content['application/json'].schema.required).toEqual(['message']);
  });

  test('session.command: proxied runtime body (optional body, required command+arguments)', () => {
    const body = bodyOf('session.command');
    expect(body.required).toBe(false);
    expect(body.content['application/json'].schema.required).toEqual(['command', 'arguments']);
  });

  test('session run bodies are optional but declare their handler fields', () => {
    // `routes/session-run.ts`: suspend reads `reason`, resume/discard read `runId`.
    // Every read is guarded (`typeof x === 'string' && x`), so an empty body is valid.
    const suspend = bodyOf('session.suspend');
    expect(suspend.required).toBe(false);
    const suspendSchema = suspend.content['application/json'].schema;
    expect(Object.keys(suspendSchema.properties)).toEqual(['reason']);
    expect(suspendSchema.properties.reason.type).toBe('string');
    expect(suspendSchema.properties.reason.description).toContain('non-string');

    for (const id of ['session.resume', 'session.discardRun']) {
      const body = bodyOf(id);
      expect(`${id}:${body.required}`).toBe(`${id}:false`);
      const schema = body.content['application/json'].schema;
      expect(Object.keys(schema.properties)).toEqual(['runId']);
      expect(schema.properties.runId.type).toBe('string');
    }
  });

  test('no-body actions declare an empty object with required:false', () => {
    for (const id of [
      'session.abort',
      'session.background',
      'session.unrevert',
      'session.delete',
      'session.deleteLegacy',
      'session.queue.clear',
      'session.queue.cancel',
      'session.subagents.cancel',
      'session.discoveryRefresh',
      'session.usagePluginsReload',
      'session.usagePluginsDelete',
      'session.usagePluginTest',
    ]) {
      const body = bodyOf(id);
      expect(`${id}:${body.required}`).toBe(`${id}:false`);
      const schema = body.content['application/json'].schema;
      expect(`${id}:${schema.type}`).toBe(`${id}:object`);
      expect(Object.keys(schema.properties ?? {})).toEqual([]);
    }
  });
});

describe('api-contract: E10g request bodies (W2/W3 tasks, terminal, pods)', () => {
  function bodyOf(operationId: string): any {
    for (const methods of Object.values<any>(contract.paths)) {
      for (const op of Object.values<any>(methods)) {
        if (op?.operationId === operationId) {
          expect(`${operationId}:requestBody`).toBe(`${operationId}:${op.requestBody ? 'requestBody' : 'missing'}`);
          return op.requestBody;
        }
      }
    }
    throw new Error(`operation not found: ${operationId}`);
  }

  function schemaOf(operationId: string): any {
    return bodyOf(operationId).content['application/json'].schema;
  }

  test('tasks.message / terminal.create / fileHistory.snapshot: required anchors', () => {
    expect(schemaOf('tasks.message').required).toEqual(['message']);
    expect(schemaOf('terminal.create').required).toEqual(['directory']);
    expect(schemaOf('terminal.create').properties.cols.type).toBe('number');

    const snapshot = bodyOf('fileHistory.snapshot');
    expect(snapshot.required).toBe(true);
    const schema = snapshot.content['application/json'].schema;
    expect(schema.required).toEqual(['sessionID', 'paths']);
    // directory is resolved from sessionID when absent (office skill sends only sessionID).
    expect(schema.required).not.toContain('directory');
    expect(schema.properties.paths.minItems).toBe(1);
    expect(schema.properties.paths.maxItems).toBe(200);
    // `reason` is truncated to 200 chars by the handler, never rejected.
    expect(schema.properties.reason.maxLength).toBeUndefined();
    expect(schema.properties.reason.description).toContain('200');
    expect(schemaOf('fileHistory.restore').required).toEqual(['sessionID', 'entryId']);
  });

  test('pods.goals.techLead.messages: parts are text-only and capped, not rejected', () => {
    const schema = schemaOf('pods.goals.techLead.messages');
    const parts = schema.properties.parts;
    expect(parts.items.properties.type.const).toBe('text');
    // `normalizeTechLeadParts` keeps the first 8; a longer array is not a 400.
    expect(parts.maxItems).toBeUndefined();
    expect(parts.description).toContain('first 8');
  });

  test('pods.update is a status-only PATCH with a closed status enum', () => {
    const body = bodyOf('pods.update');
    expect(body.required).toBe(true);
    const schema = body.content['application/json'].schema;
    expect(schema.required).toEqual(['status']);
    expect(schema.properties.status.anyOf.map((v: any) => v.const))
      .toEqual(['active', 'idle', 'paused', 'archived']);
  });

  test('pods.tasks.update: plan/state fields all optional (mixing is a handler 400)', () => {
    const schema = schemaOf('pods.tasks.update');
    expect(schema.required).toBeUndefined();
    expect(Object.keys(schema.properties).sort()).toEqual([
      'acceptance', 'actorSessionID', 'ownerMemberId', 'status', 'title',
    ]);
    expect(schema.properties.status.anyOf.map((v: any) => v.const))
      .toEqual(['pending', 'in_progress', 'blocked', 'review', 'done', 'failed', 'skipped', 'reopened']);
  });

  test('pods.messages.create: kind + body required, actor/from are the auth pair', () => {
    const schema = schemaOf('pods.messages.create');
    expect(schema.required).toEqual(['kind', 'body']);
    expect(schema.properties.kind.anyOf.map((v: any) => v.const))
      .toEqual(['note', 'request', 'review', 'decision', 'escalation']);
    expect(schema.properties.fromMemberId.description).toContain('actorSessionID');
    expect(schema.properties.notify.type).toBe('boolean');
  });

  test('pods.goals.accept: confirm:true literal, optional revision/force/risk flags', () => {
    const schema = schemaOf('pods.goals.accept');
    expect(schema.required).toEqual(['confirm']);
    expect(schema.properties.confirm.const).toBe(true);
    expect(schema.properties.revision.minimum).toBe(1);
    expect(schema.properties.force.type).toBe('boolean');
  });

  test('pods.goals.create / pods.goals.handoff: title anchors, handoff needs sourceRef.snapshot', () => {
    const create = schemaOf('pods.goals.create');
    expect(create.required).toEqual(['title']);
    expect(create.properties.source.anyOf.map((v: any) => v.const))
      .toEqual(['desktop', 'lead', 'a2a', 'automation', 'user', 'tui', 'agent', 'mobile']);

    const handoff = schemaOf('pods.goals.handoff');
    expect(handoff.required).toEqual(['title', 'sourceRef']);
    expect(handoff.properties.sourceRef.required).toEqual(['snapshot']);
  });

  test('pod.events.seenAll: goalId + revision are required', () => {
    expect(schemaOf('pod.events.seenAll').required).toEqual(['goalId', 'revision']);
  });

  test('W2/W3 empty and optional-body classifications project to required:false', () => {
    for (const id of [
      'tasks.cancel',
      'terminal.remove',
      'background.jobs.cancel',
      'pods.create',
      'pods.lead.ensure',
      'pods.messages.read',
      'pods.wake',
      'pods.sleep',
      'pod.events.seen',
    ]) {
      const body = bodyOf(id);
      expect(`${id}:${body.required}`).toBe(`${id}:false`);
      expect(Object.keys(body.content['application/json'].schema.properties ?? {})).toEqual([]);
    }
    // Optional body with declared fields: the actor / query fallback.
    for (const id of ['pods.tasks.delete', 'pods.goals.cancel', 'terminal.connectTicket']) {
      const body = bodyOf(id);
      expect(`${id}:${body.required}`).toBe(`${id}:false`);
      expect(Object.keys(body.content['application/json'].schema.properties).length).toBeGreaterThan(0);
    }
  });
});

describe('api-contract: E10g request bodies (W4 goals, decisions, lead, standing)', () => {
  function bodyOf(operationId: string): any {
    for (const methods of Object.values<any>(contract.paths)) {
      for (const op of Object.values<any>(methods)) {
        if (op?.operationId === operationId) {
          expect(`${operationId}:requestBody`).toBe(`${operationId}:${op.requestBody ? 'requestBody' : 'missing'}`);
          return op.requestBody;
        }
      }
    }
    throw new Error(`operation not found: ${operationId}`);
  }

  function schemaOf(operationId: string): any {
    return bodyOf(operationId).content['application/json'].schema;
  }

  test('goals.planApproval: approver envelope, feedback is the reject anchor', () => {
    const body = bodyOf('goals.planApproval');
    expect(body.required).toBe(true);
    const schema = body.content['application/json'].schema;
    // Every field is conditional: approve+hashes for approve, feedback for reject.
    expect(schema.required).toBeUndefined();
    expect(schema.properties.approve.type).toBe('boolean');
    expect(schema.properties.feedback.description).toContain('approve is not true');
    expect(schema.properties.approvalId.description).toContain('409');
    expect(schema.properties.planHash.description).toContain('stale_plan');
  });

  test('goals.retryNode / goals.retry: optional-body gates project to required:false', () => {
    const retryNode = bodyOf('goals.retryNode');
    expect(retryNode.required).toBe(false);
    expect(retryNode.content['application/json'].schema.properties.confirm.description)
      .toContain('execute');
    const retry = bodyOf('goals.retry');
    expect(retry.required).toBe(false);
    expect(retry.content['application/json'].schema.properties.runId.minimum).toBe(1);
    expect(bodyOf('goals.validate').required).toBe(false);
  });

  test('goals.respondQuestion / goals.control: closed discriminators', () => {
    const question = schemaOf('goals.respondQuestion');
    expect(question.required).toEqual(['type']);
    expect(question.properties.type.anyOf.map((v: any) => v.const)).toEqual(['answer', 'cancel']);
    expect(question.properties.answer.description).toContain('type is answer');

    const control = schemaOf('goals.control');
    expect(control.required).toEqual(['action']);
    expect(control.properties.action.anyOf.map((v: any) => v.const))
      .toEqual(['PAUSE', 'ABORT', 'FORCE_PHASE', 'RESET_PARAMETRIC']);
    expect(control.properties.goalId.description).toContain('RESET_PARAMETRIC');
    // Legacy alias /control shares the same request contract.
    expect(schemaOf('goals.controlLegacy')).toEqual(control);
  });

  test('decisions: draft/shelve anchor required fields; confirm/reopen are optional bodies', () => {
    const draft = bodyOf('decisions.draft');
    expect(draft.required).toBe(true);
    const draftSchema = draft.content['application/json'].schema;
    expect(draftSchema.required).toEqual(['kind', 'question']);
    expect(draftSchema.properties.question.maxLength).toBe(500);
    expect(draftSchema.properties.kind.anyOf).toHaveLength(8);
    expect(draftSchema.properties.options.maxItems).toBe(8);
    expect(draftSchema.properties.evidence.maxItems).toBe(12);
    // projectDir falls back to MAFW_PROJECT_DIR / cwd, so it is never required.
    expect(draftSchema.required).not.toContain('projectDir');

    expect(schemaOf('decisions.shelve').required).toEqual(['reviewAt']);
    for (const id of ['decisions.confirm', 'decisions.reopen']) {
      const body = bodyOf(id);
      expect(`${id}:${body.required}`).toBe(`${id}:false`);
      expect(Object.keys(body.content['application/json'].schema.properties).length).toBeGreaterThan(0);
    }
  });

  test('lead.compact requires topicId; fork goalTitle is optional metadata', () => {
    expect(schemaOf('lead.compact').required).toEqual(['topicId']);
    const fork = bodyOf('lead.topics.fork');
    expect(fork.required).toBe(false);
    expect(fork.content['application/json'].schema.required).toBeUndefined();
    expect(fork.content['application/json'].schema.properties.goalTitle).toBeDefined();
    // observe body is the input carrier (fields stay optional: blank → proposed:false).
    const observe = bodyOf('lead.boundaries.observe');
    expect(observe.required).toBe(true);
    expect(observe.content['application/json'].schema.required).toBeUndefined();
  });

  test('standingGoals.create anchors triggers; update is an all-optional PATCH', () => {
    const create = bodyOf('standingGoals.create');
    expect(create.required).toBe(true);
    const createSchema = create.content['application/json'].schema;
    expect(createSchema.required).toEqual(['triggers']);
    expect(createSchema.properties.triggers.minItems).toBe(1);
    expect(createSchema.properties.triggers.items.required).toEqual(['id', 'type']);
    expect(createSchema.properties.approval.anyOf.map((v: any) => v.const))
      .toEqual(['auto', 'plan', 'confirm']);
    expect(createSchema.properties.concurrency.minimum).toBe(1);

    const update = schemaOf('standingGoals.update');
    expect(update.required).toBeUndefined();
    expect(Object.keys(update.properties).sort()).toEqual([
      'approval', 'budget', 'concurrency', 'cooldownMs', 'objective', 'template', 'title', 'triggers',
    ]);
  });

  test('W4 body-ignored actions project to required:false with an empty object', () => {
    for (const id of [
      'goals.pause',
      'goals.resume',
      'goals.stop',
      'goals.complete',
      'lead.boundaries.accept',
      'lead.boundaries.merge',
      'lead.boundaries.undo',
      'lead.topics.resume',
      'standingGoals.pause',
      'standingGoals.resume',
      'standingGoals.stop',
      'standingGoals.run',
      'goalRuns.approve',
    ]) {
      const body = bodyOf(id);
      expect(`${id}:${body.required}`).toBe(`${id}:false`);
      expect(Object.keys(body.content['application/json'].schema.properties ?? {})).toEqual([]);
    }
  });
});

describe('api-contract: E10g request bodies (W5 events, automations, human gates, permissions)', () => {
  function bodyOf(operationId: string): any {
    for (const methods of Object.values<any>(contract.paths)) {
      for (const op of Object.values<any>(methods)) {
        if (op?.operationId === operationId) {
          expect(`${operationId}:requestBody`).toBe(`${operationId}:${op.requestBody ? 'requestBody' : 'missing'}`);
          return op.requestBody;
        }
      }
    }
    throw new Error(`operation not found: ${operationId}`);
  }

  function schemaOf(operationId: string): any {
    return bodyOf(operationId).content['application/json'].schema;
  }

  test('event.publish: flat envelope with a required type and open payload keys', () => {
    const body = bodyOf('event.publish');
    expect(body.required).toBe(true);
    const schema = body.content['application/json'].schema;
    expect(schema.required).toEqual(['type']);
    expect(schema.properties.type.minLength).toBe(1);
    expect(schema.properties.type.description).toContain('plugin:');
    // The payload is an open key set: arbitrary plugin fields ride along.
    expect(schema.additionalProperties).toBe(true);
  });

  test('event source create/patch anchor the handler-validated fields', () => {
    const create = bodyOf('events.sources.create');
    expect(create.required).toBe(true);
    const createSchema = create.content['application/json'].schema;
    expect(createSchema.required).toEqual(['kind', 'name']);
    expect(createSchema.properties.kind.anyOf.map((v: any) => v.const))
      .toEqual(['github', 'cron', 'internal', 'webhook']);
    expect(createSchema.properties.name.minLength).toBe(1);
    // projectDir falls back to MAFW_PROJECT_DIR / cwd.
    expect(createSchema.required).not.toContain('projectDir');

    const patch = schemaOf('events.sources.patch');
    expect(patch.required).toEqual(['enabled']);
    expect(patch.properties.enabled.type).toBe('boolean');
  });

  test('event subscription create: closed subscriber/mode sets', () => {
    const schema = schemaOf('events.threads.subscriptions.create');
    expect(schema.required).toEqual(['subscriberType', 'subscriberId', 'mode']);
    expect(schema.properties.subscriberType.anyOf.map((v: any) => v.const))
      .toEqual(['standing_goal', 'goal', 'lead']);
    expect(schema.properties.mode.anyOf.map((v: any) => v.const)).toEqual(['work', 'context']);
  });

  test('events.webhook.receive: declared as an open-object protocol boundary', () => {
    const body = bodyOf('events.webhook.receive');
    // The source adapter owns the shape; gateway passes body + rawBody + headers through.
    expect(body.required).toBe(false);
    const schema = body.content['application/json'].schema;
    expect(schema.properties ?? {}).toEqual({});
    expect(schema.additionalProperties).toBe(true);
  });

  test('automations.toggle requires the target state; draft anchors id + trigger', () => {
    const toggle = bodyOf('automations.toggle');
    expect(toggle.required).toBe(true);
    expect(toggle.content['application/json'].schema.required).toEqual(['enabled']);

    const draft = bodyOf('automations.draft');
    expect(draft.required).toBe(true);
    const draftSchema = draft.content['application/json'].schema;
    expect(draftSchema.required).toEqual(['id', 'trigger']);
    expect(draftSchema.properties.trigger.properties.type.anyOf.map((v: any) => v.const))
      .toEqual(['cron', 'event']);
    // Validation failures come back as 200 {valid:false, errors}, so only the
    // identity/mechanism fields are required.
    expect(draftSchema.required).not.toContain('skill');
    expect(draftSchema.properties.onResult.properties.type.anyOf.map((v: any) => v.const))
      .toEqual(['triage', 'goal']);
  });

  test('approvals.respond / questions.reply / triage.propose: human-supplied fields only', () => {
    const respond = bodyOf('approvals.respond');
    expect(respond.required).toBe(true);
    const respondSchema = respond.content['application/json'].schema;
    expect(respondSchema.required).toBeUndefined();
    expect(respondSchema.properties.decision.anyOf.map((v: any) => v.const)).toEqual(['approve', 'reject']);
    expect(respondSchema.properties.answer.description).toContain('unless decision');
    // actorSessionID is a forbidden field on human-only routes, never declared.
    expect(respondSchema.properties.actorSessionID).toBeUndefined();

    const reply = schemaOf('questions.reply');
    expect(reply.required).toEqual(['answers']);
    expect(reply.properties.answers.items.type).toBe('array');

    const propose = schemaOf('triage.propose');
    expect(propose.required).toEqual(['suggestion']);
    expect(propose.properties.suggestion.anyOf.map((v: any) => v.const)).toEqual(['confirm', 'reject']);
    expect(propose.properties.priority.anyOf.map((v: any) => v.const))
      .toEqual(['high', 'medium', 'low']);
  });

  test('permissions: reply vocabulary, mode tiers and allowlist/rule bodies', () => {
    const reply = bodyOf('permissions.reply');
    expect(reply.required).toBe(true);
    const replySchema = reply.content['application/json'].schema;
    expect(replySchema.required).toEqual(['reply']);
    expect(replySchema.properties.reply.anyOf.map((v: any) => v.const))
      .toEqual(['once', 'always', 'reject']);
    // persist is boolean | 'tool' | 'prefix' (the boolean branch has no const).
    const persistBranches = replySchema.properties.persist.anyOf;
    expect(persistBranches.map((v: any) => v.const).filter((v: unknown) => v !== undefined))
      .toEqual(['tool', 'prefix']);
    expect(persistBranches.some((v: any) => v.type === 'boolean')).toBe(true);

    const runtime = bodyOf('permissions.replyRuntime');
    expect(runtime.required).toBe(true);
    const runtimeSchema = runtime.content['application/json'].schema;
    // reply or the legacy approved boolean — either satisfies the handler.
    expect(runtimeSchema.required).toBeUndefined();
    expect(runtimeSchema.properties.approved.description).toContain('reply is absent');

    const mode = schemaOf('permissions.setMode');
    expect(mode.required).toEqual(['mode']);
    expect(mode.properties.mode.anyOf.map((v: any) => v.const))
      .toEqual(['read-only', 'auto', 'full-access', 'manual']);

    for (const [id, scopeKey] of [
      ['permissions.addAllowlist', 'prefix'],
      ['permissions.removeAllowlist', 'prefix'],
      ['permissions.addRule', 'pattern'],
      ['permissions.removeRule', 'pattern'],
    ] as const) {
      const body = bodyOf(id);
      expect(`${id}:${body.required}`).toBe(`${id}:true`);
      const schema = body.content['application/json'].schema;
      expect(schema.required).toEqual(['tool']);
      expect(schema.properties.tool.minLength).toBe(1);
      expect(schema.properties[scopeKey]).toBeDefined();
    }
  });

  test('W5 body-ignored actions project to required:false with an empty object', () => {
    for (const id of [
      'events.threads.close',
      'events.subscriptions.delete',
      'automations.remove',
      'questions.reject',
      'triage.dismiss',
      'triage.confirm',
      'triage.reject',
    ]) {
      const body = bodyOf(id);
      expect(`${id}:${body.required}`).toBe(`${id}:false`);
      expect(Object.keys(body.content['application/json'].schema.properties ?? {})).toEqual([]);
    }
  });
});

describe('api-contract: E10g request bodies (W6 mcp, plugins, runtime, config, project, manager, commands)', () => {
  function bodyOf(operationId: string): any {
    for (const methods of Object.values<any>(contract.paths)) {
      for (const op of Object.values<any>(methods)) {
        if (op?.operationId === operationId) {
          expect(`${operationId}:requestBody`).toBe(`${operationId}:${op.requestBody ? 'requestBody' : 'missing'}`);
          return op.requestBody;
        }
      }
    }
    throw new Error(`operation not found: ${operationId}`);
  }

  function schemaOf(operationId: string): any {
    return bodyOf(operationId).content['application/json'].schema;
  }

  test('mcp config preview/apply/remove anchor the optimistic-lock contract', () => {
    const preview = bodyOf('mcp.configPreview');
    expect(preview.required).toBe(true);
    const previewSchema = preview.content['application/json'].schema;
    expect(previewSchema.required).toEqual(['name', 'type']);
    expect(previewSchema.properties.type.anyOf.map((v: any) => v.const))
      .toEqual(['remote', 'local']);
    // url/command are conditionally required by the adapter, not by the contract.
    expect(previewSchema.required).not.toContain('url');
    expect(previewSchema.required).not.toContain('command');

    // apply re-declares the config input and adds the preview token + confirm.
    const apply = schemaOf('mcp.configApply');
    expect(apply.required).toEqual(['name', 'type', 'token', 'confirm']);
    expect(apply.properties.confirm.const).toBe(true);
    expect(apply.properties.token.minLength).toBe(1);

    const restore = schemaOf('mcp.configRestore');
    expect(restore.required).toEqual(['token', 'confirm']);
    expect(restore.properties.backupPath.type).toBe('string');

    const remove = schemaOf('mcp.configRemove');
    expect(remove.required).toEqual(['token', 'confirm']);

    expect(schemaOf('mcp.configPreviewRemove').required).toEqual(['name']);
  });

  test('mcp connect/disconnect ignore the body (path + directory query only)', () => {
    for (const id of ['mcp.connect', 'mcp.disconnect']) {
      const body = bodyOf(id);
      expect(`${id}:${body.required}`).toBe(`${id}:false`);
      expect(Object.keys(body.content['application/json'].schema.properties ?? {})).toEqual([]);
    }
  });

  test('plugin package/check bodies require an absolute path', () => {
    const install = bodyOf('plugins.installPackage');
    expect(install.required).toBe(true);
    expect(install.content['application/json'].schema.required).toEqual(['path']);
    expect(install.content['application/json'].schema.properties.overwrite.type).toBe('boolean');
    expect(install.content['application/json'].schema.properties.requestId.type).toBe('string');

    expect(schemaOf('plugins.check').required).toEqual(['path']);
  });

  test('plugin enable/disable/delete share the {package} | {type, filename} body', () => {
    for (const id of ['plugins.enable', 'plugins.disable', 'plugins.delete']) {
      const body = bodyOf(id);
      expect(`${id}:${body.required}`).toBe(`${id}:true`);
      const schema = body.content['application/json'].schema;
      // Variants, not free-form: every field is optional but the shape is fixed.
      expect(schema.required).toBeUndefined();
      expect(Object.keys(schema.properties).sort()).toEqual(['filename', 'package', 'type']);
      expect(schema.properties.type.anyOf.map((v: any) => v.const))
        .toEqual(['runtime', 'media', 'usage', 'ui']);
    }
  });

  test('plugin apply/reload ignore the body; invoke carries a plugin-defined input boundary', () => {
    for (const id of ['plugins.apply', 'plugins.reload']) {
      const body = bodyOf(id);
      expect(`${id}:${body.required}`).toBe(`${id}:false`);
      expect(Object.keys(body.content['application/json'].schema.properties ?? {})).toEqual([]);
    }

    const invoke = bodyOf('plugins.invoke');
    expect(invoke.required).toBe(false);
    const schema = invoke.content['application/json'].schema;
    expect(Object.keys(schema.properties).sort()).toEqual(['input', 'revision', 'sessionID']);
    // The action payload belongs to the plugin package author.
    expect(schema.properties.input.type).toBe('object');
    expect(schema.properties.input.additionalProperties).toBe(true);
    expect(Object.keys(schema.properties.input.properties ?? {})).toEqual([]);
  });

  test('plugins.webTicket requires a registered projectDir, sessionID optional', () => {
    const body = bodyOf('plugins.webTicket');
    expect(body.required).toBe(true);
    const schema = body.content['application/json'].schema;
    expect(schema.required).toEqual(['projectDir']);
    expect(schema.properties.sessionID.minLength).toBe(1);
  });

  test('plugins.install is excluded: raw byte upload, no JSON request schema', () => {
    // Spec §1.3: binary/multipart inputs are not modeled; the op must not
    // pretend to have a JSON body (that would inflate `requests`).
    const withBody: string[] = [];
    for (const methods of Object.values<any>(contract.paths)) {
      for (const [method, op] of Object.entries<any>(methods)) {
        if (method === 'get' || !op?.operationId) continue;
        if (op.requestBody) withBody.push(op.operationId);
      }
    }
    expect(withBody).not.toContain('plugins.install');
  });

  test('runtime.switch/dryEvent/config.update boundaries and conformance options', () => {
    const sw = bodyOf('runtime.switch');
    expect(sw.required).toBe(true);
    expect(sw.content['application/json'].schema.required).toBeUndefined();
    expect(sw.content['application/json'].schema.properties.plugin.type).toBe('string');

    const dry = bodyOf('runtime.dryEvent');
    expect(dry.required).toBe(true);
    const drySchema = dry.content['application/json'].schema;
    expect(drySchema.additionalProperties).toBe(true);
    expect(drySchema.properties.event.additionalProperties).toBe(true);
    expect(Object.keys(drySchema.properties.event.properties ?? {})).toEqual([]);

    const update = bodyOf('runtime.config.update');
    expect(update.required).toBe(true);
    const updateSchema = update.content['application/json'].schema;
    expect(updateSchema.additionalProperties).toBe(true);
    expect(Object.keys(updateSchema.properties ?? {})).toEqual([]);

    const conformance = bodyOf('runtime.conformance');
    expect(conformance.required).toBe(false);
    const conformanceSchema = conformance.content['application/json'].schema;
    expect(conformanceSchema.properties.scenarios.items.type).toBe('string');
    expect(conformanceSchema.properties.timeoutMs.type).toBe('number');
  });

  test('runtime restart/reload ignore the body', () => {
    for (const id of ['runtime.restartAgent', 'runtime.reload']) {
      const body = bodyOf(id);
      expect(`${id}:${body.required}`).toBe(`${id}:false`);
      expect(Object.keys(body.content['application/json'].schema.properties ?? {})).toEqual([]);
    }
  });

  test('config.set declares known top-level sections and stays open for unknown keys', () => {
    const body = bodyOf('config.set');
    expect(body.required).toBe(true);
    const schema = body.content['application/json'].schema;
    expect(schema.additionalProperties).toBe(true);
    expect(Object.keys(schema.properties)).toEqual(expect.arrayContaining([
      'server', 'paths', 'timeouts', 'memory', 'llm', 'media', 'events', 'runtime', 'resources', 'env',
    ]));
    // No section is mandatory: omitted keys fall back to config defaults.
    expect(schema.required).toBeUndefined();
  });

  test('project.setCurrent / manager.rotate / mafwCommands.run anchor their required fields', () => {
    const register = bodyOf('project.setCurrent');
    expect(register.required).toBe(true);
    const registerSchema = register.content['application/json'].schema;
    expect(registerSchema.required).toEqual(['projectDir', 'mafwDir']);
    expect(registerSchema.properties.setCurrent.type).toBe('boolean');
    expect(registerSchema.required).not.toContain('setCurrent');

    expect(schemaOf('manager.rotate').required).toEqual(['projectDir']);

    const run = bodyOf('mafwCommands.run');
    expect(run.required).toBe(true);
    const runSchema = run.content['application/json'].schema;
    expect(runSchema.required).toEqual(['command']);
    expect(runSchema.properties.command.minLength).toBe(1);
    expect(Object.keys(runSchema.properties).sort()).toEqual(['args', 'command', 'sessionID']);
  });
});

describe('api-contract: E10g request bodies (W7 memory, media, tts, chat, python, mobile, a2a)', () => {
  function bodyOf(operationId: string): any {
    for (const methods of Object.values<any>(contract.paths)) {
      for (const op of Object.values<any>(methods)) {
        if (op?.operationId === operationId) {
          expect(`${operationId}:requestBody`).toBe(`${operationId}:${op.requestBody ? 'requestBody' : 'missing'}`);
          return op.requestBody;
        }
      }
    }
    throw new Error(`operation not found: ${operationId}`);
  }

  function schemaOf(operationId: string): any {
    return bodyOf(operationId).content['application/json'].schema;
  }

  test('memory.add requires content and pins the memoryType/authority vocabularies', () => {
    const body = bodyOf('memory.add');
    expect(body.required).toBe(true);
    const schema = body.content['application/json'].schema;
    expect(schema.required).toEqual(['content']);
    expect(schema.properties.memoryType.anyOf.map((v: any) => v.const))
      .toEqual(['episodic', 'semantic', 'procedural', 'global']);
    expect(schema.properties.authority.anyOf.map((v: any) => v.const))
      .toEqual(['user', 'agent', 'tool', 'pipeline']);
    // Sticky/pin flags are optional: absent → plain note-board-free write.
    expect(schema.properties.pinned.type).toBe('boolean');
    expect(schema.properties.sticky.type).toBe('boolean');
    // Anchors are capped by the write pipeline (first 8 / first 20), never rejected:
    // a maxItems here would advertise a 400 the handler never sends.
    expect(schema.properties.cueAnchors.maxItems).toBeUndefined();
    expect(schema.properties.sourceTraceIds.maxItems).toBeUndefined();
    expect(schema.properties.cueAnchors.description).toContain('first 8');
    expect(schema.properties.sourceTraceIds.description).toContain('first 20');
  });

  test('memory.setSticky / memory.merge: id/sourceWorktree anchors, mode flags optional', () => {
    const sticky = schemaOf('memory.setSticky');
    expect(sticky.required).toEqual(['id']);
    expect(sticky.properties.sticky.description).toContain('note-board');
    expect(sticky.properties.pinned.description).toContain('sticky is absent');

    const merge = bodyOf('memory.merge');
    expect(merge.required).toBe(true);
    expect(merge.content['application/json'].schema.required).toEqual(['sourceWorktree']);
    // Unknown strategies degrade to manual in the handler, so the contract stays open.
    expect(merge.content['application/json'].schema.properties.strategy.type).toBe('string');
  });

  test('embedding.update closes provider/engine/gpu and the llama.cpp bounds', () => {
    const body = bodyOf('embedding.update');
    expect(body.required).toBe(true);
    const schema = body.content['application/json'].schema;
    expect(schema.required).toBeUndefined();
    expect(schema.properties.provider.anyOf.map((v: any) => v.const))
      .toEqual(['off', 'local', 'dashscope']);
    expect(schema.properties.engine.anyOf.map((v: any) => v.const)).toEqual(['onnx', 'llamacpp']);
    expect(schema.properties.threads.minimum).toBe(1);
    expect(schema.properties.threads.maximum).toBe(32);
    expect(schema.properties.llamacpp.properties.gpu.anyOf.map((v: any) => v.const))
      .toEqual(['cpu', 'vulkan', 'cuda']);
    expect(schema.properties.llamacpp.properties.contextSize.minimum).toBe(256);
    // baseUrl is rejected by the handler (SSRF/key sink) → never declared.
    expect(schema.properties.baseUrl).toBeUndefined();
  });

  test('media.switch / createTaskApi / analyzeAudio anchor their required fields', () => {
    const sw = bodyOf('media.switch');
    expect(sw.required).toBe(true);
    const swSchema = sw.content['application/json'].schema;
    expect(swSchema.required).toBeUndefined();
    expect(Object.keys(swSchema.properties).sort()).toEqual(['audio', 'engine', 'image', 'video']);

    expect(schemaOf('media.createTaskApi').required).toEqual(['artifactId']);
    const audio = schemaOf('media.analyzeAudio');
    expect(audio.required).toEqual(['dataUrl']);
    expect(audio.properties.mediaType.description).toContain('audio/wav');
  });

  test('tts.speak / speakStream / interrupt: text and sessionId anchors', () => {
    for (const id of ['tts.speak', 'tts.speakStream']) {
      const schema = schemaOf(id);
      expect(`${id}:${JSON.stringify(schema.required)}`).toBe(`${id}:["text"]`);
      expect(schema.properties.voice.type).toBe('string');
      expect(schema.properties.style.type).toBe('string');
    }
    // Streaming tracks the in-flight set per session; speak does not need one.
    expect(schemaOf('tts.speakStream').properties.sessionId).toBeDefined();
    expect(schemaOf('tts.speak').properties.sessionId).toBeUndefined();
    expect(schemaOf('tts.interrupt').required).toEqual(['sessionId']);
  });

  test('chat bodies: message anchor on send, message|parts on enriched', () => {
    expect(schemaOf('chat.send').required).toEqual(['message']);

    const enriched = bodyOf('chat.sendEnriched');
    expect(enriched.required).toBe(true);
    const schema = enriched.content['application/json'].schema;
    expect(schema.required).toBeUndefined();
    expect(schema.description).toContain('message or parts');
    expect(schema.properties.parts.items.required).toEqual(['type']);
    expect(schema.properties.parts.items.additionalProperties).toBe(true);
    expect(schema.properties.model.required).toEqual(['providerID', 'modelID']);
  });

  test('python and obs bodies pin their required anchors and source enum', () => {
    expect(schemaOf('python.execute').required).toEqual(['sessionID', 'code']);
    expect(schemaOf('python.restart').required).toEqual(['sessionID']);

    const obs = bodyOf('obs.capture');
    expect(obs.required).toBe(true);
    const obsSchema = obs.content['application/json'].schema;
    expect(obsSchema.required).toEqual(['sessionID', 'source']);
    expect(obsSchema.properties.source.anyOf.map((v: any) => v.const))
      .toEqual(['user_input', 'assistant_reply', 'tool_result', 'reasoning']);
    // Empty content is a valid deduped capture, not a 400.
    expect(obsSchema.required).not.toContain('content');
    expect(obsSchema.description).toContain('fail-open');
  });

  test('models.update: flat recall pair, goal overrides and per-modality media refs', () => {
    const body = bodyOf('models.update');
    expect(body.required).toBe(true);
    const schema = body.content['application/json'].schema;
    expect(schema.required).toBeUndefined();
    expect(Object.keys(schema.properties).sort()).toEqual(['goal', 'media', 'recall']);
    expect(schema.properties.recall.required).toEqual(['providerID', 'modelID']);
    expect(schema.properties.goal.properties.techLeadModel).toBeDefined();
    expect(Object.keys(schema.properties.media.properties).sort())
      .toEqual(['audio', 'image', 'model', 'provider', 'video']);
  });

  test('tools.execute keeps params as a tool-defined open boundary', () => {
    const body = bodyOf('tools.execute');
    expect(body.required).toBe(true);
    const schema = body.content['application/json'].schema;
    expect(schema.required).toEqual(['name']);
    expect(schema.properties.params.type).toBe('object');
    expect(schema.properties.params.additionalProperties).toBe(true);
    expect(Object.keys(schema.properties.params.properties ?? {})).toEqual([]);
  });

  test('eval.chatCompletions / llm.compress: OpenAI envelope and observations array', () => {
    const evalBody = bodyOf('eval.chatCompletions');
    expect(evalBody.required).toBe(true);
    const evalSchema = evalBody.content['application/json'].schema;
    expect(evalSchema.required).toEqual(['messages']);
    expect(evalSchema.properties.messages.items.required).toEqual(['role']);
    // Message content is either text or EvalScope media parts (open part boundary).
    expect(evalSchema.properties.messages.items.properties.content.anyOf[0].type).toBe('string');
    expect(evalSchema.additionalProperties).toBe(true);

    const compress = schemaOf('llm.compress');
    expect(compress.required).toEqual(['observations']);
    expect(compress.properties.observations.items.type).toBe('string');
  });

  test('mobile/devices registration and pairing pin the credential anchors', () => {
    expect(schemaOf('mobile.mediaTaskAsk').required).toEqual(['question']);

    const mobileRegister = schemaOf('mobile.devicesRegister');
    expect(mobileRegister.required).toEqual(['token', 'platform']);
    expect(mobileRegister.properties.token.description).toContain('FCM');

    const verify = schemaOf('mobile.pairingVerify');
    expect(verify.required).toEqual(['nonce']);
    expect(verify.properties.deviceId.pattern).toBe('^[A-Za-z0-9._:-]+$');
    expect(verify.properties.deviceId.maxLength).toBe(128);
    expect(verify.properties.rotate.type).toBe('boolean');

    const legacy = schemaOf('devices.register');
    expect(legacy.required).toEqual(['fcmToken', 'platform', 'token']);
    // id can come from the transport principal instead of the body.
    expect(legacy.required).not.toContain('id');
    expect(legacy.properties.id.description).toContain('principal');
  });

  test('W7 body-ignored actions project to required:false with an empty object', () => {
    for (const id of [
      'memory.delete',
      'memory.embeddingsBackfill',
      'media.pluginsReload',
      'devices.delete',
      'mobile.devicesDelete',
      'humanToken.rotate',
    ]) {
      const body = bodyOf(id);
      expect(`${id}:${body.required}`).toBe(`${id}:false`);
      expect(Object.keys(body.content['application/json'].schema.properties ?? {})).toEqual([]);
    }
  });

  test('skills.deopt keeps an optional body (default reason) with a declared field', () => {
    const body = bodyOf('skills.deopt');
    expect(body.required).toBe(false);
    const schema = body.content['application/json'].schema;
    expect(Object.keys(schema.properties)).toEqual(['reason']);
    expect(schema.properties.reason.description).toContain('manual');
  });
});

describe('api-contract: E10g request bodies (W8 cognition gate / rewrite)', () => {
  function bodyOf(operationId: string): any {
    for (const methods of Object.values<any>(contract.paths)) {
      for (const op of Object.values<any>(methods)) {
        if (op?.operationId === operationId) {
          expect(`${operationId}:requestBody`).toBe(`${operationId}:${op.requestBody ? 'requestBody' : 'missing'}`);
          return op.requestBody;
        }
      }
    }
    throw new Error(`operation not found: ${operationId}`);
  }

  function schemaOf(operationId: string): any {
    return bodyOf(operationId).content['application/json'].schema;
  }

  test('cognition.gate: sessionID+kind required, kind closed enum, tool conditional', () => {
    const body = bodyOf('cognition.gate');
    expect(body.required).toBe(true);
    const schema = body.content['application/json'].schema;
    expect(schema.required).toEqual(['sessionID', 'kind']);
    expect(schema.properties.kind.anyOf.map((v: any) => v.const)).toEqual(['tool_call', 'prompt']);
    // tool is needed only on the tool_call branch; the handler 400s there, but a
    // prompt gate must stay valid without it → optional + description, no oneOf.
    expect(schema.required).not.toContain('tool');
    expect(schema.properties.tool.type).toBe('string');
    expect(schema.properties.tool.description).toContain("kind is 'tool_call'");
    expect(schema.properties.input.type).toBe('object');
    expect(schema.properties.text.type).toBe('string');
    expect(schema.description).toContain('conditionally required');
  });

  test('cognition.rewrite: sessionID+tool+output required, output.content is the anchor', () => {
    const body = bodyOf('cognition.rewrite');
    expect(body.required).toBe(true);
    const schema = body.content['application/json'].schema;
    expect(schema.required).toEqual(['sessionID', 'tool', 'output']);
    expect(schema.properties.output.required).toEqual(['content']);
    const content = schema.properties.output.properties.content;
    expect(content.type).toBe('array');
    // An empty array is a valid 200 ({content: []}), so no minItems.
    expect(content.minItems).toBeUndefined();
    // Runtime content parts: pin `type`, leave the rest open.
    expect(content.items.required).toEqual(['type']);
    expect(content.items.additionalProperties).toBe(true);
    expect(schema.properties.output.required).not.toContain('isError');
    expect(schema.properties.output.properties.isError.type).toBe('boolean');
    // `input` is a host-envelope field the current handler ignores → declared
    // optional (contract-cognition lists it, the handler does not read it).
    expect(schema.required).not.toContain('input');
    expect(schema.properties.input.type).toBe('object');
  });

  test('W8 closes the request ledger: cognition ops are covered, exclusions unchanged', () => {
    const withBody: string[] = [];
    for (const methods of Object.values<any>(contract.paths)) {
      for (const [method, op] of Object.entries<any>(methods)) {
        if (method === 'get' || !op?.operationId) continue;
        if (op.requestBody) withBody.push(op.operationId);
      }
    }
    expect(withBody).toHaveLength(189);
    expect(withBody).toEqual(expect.arrayContaining(['cognition.gate', 'cognition.rewrite']));
    for (const id of [
      'plugins.install',
      'media.upload',
      'media.uploadAndCreate',
      'media.createTask',
      'mobile.mediaTaskUpload',
      'pods.a2a',
    ]) {
      expect(`${id}:${withBody.includes(id)}`).toBe(`${id}:false`);
    }
  });
});

describe('api-contract: Phase 6 plugin recovery routes (E10g-fix)', () => {
  function opOf(operationId: string): any {
    for (const methods of Object.values<any>(contract.paths)) {
      for (const op of Object.values<any>(methods)) {
        if (op?.operationId === operationId) return op;
      }
    }
    throw new Error(`operation not found: ${operationId}`);
  }

  function schemaOf(operationId: string): any {
    const body = opOf(operationId).requestBody;
    expect(`${operationId}:requestBody`).toBe(`${operationId}:${body ? 'requestBody' : 'missing'}`);
    return body.content['application/json'].schema;
  }

  test('quarantine requires a reason; the other six POSTs take no body', () => {
    const quarantine = schemaOf('plugins.quarantine');
    expect(quarantine.required).toEqual(['reason']);
    expect(quarantine.properties.reason.type).toBe('string');
    expect(quarantine.properties.reason.minLength).toBe(1);

    // Handlers read only the path (`:name`) and the principal headers
    // (`principalOf` / `assertHuman`), so there is no body field to declare.
    for (const id of [
      'plugins.doctorAll',
      'plugins.doctor',
      'plugins.kill',
      'plugins.resume',
      'plugins.unquarantine',
      'plugins.rollback',
    ]) {
      const body = opOf(id).requestBody;
      expect(`${id}:${body.required}`).toBe(`${id}:false`);
      expect(`${id}:${JSON.stringify(Object.keys(body.content['application/json'].schema.properties ?? {}))}`)
        .toBe(`${id}:[]`);
    }
    // Human-only actions must never advertise an actor field in the body.
    expect(schemaOf('plugins.kill').additionalProperties).toBeUndefined();
  });

  test('plugins.audit / plugins.lastGood responses match the handler payloads', () => {
    expect(Value.Check(PluginsAuditResponse, {
      events: [{
        id: 'pa_1',
        at: '2026-11-14T00:00:00.000Z',
        action: 'quarantine',
        package: 'demo',
        version: '1.0.0',
        fingerprint: 'abc',
        principalKind: 'human',
        principalMethod: 'device',
        result: 'ok',
        detail: { reason: 'boom' },
      }],
    })).toBe(true);
    // An empty audit table is a valid 200.
    expect(Value.Check(PluginsAuditResponse, { events: [] })).toBe(true);
    // `action` is the closed PluginAuditAction enum: a typo is not an audit event.
    expect(Value.Check(PluginsAuditResponse, {
      events: [{ id: 'pa_1', at: 'x', action: 'nope', result: 'ok' }],
    })).toBe(false);

    expect(Value.Check(PluginLastGoodResponse, {
      name: 'demo',
      lastGood: { version: '1.0.0', fingerprint: 'abc', savedAt: '2026-11-14T00:00:00.000Z' },
    })).toBe(true);
    // Legacy single-file packages have no manifest version.
    expect(Value.Check(PluginLastGoodResponse, {
      name: 'demo',
      lastGood: { fingerprint: 'abc', savedAt: '2026-11-14T00:00:00.000Z' },
    })).toBe(true);
    // fingerprint is the store's only hard requirement.
    expect(Value.Check(PluginLastGoodResponse, {
      name: 'demo',
      lastGood: { savedAt: 'x' },
    })).toBe(false);
  });
});

describe('api-contract: E10h write responses (P0 pilots)', () => {
  const findOp = (operationId: string): any => {
    for (const methods of Object.values<any>(contract.paths)) {
      for (const candidate of Object.values<any>(methods)) {
        if (candidate?.operationId === operationId) return candidate;
      }
    }
    return null;
  };

  const schemaOf = (operationId: string): any => {
    const op = findOp(operationId);
    expect(`${operationId}:found`).toBe(`${operationId}:${op ? 'found' : 'missing'}`);
    expect(`${operationId}:200`).toBe(
      `${operationId}:${op.responses?.['200']?.content?.['application/json']?.schema ? '200' : 'missing'}`,
    );
    return op.responses['200'].content['application/json'].schema;
  };

  test('session.create declares the created session + optional worktree envelope', () => {
    const schema = schemaOf('session.create');
    // Handler (routes/session-create.ts) spreads the created session record and
    // appends `worktree`; the session half is the same DTO as session.get.
    expect(schema.required).toEqual(['id', 'projectID', 'directory', 'title', 'time']);
    for (const field of ['id', 'projectID', 'directory', 'title', 'time', 'parentID', 'model', 'agent']) {
      expect(`${field}:${Boolean(schema.properties[field])}`).toBe(`${field}:true`);
    }
    // `worktree` is absent (not null) on a plain session: JSON.stringify drops it.
    expect(schema.required).not.toContain('worktree');
    expect(schema.properties.worktree.required).toEqual(['dir', 'branch']);
    expect(schema.properties.worktree.properties.dir.type).toBe('string');
    // A closed object: only the declared session view + worktree, no runtime extras.
    expect(schema.additionalProperties).toBeUndefined();
  });

  test('tasks.submit returns the public task entity (exact tasks.get reuse)', () => {
    const schema = schemaOf('tasks.submit');
    // TaskService.submit returns publicTask(task), the same wire as tasks.get.
    expect(schema).toEqual(schemaOf('tasks.get'));
    expect(schema.properties.status.anyOf.map((v: any) => v.const))
      .toEqual(['working', 'input_required', 'completed', 'failed', 'cancelled']);
    // No response envelope: the task is the body (SDK tasks.submit() returns TaskEntity).
    expect(Object.keys(schema.properties)).not.toContain('task');
  });

  test('pilots validate handler-shaped payloads and reject missing anchors', () => {
    expect(Value.Check(SessionCreateResponse, {
      id: 'ses_1',
      projectID: 'proj_1',
      directory: 'C:/work/demo',
      title: 'New session',
      time: { created: 1, updated: 2 },
      worktree: { dir: 'C:/work/demo/.worktrees/wt-1', branch: 'mafw/wt-1' },
    })).toBe(true);
    // Plain create: no worktree key at all.
    expect(Value.Check(SessionCreateResponse, {
      id: 'ses_1',
      projectID: 'proj_1',
      directory: 'C:/work/demo',
      title: 'New session',
      time: { created: 1, updated: 2 },
    })).toBe(true);
    // A worktree without a branch is not a worktree ref.
    expect(Value.Check(SessionCreateResponse, {
      id: 'ses_1',
      projectID: 'proj_1',
      directory: 'C:/work/demo',
      title: 'New session',
      time: { created: 1, updated: 2 },
      worktree: { dir: 'x' },
    })).toBe(false);
    // The session id is load-bearing for every follow-up call.
    expect(Value.Check(SessionCreateResponse, {
      projectID: 'proj_1',
      directory: 'C:/work/demo',
      title: 'New session',
      time: { created: 1, updated: 2 },
    })).toBe(false);

    expect(Value.Check(TaskSubmitResponse, {
      id: 'task_1',
      kind: 'shell',
      parentSessionID: 'ses_1',
      title: 'npm test',
      status: 'working',
      createdAt: 1,
      updatedAt: 1,
    })).toBe(true);
    // A task without a status is not a task the poller can follow.
    expect(Value.Check(TaskSubmitResponse, {
      id: 'task_1',
      kind: 'shell',
      parentSessionID: 'ses_1',
      title: 'npm test',
      createdAt: 1,
      updatedAt: 1,
    })).toBe(false);
  });

  test('the write-response ledger counts only non-GET ops (humanToken.rotate + the 2 pilots)', () => {
    // Guards the denominator: a GET with a response must not inflate writeResponses.
    const writeOps = new Set<string>();
    for (const methods of Object.values<any>(contract.paths)) {
      for (const [method, op] of Object.entries<any>(methods)) {
        if (method !== 'get' && op?.operationId) writeOps.add(op.operationId);
      }
    }
    expect(writeOps.size).toBe(195);
    for (const id of ['session.create', 'tasks.submit', 'humanToken.rotate']) {
      expect(`${id}:${writeOps.has(id)}`).toBe(`${id}:true`);
      expect(schemaOf(id)).toBeDefined();
    }
  });
});

describe('api-contract: E10h-R1 session write responses', () => {
  const findOp = (operationId: string): any => {
    for (const methods of Object.values<any>(contract.paths)) {
      for (const candidate of Object.values<any>(methods)) {
        if (candidate?.operationId === operationId) return candidate;
      }
    }
    return null;
  };

  const schemaOf = (operationId: string): any => {
    const op = findOp(operationId);
    expect(`${operationId}:found`).toBe(`${operationId}:${op ? 'found' : 'missing'}`);
    const schema = op.responses?.['200']?.content?.['application/json']?.schema;
    expect(`${operationId}:200`).toBe(`${operationId}:${schema ? '200' : 'missing'}`);
    return schema;
  };

  test('session.config.set reuses the session.config state schema exactly', () => {
    // SessionConfigService.set() returns the same SessionConfigState as get().
    expect(schemaOf('session.config.set')).toEqual(schemaOf('session.config'));
    expect(schemaOf('session.config.set').additionalProperties).toBeUndefined();
  });

  test('checkpoint create returns the checkpoint body without list-only actions', () => {
    const schema = schemaOf('session.checkpoint');
    expect(schema.required).toEqual(['checkpoint']);
    expect(schema.properties.checkpoint.required).toEqual([
      'id', 'sessionID', 'projectDir', 'anchorMessageID', 'snapshotTree', 'untracked', 'kind', 'createdAt',
    ]);
    // `actions` is projected by the list route only (projectCheckpointActions).
    expect(schema.properties.checkpoint.properties.actions).toBeUndefined();
    // The list item is a strict superset: same eight fields + actions.
    const listItem = schemaOf('session.checkpoints').properties.checkpoints.items;
    expect(Object.keys(listItem.properties)).toEqual(
      [...Object.keys(schema.properties.checkpoint.properties), 'actions'],
    );
  });

  test('suspend / resume / discardRun return the same RunState as session.run', () => {
    const runBranch = schemaOf('session.run').properties.run.anyOf[0];
    expect(schemaOf('session.suspend')).toEqual({ type: 'object', required: ['run'], properties: { run: runBranch } });
    expect(schemaOf('session.discardRun')).toEqual({ type: 'object', required: ['run'], properties: { run: runBranch } });
    const resume = schemaOf('session.resume');
    expect(resume.required).toEqual(['run', 'prompted']);
    expect(resume.properties.run).toEqual(runBranch);
    // `prompted` is the literal true (resume re-sends the resume prompt).
    expect(resume.properties.prompted).toEqual({ const: true, type: 'boolean' });
  });

  test('prompt / promptAsync model the sync envelope and the queue short-circuit', () => {
    const prompt = schemaOf('session.prompt');
    expect(prompt.required).toEqual(['parts']);
    expect(prompt.properties.parts.items.properties.type).toEqual({ const: 'text', type: 'string' });
    // structured / structuredError only appear with outputSchema.
    expect(prompt.required).not.toContain('structured');

    const asyncSchema = schemaOf('session.promptAsync');
    // 200 has three branches: plain ack, queued ack, idempotent duplicate ack.
    expect(asyncSchema.anyOf).toHaveLength(3);
    expect(asyncSchema.anyOf[0]).toEqual({ type: 'object', required: ['status'], properties: { status: { const: 'ok', type: 'string' } } });
    expect(asyncSchema.anyOf[1].required).toEqual(['status', 'queued', 'itemId', 'position']);
    expect(asyncSchema.anyOf[2].required).toEqual(['status', 'queued', 'duplicate', 'itemId']);
  });

  test('queue clear/cancel and legacy delete declare their literal envelopes', () => {
    expect(schemaOf('session.queue.clear')).toEqual({
      type: 'object', required: ['cleared'], properties: { cleared: { type: 'number' } },
    });
    expect(schemaOf('session.queue.cancel')).toEqual({
      type: 'object', required: ['cancelled'], properties: { cancelled: { type: 'string' } },
    });
    expect(schemaOf('session.deleteLegacy')).toEqual({
      type: 'object', required: ['status'], properties: { status: { const: 'ok', type: 'string' } },
    });
  });

  test('usage plugins reload reuses the list schema; create/put/delete return the updated list', () => {
    // The reload handler delegates to handleUsagePluginsList: same wire, no {ok} envelope.
    expect(schemaOf('session.usagePluginsReload')).toEqual(schemaOf('session.usagePluginsList'));
    for (const id of ['session.usagePluginSourcePut', 'session.usagePluginsDelete']) {
      const schema = schemaOf(id);
      expect(`${id}:${schema.required.join(',')}`).toBe(`${id}:ok,plugins`);
    }
    // create additionally names the file it wrote.
    expect(schemaOf('session.usagePluginsCreate').required).toEqual(['ok', 'name', 'plugins']);
    expect(schemaOf('session.usagePluginsCreate').properties.name).toEqual({ type: 'string' });
  });

  test('subagent spawn returns the list item shape; command stays an open runtime boundary', () => {
    const listItem = schemaOf('session.subagents.list').properties.items.items;
    expect(schemaOf('session.subagents.spawn')).toEqual(listItem);
    // Gateway has no command handler; the runtime response shape is not ours to close.
    expect(schemaOf('session.command').additionalProperties).toBe(true);
    expect(Object.keys(schemaOf('session.command').properties ?? {})).toEqual([]);
  });

  test('representative write responses validate handler-shaped payloads', () => {
    const run = {
      id: 'run_1',
      sessionID: 'ses_1',
      projectDir: 'C:/work/demo',
      status: 'suspended',
      brief: { lastUserText: 'hi', lastAssistantTail: 'ok', anchorMessageID: 'msg_1', queuedCount: 0 },
      createdAt: '2026-11-15T00:00:00.000Z',
      suspendedAt: '2026-11-15T00:00:01.000Z',
    };
    expect(Value.Check(SessionSuspendResponse, { run })).toBe(true);
    // RunState without its brief is not a resumable run.
    expect(Value.Check(SessionSuspendResponse, { run: { ...run, brief: undefined } })).toBe(false);

    const checkpoint = {
      id: 'cp_1',
      sessionID: 'ses_1',
      projectDir: 'C:/work/demo',
      anchorMessageID: 'msg_1',
      snapshotTree: null,
      untracked: [],
      kind: 'manual',
      createdAt: '2026-11-15T00:00:00.000Z',
    };
    expect(Value.Check(SessionCheckpointResponse, { checkpoint })).toBe(true);
    expect(Value.Check(SessionCheckpointResponse, { checkpoint: { ...checkpoint, id: undefined } })).toBe(false);

    expect(Value.Check(SessionPromptResponse, {
      parts: [{ id: '', sessionID: 'ses_1', messageID: '', type: 'text', text: 'answer' }],
    })).toBe(true);
    expect(Value.Check(SessionPromptResponse, { structured: { ok: true } })).toBe(false);

    expect(Value.Check(SessionPromptAsyncResponse, { status: 'ok' })).toBe(true);
    expect(Value.Check(SessionPromptAsyncResponse, { status: 'ok', queued: true, itemId: 'q_1', position: 1 })).toBe(true);
    expect(Value.Check(SessionPromptAsyncResponse, {
      status: 'ok', queued: true, duplicate: true, itemId: 'q_1',
    })).toBe(true);

    expect(Value.Check(StructuredSubmitResponse, { ok: false, errors: ['bad'] })).toBe(true);
    expect(Value.Check(SessionQueueClearResponse, { cleared: 2 })).toBe(true);
    expect(Value.Check(SessionQueueCancelResponse, { cancelled: 'q_1' })).toBe(true);
    expect(Value.Check(SessionDeleteLegacyResponse, { status: 'ok' })).toBe(true);
    expect(Value.Check(SessionSubagentSpawnResponse, {
      id: 'sub_1', parentID: 'ses_1', depth: 1, status: 'running', createdAt: 1, updatedAt: 1,
    })).toBe(true);
    // The runtime owns the command body; any JSON object passes, a non-object does not.
    expect(Value.Check(SessionCommandResponse, { info: {}, parts: [] })).toBe(true);
    expect(Value.Check(SessionCommandResponse, null)).toBe(false);
  });

  test('the R1 batch keeps the write-response ledger at or above 38/195', () => {
    const writeOps = new Set<string>();
    const responded = new Set<string>();
    for (const methods of Object.values<any>(contract.paths)) {
      for (const [method, op] of Object.entries<any>(methods)) {
        if (method === 'get' || !op?.operationId) continue;
        writeOps.add(op.operationId);
        if (op.responses?.['200']?.content?.['application/json']?.schema) responded.add(op.operationId);
      }
    }
    expect(writeOps.size).toBe(195);
    // humanToken.rotate + session.create + tasks.submit + 35 R1 ops. Later batches
    // (R2+) only append, so this is a floor; the exact total is pinned per batch.
    expect(responded.size).toBeGreaterThanOrEqual(38);
    for (const id of [
      'session.config.set', 'structured.submit', 'session.checkpoint', 'session.prompt',
      'session.promptAsync', 'session.suspend', 'session.resume', 'session.discardRun',
      'session.usagePluginsReload', 'session.subagents.spawn', 'session.deleteLegacy',
    ]) {
      expect(`${id}:${responded.has(id)}`).toBe(`${id}:true`);
    }
  });
});

describe('api-contract: E10h-R2 pod/task/terminal/fileHistory write responses', () => {
  const findOp = (operationId: string): any => {
    for (const methods of Object.values<any>(contract.paths)) {
      for (const candidate of Object.values<any>(methods)) {
        if (candidate?.operationId === operationId) return candidate;
      }
    }
    return null;
  };

  const schemaOf = (operationId: string): any => {
    const op = findOp(operationId);
    expect(`${operationId}:found`).toBe(`${operationId}:${op ? 'found' : 'missing'}`);
    const schema = op.responses?.['200']?.content?.['application/json']?.schema;
    expect(`${operationId}:200`).toBe(`${operationId}:${schema ? '200' : 'missing'}`);
    return schema;
  };

  test('pod lifecycle writes return the pods.get body (no envelope)', () => {
    const detail = schemaOf('pods.get');
    for (const id of ['pods.create', 'pods.update', 'pods.wake', 'pods.sleep']) {
      // Same wire: `enrichPodDetail()` runs on every one of them; a non-lead caller
      // only gets `sessions: []`, never a different field set.
      expect(`${id}:${JSON.stringify(schemaOf(id)) === JSON.stringify(detail)}`).toBe(`${id}:true`);
    }
    expect(detail.required).toEqual([
      'pod', 'members', 'goals', 'attention', 'messageHealth', 'tasks', 'sessions',
    ]);
  });

  test('pods.lead.ensure keeps the service lower-case sessionId', () => {
    const schema = schemaOf('pods.lead.ensure');
    // `PodService.ensureLead` returns `{podId, projectDir, sessionId}` — the `d` case
    // differs from every `pods.goals.*` payload, which use `sessionID`.
    expect(schema.required).toEqual(['podId', 'projectDir', 'sessionId']);
    expect(Object.keys(schema.properties)).toEqual(['podId', 'projectDir', 'sessionId']);
  });

  test('task writes: cancel returns the task entity, message returns {ok:true}', () => {
    expect(schemaOf('tasks.cancel')).toEqual(schemaOf('tasks.get'));
    expect(schemaOf('tasks.message')).toEqual({
      type: 'object',
      required: ['ok'],
      properties: { ok: { const: true, type: 'boolean' } },
    });
  });

  test('terminal writes pin protocol/id, the ticket view and the remove ack', () => {
    expect(schemaOf('terminal.create').required).toEqual(['protocol', 'id']);
    expect(schemaOf('terminal.create').properties.id).toEqual({ type: 'string' });
    // PTY-less runtimes are 503, never a 200 without a ticket.
    expect(schemaOf('terminal.connectTicket').required).toEqual(['protocol', 'ticket', 'url', 'expiresAt']);
    expect(schemaOf('terminal.remove').required).toEqual(['ok']);
  });

  test('background cancel returns the same neutral job row as the list item', () => {
    const item = schemaOf('background.jobs.list').properties.items.items;
    expect(schemaOf('background.jobs.cancel')).toEqual(item);
  });

  test('fileHistory snapshot/restore model the service results exactly', () => {
    const snapshot = schemaOf('fileHistory.snapshot');
    expect(snapshot.required).toEqual(['entries', 'skipped']);
    expect(snapshot.properties.skipped.items.required).toEqual(['rel', 'reason']);
    expect(snapshot.properties.skipped.items.properties.reason.anyOf.map((v: any) => v.const)).toEqual([
      'unsafe-path', 'missing', 'not-file', 'too-large', 'io',
    ]);
    // The entry skeleton is the list item (same persisted row).
    expect(snapshot.properties.entries.items).toEqual(schemaOf('fileHistory.list').properties.entries.items);
    // 200 only exists for a successful restore; failures are 404/409 with `{ok:false}`.
    expect(schemaOf('fileHistory.restore').required).toEqual(['ok', 'rel']);
    expect(schemaOf('fileHistory.restore').properties.ok).toEqual({ const: true, type: 'boolean' });
  });

  test('pod tasks / messages / review items reuse their list DTOs', () => {
    const taskItem = schemaOf('pods.tasks.list').properties.items.items;
    for (const id of ['pods.tasks.create', 'pods.tasks.update']) {
      expect(`${id}:${JSON.stringify(schemaOf(id).properties.task) === JSON.stringify(taskItem)}`).toBe(`${id}:true`);
    }
    expect(schemaOf('pods.tasks.delete').properties.deleted.required).toEqual(['goalId', 'externalTaskId']);

    const messageItem = schemaOf('pods.messages.list').properties.items.items;
    expect(schemaOf('pods.messages.read')).toEqual({
      type: 'object', required: ['message'], properties: { message: messageItem },
    });
    expect(schemaOf('pods.messages.create').required).toEqual(['message']);
    // notify:true adds `delivery`; the skipped branch is mapped to `disabled`.
    expect(schemaOf('pods.messages.create').properties.delivery.anyOf.map((v: any) => v.const))
      .toEqual(['delivered', 'pending', 'disabled']);
    // retry re-emits `deliver()` verbatim — `skipped` is part of the wire.
    expect(schemaOf('pods.messages.delivery.retry').properties.delivery.anyOf.map((v: any) => v.const))
      .toEqual(['delivered', 'pending', 'skipped']);
    expect(schemaOf('pods.messages.delivery.dismiss').required).toEqual(['dismissed']);

    const reviewItem = schemaOf('pods.goals.reviewItems').properties.items.items;
    expect(schemaOf('pods.goals.reviewItems.create')).toEqual({
      type: 'object', required: ['items'], properties: { items: { type: 'array', items: reviewItem } },
    });
    for (const id of ['pods.goals.reviewItems.resolve', 'pods.goals.reviewItems.reopen']) {
      expect(schemaOf(id)).toEqual({ type: 'object', required: ['item'], properties: { item: reviewItem } });
    }
  });

  test('pods.goals.cancel returns the Goal row, not the Goal view', () => {
    const goal = schemaOf('pods.goals.cancel').properties.goal;
    expect(goal.required).toEqual([
      'id', 'podId', 'goalId', 'status', 'verdict', 'activeRevision', 'priority', 'enqueuedAt', 'startedAt', 'endedAt',
    ]);
    // `cancelQueued()` returns `PodGoalRow`: the view-only projections are absent.
    for (const viewOnly of ['title', 'phase', 'stage', 'resultReady', 'bucket']) {
      expect(`${viewOnly}:${goal.properties[viewOnly] === undefined}`).toBe(`${viewOnly}:true`);
    }
    // … and the row is not the list item (docs the SDK `{goal: PodGoal}` mismatch).
    expect(JSON.stringify(goal)).not.toBe(JSON.stringify(schemaOf('pods.goals').properties.items.items));
  });

  test('goal create vs handoff: shared four keys, Tech Lead branch adds the rest', () => {
    const create = schemaOf('pods.goals.create');
    // Both branches (Tech Lead discussion / legacy intake) always send these four.
    expect(create.required).toEqual(['goalId', 'status', 'queueReason', 'goal']);
    expect(create.properties.status.anyOf.map((v: any) => v.const)).toEqual(['started', 'queued', 'discussing']);
    // `podId` only exists on the Tech Lead branch → declared, never required.
    expect(create.properties.podId.type).toBe('string');
    expect(create.required).not.toContain('podId');

    const handoff = schemaOf('pods.goals.handoff');
    expect(handoff.required).toEqual([
      'podId', 'goalId', 'status', 'revision', 'stage', 'queueReason', 'sessionID', 'goal',
    ]);
    // `createGoal` never queues: the handoff Goal is always revision 1 discussing.
    expect(handoff.properties.status).toEqual({ const: 'discussing', type: 'string' });
    expect(handoff.properties.queueReason).toEqual({ type: 'null' });
    // Session provisioning can fail without failing the Goal (nullable sessionID).
    expect(handoff.properties.sessionID.anyOf.map((v: any) => v.type)).toEqual(['string', 'null']);
  });

  test('direction / tech lead / probes / accept / reject carry the collaboration DTOs', () => {
    const direction = schemaOf('pods.goals.direction');
    expect(direction.required).toEqual([
      'podId', 'goalId', 'revision', 'revisionStatus', 'directionStatus', 'state', 'decision',
      'artifactPath', 'planningStarted',
    ]);
    // needs_user never starts planning; decided/clear append an error instead of rolling back.
    expect(direction.required).not.toContain('planningError');
    expect(direction.properties.state.required).toEqual([
      'version', 'goalId', 'revision', 'status', 'options', 'requests', 'decisions', 'updatedAt',
    ]);

    expect(schemaOf('pods.goals.techLead.messages').required).toEqual(['goalId', 'revision', 'sessionID', 'text']);

    // Probes create returns the same `{items}` payload as the GET list.
    expect(schemaOf('pods.goals.probes.create')).toEqual(schemaOf('pods.goals.probes'));

    const accept = schemaOf('pods.goals.accept');
    expect(accept.required).toEqual(['podId', 'goalId', 'revision', 'branch', 'mergeCommit', 'mergedAt']);
    expect(accept.required).not.toContain('forced');

    const reject = schemaOf('pods.goals.reject');
    expect(reject.required).toEqual([
      'podId', 'goalId', 'revision', 'status', 'priority', 'feedback', 'archivedState', 'previous', 'sessionID',
    ]);
    expect(reject.properties.previous.required).toEqual(['revision', 'closed', 'alreadyTerminal', 'missing']);
  });

  test('pod.events seen/seenAll and pods.a2a stay honest about their bodies', () => {
    expect(schemaOf('pod.events.seen').required).toEqual(['ok', 'changed']);
    expect(schemaOf('pod.events.seen').properties.changed).toEqual({ type: 'boolean' });
    expect(schemaOf('pod.events.seenAll').properties.changed).toEqual({ type: 'number' });

    // A2A JSON-RPC envelope: covered (JSON 200), but the field set is protocol-owned.
    const a2a = schemaOf('pods.a2a');
    expect(a2a.additionalProperties).toBe(true);
    expect(Object.keys(a2a.properties ?? {})).toEqual([]);
  });

  test('representative R2 write responses validate handler-shaped payloads', () => {
    expect(Value.Check(PodEventSeenResponse, { ok: true, changed: false })).toBe(true);
    expect(Value.Check(PodEventSeenAllResponse, { ok: true, changed: 3 })).toBe(true);
    expect(Value.Check(PodEventSeenAllResponse, { ok: true, changed: true })).toBe(false);
    expect(Value.Check(TaskMessageResponse, { ok: true })).toBe(true);
    expect(Value.Check(TaskMessageResponse, { ok: false })).toBe(false);

    expect(Value.Check(TerminalCreateResponse, { protocol: 'mafw-terminal/1', id: 'term_1' })).toBe(true);
    expect(Value.Check(TerminalConnectTicketResponse, {
      protocol: 'mafw-terminal/1', ticket: 't', url: '/api/ws/terminal/term_1?ticket=t', expiresAt: 1,
    })).toBe(true);
    expect(Value.Check(TerminalConnectTicketResponse, { protocol: 'mafw-terminal/1', id: 'term_1' })).toBe(false);
    expect(Value.Check(TerminalRemoveResponse, { ok: true })).toBe(true);

    expect(Value.Check(PodTaskDeleteResponse, { deleted: { goalId: null, externalTaskId: 'ext_1' } })).toBe(true);
    expect(Value.Check(PodTaskDeleteResponse, { deleted: null })).toBe(false);

    // The cancel row keeps the row counter but has no view projection.
    const row = {
      id: 'pg_1', podId: 'pod_1', goalId: 'goal_1', status: 'aborted', verdict: null,
      activeRevision: 1, priority: 0, enqueuedAt: '2026-11-15T00:00:00.000Z',
      startedAt: null, endedAt: '2026-11-15T00:00:01.000Z',
    };
    expect(Value.Check(PodGoalCancelResponse, { goal: row })).toBe(true);
    // A view-shaped goal has no `activeRevision`: this endpoint returns the row.
    expect(Value.Check(PodGoalCancelResponse, { goal: { ...row, activeRevision: undefined } })).toBe(false);

    expect(Value.Check(PodLeadEnsureResponse, { podId: 'pod_1', projectDir: '/w', sessionId: 'ses_1' })).toBe(true);
    expect(Value.Check(PodLeadEnsureResponse, { podId: 'pod_1', projectDir: '/w', sessionID: 'ses_1' })).toBe(false);

    expect(Value.Check(PodMessageDeliveryDismissResponse, { dismissed: true })).toBe(true);
    expect(Value.Check(PodMessageDeliveryRetryResponse, { delivery: 'skipped' })).toBe(true);
    expect(Value.Check(PodMessageDeliveryRetryResponse, { delivery: 'disabled' })).toBe(false);
    expect(Value.Check(PodMemoryWriteResponse, { path: '/w/.mafw/POD.md' })).toBe(true);

    expect(Value.Check(PodTechLeadMessageResponse, {
      goalId: 'goal_1', revision: 1, sessionID: 'ses_1', text: '[manifest]\nhello',
    })).toBe(true);
    expect(Value.Check(PodTechLeadMessageResponse, { goalId: 'goal_1', revision: 1, text: 'x' })).toBe(false);

    expect(Value.Check(PodGoalAcceptResponse, {
      podId: 'pod_1', goalId: 'goal_1', revision: 1, branch: 'mafw/goal-1', mergeCommit: 'abc', mergedAt: 'T',
    })).toBe(true);
    expect(Value.Check(PodGoalAcceptResponse, {
      podId: 'pod_1', goalId: 'goal_1', revision: 1, branch: 'b', mergeCommit: 'abc', mergedAt: 'T',
      forced: true, unresolvedReviewItemIds: ['ri_1'],
    })).toBe(true);

    const reject = {
      podId: 'pod_1', goalId: 'goal_1', revision: 2, status: 'discussing', priority: 10,
      feedback: 'redo', archivedState: null,
      previous: { revision: 1, closed: true, alreadyTerminal: false, missing: false },
      sessionID: null,
    };
    expect(Value.Check(PodGoalRejectResponse, reject)).toBe(true);
    expect(Value.Check(PodGoalRejectResponse, { ...reject, previous: { revision: 1 } })).toBe(false);

    // create/handoff share the four-key core; the intake branch has no Tech Lead extras.
    const goalView = {
      id: 'pg_1', podId: 'pod_1', goalId: 'goal_1', status: 'active', title: 'T', phase: null,
      verdict: null, stage: { owner: 'team', kind: 'working' }, resultReady: false,
      enqueuedAt: '2026-11-15T00:00:00.000Z', startedAt: null, endedAt: null,
    };
    expect(Value.Check(PodGoalCreateResponse, {
      goalId: 'goal_1', status: 'queued', queueReason: 'active_goal', goal: goalView,
    })).toBe(true);
    expect(Value.Check(PodGoalHandoffResponse, {
      podId: 'pod_1', goalId: 'goal_1', status: 'discussing', revision: 1, stage: 'discussing',
      queueReason: null, sessionID: 'ses_1', goal: goalView,
    })).toBe(true);
    expect(Value.Check(PodGoalHandoffResponse, {
      podId: 'pod_1', goalId: 'goal_1', status: 'discussing', revision: 1, stage: 'discussing',
      queueReason: 'paused', sessionID: 'ses_1', goal: goalView,
    })).toBe(false);

    expect(Value.Check(FileHistoryRestoreResponse, { ok: true, rel: 'docs/a.md' })).toBe(true);
    expect(Value.Check(FileHistoryRestoreResponse, { ok: false, reason: 'not-found' })).toBe(false);
    expect(Value.Check(FileHistorySnapshotResponse, {
      entries: [{
        id: 'fh_1', sessionID: 'ses_1', projectDir: '/w', rel: 'a.md', blob: 'sha',
        size: 3, mtimeMs: 1, createdAt: 'T', seq: 1, reason: 'manual',
      }],
      skipped: [{ rel: 'b.md', reason: 'too-large' }],
    })).toBe(true);
    expect(Value.Check(FileHistorySnapshotResponse, {
      entries: [], skipped: [{ rel: 'b.md', reason: 'nope' }],
    })).toBe(false);

    expect(Value.Check(BackgroundJobCancelResponse, {
      id: 'task_1', source: 'mafw-task', kind: 'shell', status: 'cancelled', sessionID: 'ses_1',
      taskID: 'task_1',
    })).toBe(true);

    // The A2A envelope is forwarded verbatim; any JSON object passes, null does not.
    expect(Value.Check(PodA2AResponse, { jsonrpc: '2.0', id: '1', result: { kind: 'task' } })).toBe(true);
    expect(Value.Check(PodA2AResponse, null)).toBe(false);
  });

  test('the R2 batch raises the write-response ledger to 73/195', () => {
    const writeOps = new Set<string>();
    const responded = new Set<string>();
    for (const methods of Object.values<any>(contract.paths)) {
      for (const [method, op] of Object.entries<any>(methods)) {
        if (method === 'get' || !op?.operationId) continue;
        writeOps.add(op.operationId);
        if (op.responses?.['200']?.content?.['application/json']?.schema) responded.add(op.operationId);
      }
    }
    expect(writeOps.size).toBe(195);
    // humanToken.rotate + session.create + tasks.submit + 35 R1 + 35 R2.
    expect(responded.size).toBe(73);
    for (const id of [
      'pods.a2a', 'pods.create', 'pods.goals.accept', 'pods.goals.cancel', 'tasks.cancel',
      'terminal.connectTicket', 'fileHistory.snapshot', 'pod.events.seenAll',
    ]) {
      expect(`${id}:${responded.has(id)}`).toBe(`${id}:true`);
    }
  });
});


