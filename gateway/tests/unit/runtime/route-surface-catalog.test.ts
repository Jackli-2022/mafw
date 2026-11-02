/**
 * Route → surface catalog guard（spec 2026-11-02 §11「每个 gated route 必须有
 * route→surface 对照与中性 503 测试」）。
 *
 * 三条断言，逐条覆盖每个 gated op：
 *   1. surface 存在于 runtime contract manifest（拼错 = 永远 false 的隐性禁用）；
 *   2. operationId 存在于 gateway route catalog（登记缺失 = 契约漂移）；
 *   3. 用拒绝型 RuntimeAccess 真调 handler：**中性** 503/404（不泄漏 runtime 名、
 *      不泄漏 capability flag 名），且门确实只认 surface。
 *
 * 反向 fixture（`expectNeutral` 本身被验证会失败）保证断言不会假绿。
 */
import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';
import { Readable } from 'node:stream';
import { buildRouteCatalog } from '../../../src/routes/route-catalog';
import { buildRuntimeContractManifest } from '../../../src/runtime/contract-manifest';
import { handleSessionBackground } from '../../../src/routes/session-background';
import { handleSessionBranch } from '../../../src/routes/session-branch';
import { handleSessionCheckpoints } from '../../../src/routes/session-checkpoints';
import { handleSessionDiff, handleSessionDiffRevert } from '../../../src/routes/session-diff';
import { handleSessionMutations } from '../../../src/routes/session-mutations';
import { handleSessionRun } from '../../../src/routes/session-run';
import { handleSessionSummarize } from '../../../src/routes/session-summarize';
import { handleSessionSwitch } from '../../../src/routes/session-switch';
import { handlePermissionReplyById } from '../../../src/routes/permission';
import { handleMcp } from '../../../src/routes/mcp';
import { handleMcpConfig } from '../../../src/routes/mcp-config';
import { handleTerminal } from '../../../src/routes/terminal';
import { handleRestartAgent } from '../../../src/routes/restart-agent';
import { TerminalService } from '../../../src/terminal/terminal-service';

const GATEWAY_ROOT = path.join(__dirname, '..', '..', '..');
const SECRET_RUNTIME = 'secret-runtime-name';

interface ProbeResult { status: number; body: any }

interface GatedRoute {
  operationId: string;
  method: string;
  /** catalog 形态（`:param`）。 */
  path: string;
  surface: string;
  /** handler 源文件（相对 gateway/）。 */
  file: string;
  /** 缺 surface 时的期望状态（unrevert 语义上是 404）。 */
  denyStatus?: number[];
  /** 真实 handler 调用（拒绝型 access）。source-only 条目没有它。 */
  probe?: () => Promise<ProbeResult>;
}

// ─── 探测脚手架 ──────────────────────────────────────────────────────────────

function makeRes(): { res: http.ServerResponse; out: ProbeResult } {
  const out: ProbeResult = { status: 0, body: null };
  const res = {
    writeHead(status: number) { out.status = status; },
    end(body?: string) { out.body = body ? JSON.parse(body) : null; },
    setHeader() { /* noop */ },
  } as unknown as http.ServerResponse;
  return { res, out };
}

/** `for await` / `on('data')` 两种 readBody 形态都满足。 */
function makeReq(method: string, url: string, body?: any): http.IncomingMessage {
  const stream = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]) as unknown as http.IncomingMessage;
  (stream as any).method = method;
  (stream as any).url = url;
  (stream as any).headers = { host: '127.0.0.1:3000' };
  (stream as any).socket = { remoteAddress: '127.0.0.1' };
  return stream;
}

function denyAccess(): { can(id: string): boolean } {
  return { can: () => false };
}

/** 会话 switch 用 `on('data')` 读取，Readable 同时满足两种形态。 */
function fakeRuntime(): any {
  return {
    name: SECRET_RUNTIME,
    capabilities: {},
    session: {
      fork: async () => ({}),
      revert: async () => {},
      unrevert: async () => {},
      diff: async () => [],
      summarize: async () => ({}),
      delete: async () => {},
      update: async () => ({}),
      switchAgent: async () => {},
      switchModel: async () => {},
      permissionList: async () => [],
      permissionReply: async () => true,
      background: async () => {},
    },
    agentProcess: { restart: async () => {} },
  };
}

// ─── 目录表 ──────────────────────────────────────────────────────────────────

export const GATED_ROUTES: GatedRoute[] = [
  {
    operationId: 'session.background', method: 'POST', path: '/api/session/:id/background',
    surface: 'session.background', file: 'src/routes/session-background.ts',
    probe: async () => {
      const { res, out } = makeRes();
      await handleSessionBackground(makeReq('POST', '/api/session/s1/background'), res, '/api/session/s1/background', {
        getRuntime: () => fakeRuntime(), getAccess: () => denyAccess() as any,
      });
      return out;
    },
  },
  {
    operationId: 'session.fork', method: 'POST', path: '/api/sessions/:id/fork',
    surface: 'branch.fork', file: 'src/routes/session-branch.ts',
    probe: async () => branchProbe('fork'),
  },
  {
    operationId: 'session.revert', method: 'POST', path: '/api/sessions/:id/revert',
    surface: 'branch.revert', file: 'src/routes/session-branch.ts',
    probe: async () => branchProbe('revert'),
  },
  {
    // 语义降级：unrevert 是可选原语，缺 surface 报 404 而不是 503（非「能力缺失」而是
    // 「该 runtime 无此原语」）。
    operationId: 'session.unrevert', method: 'POST', path: '/api/sessions/:id/unrevert',
    surface: 'branch.unrevert', file: 'src/routes/session-branch.ts', denyStatus: [404],
    probe: async () => branchProbe('unrevert'),
  },
  {
    operationId: 'session.checkpoint', method: 'POST', path: '/api/sessions/:id/checkpoint',
    surface: 'branch.checkpoint', file: 'src/routes/session-checkpoints.ts',
    probe: async () => checkpointProbe('POST', '/api/sessions/s1/checkpoint'),
  },
  {
    operationId: 'session.checkpoints', method: 'GET', path: '/api/sessions/:id/checkpoints',
    surface: 'branch.checkpoint', file: 'src/routes/session-checkpoints.ts',
    probe: async () => checkpointProbe('GET', '/api/sessions/s1/checkpoints'),
  },
  {
    operationId: 'session.restoreCheckpoint', method: 'POST', path: '/api/sessions/:id/checkpoints/:checkpointId/restore',
    surface: 'branch.checkpoint', file: 'src/routes/session-checkpoints.ts',
    probe: async () => checkpointProbe('POST', '/api/sessions/s1/checkpoints/c1/restore', { scope: 'files', confirm: true }),
  },
  {
    operationId: 'session.suspend', method: 'POST', path: '/api/sessions/:id/suspend',
    surface: 'branch.runState', file: 'src/routes/session-run.ts',
    probe: async () => runProbe('POST', '/api/sessions/s1/suspend'),
  },
  {
    operationId: 'session.resume', method: 'POST', path: '/api/sessions/:id/resume',
    surface: 'branch.runState', file: 'src/routes/session-run.ts',
    probe: async () => runProbe('POST', '/api/sessions/s1/resume'),
  },
  {
    operationId: 'session.summarize', method: 'POST', path: '/api/session/:id/summarize',
    surface: 'session.summarize', file: 'src/routes/session-summarize.ts',
    probe: async () => {
      const { res, out } = makeRes();
      await handleSessionSummarize(makeReq('POST', '/api/session/s1/summarize', {}), res, '/api/session/s1/summarize', {
        getRuntime: () => fakeRuntime(), getAccess: () => denyAccess() as any,
      });
      return out;
    },
  },
  {
    operationId: 'session.diff', method: 'GET', path: '/api/sessions/:id/diff',
    surface: 'branch.diff', file: 'src/routes/session-diff.ts',
    probe: async () => {
      const { res, out } = makeRes();
      await handleSessionDiff(res, 's1', 'm1', { runtime: fakeRuntime(), access: denyAccess() as any });
      return out;
    },
  },
  {
    operationId: 'session.revertDiff', method: 'POST', path: '/api/sessions/:id/diff/revert',
    surface: 'branch.diff', file: 'src/routes/session-diff.ts',
    probe: async () => {
      const { res, out } = makeRes();
      await handleSessionDiffRevert(
        makeReq('POST', '/api/sessions/s1/diff/revert', { patches: [{ file: 'a', patch: '@@ -1 +1 @@\n-a\n+b', hunkIndices: [0] }] }),
        res, 's1', { runtime: fakeRuntime(), access: denyAccess() as any },
      );
      return out;
    },
  },
  {
    operationId: 'session.delete', method: 'DELETE', path: '/api/sessions/:id',
    surface: 'session.delete', file: 'src/routes/session-mutations.ts',
    probe: async () => {
      const { res, out } = makeRes();
      await handleSessionMutations(makeReq('DELETE', '/api/sessions/s1'), res, {
        getRuntime: () => fakeRuntime(), getAccess: () => denyAccess() as any,
      });
      return out;
    },
  },
  {
    operationId: 'session.rename', method: 'PATCH', path: '/api/sessions/:id',
    surface: 'session.update', file: 'src/routes/session-mutations.ts',
    probe: async () => {
      const { res, out } = makeRes();
      await handleSessionMutations(makeReq('PATCH', '/api/sessions/s1', { title: 'x' }), res, {
        getRuntime: () => fakeRuntime(), getAccess: () => denyAccess() as any,
      });
      return out;
    },
  },
  {
    operationId: 'session.switchAgent', method: 'POST', path: '/api/sessions/:id/agent',
    surface: 'session.switchAgent', file: 'src/routes/session-switch.ts',
    probe: async () => {
      const { res, out } = makeRes();
      await handleSessionSwitch(makeReq('POST', '/api/sessions/s1/agent', { agent: 'plan' }), res, 's1', 'agent', {
        getRuntime: () => fakeRuntime(), getAccess: () => denyAccess() as any,
      });
      return out;
    },
  },
  {
    operationId: 'session.switchModel', method: 'POST', path: '/api/sessions/:id/model',
    surface: 'session.switchModel', file: 'src/routes/session-switch.ts',
    probe: async () => {
      const { res, out } = makeRes();
      await handleSessionSwitch(
        makeReq('POST', '/api/sessions/s1/model', { model: { providerID: 'p', modelID: 'm' } }),
        res, 's1', 'model', { getRuntime: () => fakeRuntime(), getAccess: () => denyAccess() as any },
      );
      return out;
    },
  },
  {
    operationId: 'runtime.restartAgent', method: 'POST', path: '/api/runtime/restart-agent',
    surface: 'process.restart', file: 'src/routes/restart-agent.ts',
    probe: async () => {
      const { res, out } = makeRes();
      await handleRestartAgent(makeReq('POST', '/api/runtime/restart-agent'), res, {
        getAccess: () => denyAccess() as any,
        isRecovering: () => false,
        isSwitching: () => false,
        begin: () => {},
        end: () => {},
        restartAgent: async () => ({ mode: 'owned-respawn' }),
      });
      return out;
    },
  },
  {
    operationId: 'permissions.reply', method: 'POST', path: '/api/permissions/:id/reply',
    surface: 'approval.permissionReply', file: 'src/routes/permission.ts',
    probe: async () => {
      const { res, out } = makeRes();
      await handlePermissionReplyById(makeReq('POST', '/api/permissions/r1/reply', { reply: 'once' }), res, 'r1', {
        runtime: fakeRuntime(), access: denyAccess() as any,
      });
      return out;
    },
  },
  {
    operationId: 'permissions.replyRuntime', method: 'POST', path: '/api/sessions/:sid/permissions/:rid',
    surface: 'approval.permissionReply', file: 'src/routes/permission.ts',
    probe: async () => {
      const { res, out } = makeRes();
      await handlePermissionReplyById(makeReq('POST', '/api/sessions/s1/permissions/r1', { reply: 'once' }), res, 'r1', {
        runtime: fakeRuntime(), access: denyAccess() as any,
      });
      return out;
    },
  },
  {
    operationId: 'mcp.servers', method: 'GET', path: '/api/mcp/servers',
    surface: 'mcp.list', file: 'src/routes/mcp.ts',
    probe: async () => mcpProbe('GET', '/api/mcp/servers'),
  },
  {
    operationId: 'mcp.connect', method: 'POST', path: '/api/mcp/:name/connect',
    surface: 'mcp.connect', file: 'src/routes/mcp.ts',
    probe: async () => mcpProbe('POST', '/api/mcp/mafw/connect'),
  },
  {
    operationId: 'mcp.disconnect', method: 'POST', path: '/api/mcp/:name/disconnect',
    surface: 'mcp.disconnect', file: 'src/routes/mcp.ts',
    probe: async () => mcpProbe('POST', '/api/mcp/mafw/disconnect'),
  },
  {
    operationId: 'mcp.configPreview', method: 'POST', path: '/api/mcp/config/preview',
    surface: 'mcp.config.preview', file: 'src/routes/mcp-config.ts',
    probe: async () => mcpConfigProbe('POST', '/api/mcp/config/preview', { name: 'x' }),
  },
  {
    operationId: 'mcp.configPreviewRemove', method: 'POST', path: '/api/mcp/config/preview-remove',
    surface: 'mcp.config.preview', file: 'src/routes/mcp-config.ts',
    probe: async () => mcpConfigProbe('POST', '/api/mcp/config/preview-remove', { name: 'x' }),
  },
  {
    operationId: 'mcp.configApply', method: 'POST', path: '/api/mcp/config/apply',
    surface: 'mcp.config.apply', file: 'src/routes/mcp-config.ts',
    probe: async () => mcpConfigProbe('POST', '/api/mcp/config/apply', { confirm: true }),
  },
  {
    operationId: 'mcp.configRestore', method: 'POST', path: '/api/mcp/config/restore',
    surface: 'mcp.config.restore', file: 'src/routes/mcp-config.ts',
    probe: async () => mcpConfigProbe('POST', '/api/mcp/config/restore', {}),
  },
  {
    operationId: 'mcp.configRemove', method: 'DELETE', path: '/api/mcp/config/servers/:name',
    surface: 'mcp.config.remove', file: 'src/routes/mcp-config.ts',
    probe: async () => mcpConfigProbe('DELETE', '/api/mcp/config/servers/x', undefined),
  },
  {
    operationId: 'terminal.list', method: 'GET', path: '/api/terminal/sessions',
    surface: 'terminal.pty', file: 'src/routes/terminal.ts',
    // 列表是 safe/informational：不报错，但必须 supported:false（不是 `[]` 假象）。
    denyStatus: [200],
    probe: async () => terminalProbe('GET', '/api/terminal/sessions'),
  },
  {
    operationId: 'terminal.create', method: 'POST', path: '/api/terminal/sessions',
    surface: 'terminal.pty', file: 'src/routes/terminal.ts',
    probe: async () => terminalProbe('POST', '/api/terminal/sessions', { directory: 'C:/w' }),
  },
  {
    operationId: 'terminal.remove', method: 'DELETE', path: '/api/terminal/sessions/:id',
    surface: 'terminal.pty', file: 'src/routes/terminal.ts',
    probe: async () => terminalProbe('DELETE', '/api/terminal/sessions/pty_1'),
  },
  {
    operationId: 'terminal.connectTicket', method: 'POST', path: '/api/terminal/sessions/:id/connect-ticket',
    surface: 'terminal.pty', file: 'src/routes/terminal.ts',
    probe: async () => terminalProbe('POST', '/api/terminal/sessions/pty_1/connect-ticket', { directory: 'C:/w' }),
  },
];

// ─── 反向覆盖：源码里出现的门必须被登记（新门不能逃逸） ──────────────────────

/**
 * 非主门 / 组合根 inline 门：无法作为独立 route 探测，逐条登记 surface + 源标记。
 * 反向断言「登记项仍然存在于源码」，防止门被搬家后豁免表变成僵尸。
 */
interface NonPrimaryGate {
  surface: string;
  file: string;
  marker: string;
  why: string;
}

export const NON_PRIMARY_GATES: NonPrimaryGate[] = [
  {
    surface: 'approval.permissionList',
    file: 'src/routes/permission.ts',
    marker: "access.can('approval.permissionList')",
    why: 'permissions.reply 的第二道门（反查 pending 列表）；由专门用例断言中性 503',
  },
  {
    surface: 'session.snapshotTree',
    file: 'src/routes/session-diff.ts',
    marker: "gateSurface(res, deps, 'session.snapshotTree')",
    why: 'per-turn diff 的第二道门（需要 adapter 快照树原语），缺时长中性 503',
  },
  {
    surface: 'session.worktree',
    file: 'src/index.ts',
    marker: "can('session.worktree')",
    why: 'POST /api/session 的 worktree 开口径（gateway git + directory 契约）；由专门用例断言',
  },
  {
    surface: 'approval.question.list',
    file: 'src/index.ts',
    marker: "can('approval.question.list')",
    why: '原生 question 通道的 inline 门（无独立 MAFW route）',
  },
  {
    surface: 'process.completion',
    file: 'src/index.ts',
    marker: "can('process.completion')",
    why: 'completion 通道门（index-scan/consolidation 内部通道，非 HTTP route）',
  },
  {
    surface: 'identity.agents.install',
    file: 'src/index.ts',
    marker: "can('identity.agents.install')",
    why: '身份物化门（无独立 route）',
  },
  {
    surface: 'session.shell',
    file: 'src/index.ts',
    marker: "can('session.shell')",
    why: 'inline /api/shell route',
  },
  {
    surface: 'session.abort',
    file: 'src/index.ts',
    marker: "can('session.abort')",
    why: 'inline /api/session/:id/abort route',
  },
  {
    surface: 'media.session',
    file: 'src/index.ts',
    marker: "can('media.session')",
    why: '媒体会话门（A2A / media runtime 内部）',
  },
  {
    surface: 'provider.list',
    file: 'src/index.ts',
    marker: "capGuard(res, 'provider.list')",
    why: 'inline provider route（capGuard 统一中性 503）',
  },
  {
    surface: 'provider.app.agents',
    file: 'src/index.ts',
    marker: "capGuard(res, 'provider.app.agents')",
    why: 'inline provider route',
  },
  {
    surface: 'provider.config',
    file: 'src/index.ts',
    marker: "capGuard(res, 'provider.config')",
    why: 'inline provider route',
  },
  {
    surface: 'provider.config.update',
    file: 'src/index.ts',
    marker: "capGuard(res, 'provider.config.update')",
    why: 'inline provider route',
  },
];

const GATE_PATTERNS: Array<{ kind: string; pattern: RegExp }> = [
  { kind: 'can', pattern: /\.can\(\s*['"]([^'"]+)['"]\s*\)/g },
  { kind: 'capGuard', pattern: /capGuard\(\s*[^,]+,\s*['"]([^'"]+)['"]\s*\)/g },
  { kind: 'gateSurface', pattern: /gateSurface\([^)]*?['"]([^'"]+)['"]\s*\)/g },
  { kind: 'surfaceMessage', pattern: /surfaceUnavailableMessage\(\s*['"]([^'"]+)['"]\s*\)/g },
];

/** 从单个源码文件里收集「作为门出现」的 surface id（含 `const surface = a ? 'x' : 'y'` 形态）。 */
export function gatedSurfacesFrom(text: string): string[] {
  const found = new Set<string>();
  for (const { pattern } of GATE_PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) found.add(match[1]);
  }
  for (const line of text.split(/\r?\n/)) {
    if (!/const surface =|surface = action/.test(line)) continue;
    for (const match of line.matchAll(/'([a-z][A-Za-z0-9-]*(?:\.[a-z][A-Za-z0-9-]*)+)'/g)) found.add(match[1]);
  }
  return [...found];
}

/** 扫描 src/routes/** 与 src/index.ts（有 HTTP 门的两处），返回 surface → 命中位置。 */
function scanGatedSurfaces(): Map<string, string[]> {
  const files = [
    ...walkTs(path.join(GATEWAY_ROOT, 'src', 'routes')),
    path.join(GATEWAY_ROOT, 'src', 'index.ts'),
  ];
  const out = new Map<string, string[]>();
  for (const file of files) {
    const rel = path.relative(GATEWAY_ROOT, file).replace(/\\/g, '/');
    for (const surface of gatedSurfacesFrom(fs.readFileSync(file, 'utf8'))) {
      if (!out.has(surface)) out.set(surface, []);
      out.get(surface)!.push(rel);
    }
  }
  return out;
}

function walkTs(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkTs(full, out);
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) out.push(full);
  }
  return out;
}

// ─── 各 handler 的拒绝探测 ────────────────────────────────────────────────────

async function branchProbe(action: 'fork' | 'revert' | 'unrevert'): Promise<ProbeResult> {
  const { res, out } = makeRes();
  const url = `/api/sessions/s1/${action}`;
  await handleSessionBranch(makeReq('POST', url, { messageID: 'm1' }), res, url, {
    getRuntime: () => fakeRuntime(), getAccess: () => denyAccess() as any,
  });
  return out;
}

async function checkpointProbe(method: string, url: string, body?: any): Promise<ProbeResult> {
  const { res, out } = makeRes();
  await handleSessionCheckpoints(makeReq(method, url, body), res, url, {
    getRuntime: () => fakeRuntime(), getAccess: () => denyAccess() as any,
  });
  return out;
}

async function runProbe(method: string, url: string): Promise<ProbeResult> {
  const { res, out } = makeRes();
  await handleSessionRun(makeReq(method, url, {}), res, url, {
    getRuntime: () => fakeRuntime(),
    getAccess: () => denyAccess() as any,
    run: {
      active: () => null,
      suspend: async () => null,
      resume: async () => null,
      discard: async () => null,
    } as any,
  });
  return out;
}

async function mcpProbe(method: string, url: string): Promise<ProbeResult> {
  const { res, out } = makeRes();
  await handleMcp(makeReq(method, url), res, url, {
    access: denyAccess() as any,
    list: async () => [],
    connect: async () => true,
    disconnect: async () => true,
  });
  return out;
}

async function mcpConfigProbe(method: string, url: string, body?: any): Promise<ProbeResult> {
  const { res, out } = makeRes();
  await handleMcpConfig(makeReq(method, url, body), res, url, {
    access: denyAccess() as any,
    preview: async () => ({ token: 't' }),
    previewRemove: async () => ({ token: 't' }),
    apply: async () => ({ applied: true }),
    remove: async () => ({ applied: true }),
    restore: async () => ({ applied: true }),
  } as any);
  return out;
}

async function terminalProbe(method: string, url: string, body?: any): Promise<ProbeResult> {
  const { res, out } = makeRes();
  const service = new TerminalService({ getRuntime: () => ({ pty: undefined }) as any, now: () => 1 });
  await handleTerminal(makeReq(method, url, body), res, url, {
    service,
    access: denyAccess() as any,
    isLoopback: () => true,
  });
  return out;
}

// ─── 断言 ────────────────────────────────────────────────────────────────────

const CAPABILITY_FLAG = /capabilit|diffApi|worktreeApi|sessionBranchApi|checkpointApi|runStateApi|mcpApi|instructionsApi|discoveryApi|terminalApi/i;

/** 中性门：状态码 + 文案都不泄漏 runtime 身份/能力位名。 */
export function expectNeutral(result: ProbeResult, route: GatedRoute): void {
  const expected = route.denyStatus ?? [503];
  expect(expected).toContain(result.status);
  // 列表类端点不报错，但必须以 supported:false 明示不可用（不是空列表假象）。
  if (result.status === 200) expect(result.body?.supported).toBe(false);
  const text = JSON.stringify(result.body ?? '');
  expect(text).not.toContain(SECRET_RUNTIME);
  expect(text).not.toMatch(CAPABILITY_FLAG);
  // 路由把 surface id 写进文案时必须与登记一致（防复制粘贴错门）。
  if (/runtime (?:does not support|surface)/.test(text)) {
    expect(text).toContain(route.surface);
  }
}

describe('route → surface catalog', () => {
  const manifest = buildRuntimeContractManifest();
  const surfaces = new Set(manifest.surfaces.map((surface) => surface.id));
  const catalog = buildRouteCatalog();
  const operations = new Map(catalog.map((route) => [route.operationId, route]));

  it('catalog is non-trivial and fully registered', () => {
    expect(GATED_ROUTES.length).toBeGreaterThanOrEqual(30);
    expect(surfaces.size).toBeGreaterThan(80);
  });

  it('every gated route names a real surface and a registered operation', () => {
    const problems: string[] = [];
    for (const route of GATED_ROUTES) {
      if (!surfaces.has(route.surface)) problems.push(`${route.operationId}: unknown surface ${route.surface}`);
      const op = operations.get(route.operationId);
      if (!op) {
        problems.push(`${route.operationId}: missing from route catalog`);
        continue;
      }
      if (op.method !== route.method) problems.push(`${route.operationId}: method ${op.method} != ${route.method}`);
      const normalized = op.path.replace(/\{([^}]+)\}/g, ':$1');
      if (normalized !== route.path) problems.push(`${route.operationId}: path ${op.path} != ${route.path}`);
    }
    expect(problems).toEqual([]);
  });

  it('every gated handler reads the surface from access, not from raw capabilities', () => {
    const problems: string[] = [];
    for (const route of GATED_ROUTES) {
      const file = path.join(GATEWAY_ROOT, route.file);
      if (!fs.existsSync(file)) {
        problems.push(`${route.operationId}: missing ${route.file}`);
        continue;
      }
      const src = fs.readFileSync(file, 'utf8');
      const code = src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '')
        .replace(/\s\/\/[^\n]*$/gm, '');
      const gated = /\.can\(|\baccess\b/.test(src) && /surface|access/.test(src);
      if (!gated) problems.push(`${route.operationId}: ${route.file} has no access gate`);
      // handler 文件里必须出现该 surface 字面量（动态映射文件里也是字面量）。
      if (!src.includes(`'${route.surface}'`)) problems.push(`${route.operationId}: ${route.file} never mentions ${route.surface}`);
      if (/capabilities\??\.(?:diffApi|worktreeApi|sessionBranchApi|checkpointApi|runStateApi|mcpApi|instructionsApi|terminalApi)/.test(code)) {
        problems.push(`${route.operationId}: ${route.file} gates on raw capabilities`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('denying the surface yields a neutral 503/404 for every gated route', async () => {
    const problems: string[] = [];
    for (const route of GATED_ROUTES) {
      if (!route.probe) continue;
      const result = await route.probe();
      try {
        expectNeutral(result, route);
      } catch (err: any) {
        problems.push(`${route.operationId}: ${err?.message ?? err}`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('permission reply also gates the list surface (no silent empty approvals)', async () => {
    const { res, out } = makeRes();
    await handlePermissionReplyById(makeReq('POST', '/api/permissions/r1/reply', { reply: 'once' }), res, 'r1', {
      runtime: fakeRuntime(),
      access: { can: (id: string) => id === 'approval.permissionReply' } as any,
    });
    expect(out.status).toBe(503);
    expect(JSON.stringify(out.body)).toContain('approval.permissionList');
    expect(JSON.stringify(out.body)).not.toContain(SECRET_RUNTIME);
  });

  it('worktree creation is gated in the composition root by session.worktree', () => {
    const index = fs.readFileSync(path.join(GATEWAY_ROOT, 'src/index.ts'), 'utf8');
    expect(index).toContain("access?.can('session.worktree')");
    // 409（该目录不支持 worktree）不是能力 503——两者必须分开表达。
    const create = fs.readFileSync(path.join(GATEWAY_ROOT, 'src/routes/session-create.ts'), 'utf8');
    expect(create).toContain('WorktreeUnavailableError');
    expect(create).toContain('409');
  });

  it('reverse coverage: every gate in src/routes + index is catalogued', () => {
    const detected = scanGatedSurfaces();
    expect(detected.size).toBeGreaterThan(25);
    const catalogued = new Set([
      ...GATED_ROUTES.map((route) => route.surface),
      ...NON_PRIMARY_GATES.map((gate) => gate.surface),
    ]);
    const escaped = [...detected]
      .filter(([surface]) => !catalogued.has(surface))
      .map(([surface, where]) => `${surface} (${[...new Set(where)].join(', ')})`);
    expect(escaped).toEqual([]);
  });

  it('non-primary gate register stays live (no zombie exemptions)', () => {
    const detected = scanGatedSurfaces();
    const stale: string[] = [];
    const missingMarker: string[] = [];
    for (const gate of NON_PRIMARY_GATES) {
      if (!detected.has(gate.surface)) stale.push(`${gate.surface}: not gated anywhere any more`);
      const text = fs.readFileSync(path.join(GATEWAY_ROOT, gate.file), 'utf8');
      if (!text.includes(gate.marker)) missingMarker.push(`${gate.surface}: marker ${gate.marker} not in ${gate.file}`);
      if (!gate.why.trim()) stale.push(`${gate.surface}: missing rationale`);
    }
    expect({ stale, missingMarker }).toEqual({ stale: [], missingMarker: [] });
  });

  it('gate scanner catches a brand-new gate (reverse fixture)', () => {
    expect(gatedSurfacesFrom("if (!access?.can('session.brandNew')) return;")).toEqual(['session.brandNew']);
    expect(gatedSurfacesFrom("if (this.capGuard(res, 'provider.brandNew')) return;")).toEqual(['provider.brandNew']);
    expect(gatedSurfacesFrom("const surface = kind === 'x' ? 'session.brandNew' : 'session.otherNew';"))
      .toEqual(['session.brandNew', 'session.otherNew']);
    // 未登记的新门会被反向覆盖断言拒绝（这里直接演示判定）。
    const catalogued = new Set(GATED_ROUTES.map((route) => route.surface));
    expect(catalogued.has('session.brandNew')).toBe(false);
  });

  it('reverse fixture: leaking or wrong-surface gate text fails the neutral check', () => {
    const route = GATED_ROUTES.find((entry) => entry.operationId === 'session.diff')!;
    expect(() => expectNeutral({ status: 503, body: { error: `runtime does not support branch.diff on ${SECRET_RUNTIME}` } }, route)).toThrow();
    expect(() => expectNeutral({ status: 503, body: { error: 'runtime does not support branch.diff (diffApi)' } }, route)).toThrow();
    expect(() => expectNeutral({ status: 200, body: {} }, route)).toThrow();
    // 正常中性文案通过（证明上面的失败来自泄漏而不是断言写死）。
    expectNeutral({ status: 503, body: { error: 'runtime does not support branch.diff' } }, route);
    expectNeutral({ status: 404, body: { error: 'runtime does not support branch.diff' } }, { ...route, denyStatus: [404] });
  });
});
