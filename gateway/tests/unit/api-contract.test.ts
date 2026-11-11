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
