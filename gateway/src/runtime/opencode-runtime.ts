/**
 * 内置 opencode runtime —— 契约的"恒等实现"：能力全满（Tier 2），
 * 其事件/消息形状即归一化的目标形状。新 runtime 插件以本文件为参照。
 *
 * credentials: 从 opencode auth.json 读取 provider API key（与 plugin ctx
 * 的 apiKey(name) 语义对齐）。其他 runtime 可提供自己的 credential source。
 *
 * sessionStorageApi: opencode 的会话数据持久化在 SQLite（opencode.db），
 * serve 的 session.list 按 project_id = "global" 解析，会隐藏真正属于
 * 某个项目目录的会话。listByDirectory 直读 SQLite 解决此问题；其他
 * runtime 若无等价存储则声明 sessionStorageApi: false，gateway 回退到
 * session.list + 客户端目录过滤。
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AgentRuntime, SessionInfo, fullCapabilities, CompletionRequest, CompletionResult } from './contract';
import { AgentDefinition } from './agent-definition';
import { startServeSidecar, killServePort, resolveServePassword, serveAuthHeaders, resolveOpencodeBin } from './serve-sidecar';
import { createOpencodeAdapter } from './opencode-adapter';
import { createOpencodeMcpChannel, resolveMcpListCommand } from './opencode-mcp';
import { createOpencodeMcpConfigChannel } from './opencode-mcp-config';
import { execFile } from 'child_process';
import { config as gatewayConfig } from '../config';
import { getProviderApiKey } from './auth';
import { httpComplete } from './completion-http';
import { probeOpencodeDialect } from './opencode-dialect-probe';
import { OPENCODE_EVENT_SOURCE, OPENCODE_V1_EVENT_MAPPINGS, OPENCODE_V2_EVENT_MAPPINGS, OPENCODE_TRANSFORM_EVENT } from './opencode-events';
import { OPENCODE_21_EVENT_SOURCE, OPENCODE_21_EVENT_MAPPINGS, translateOpencode21Event } from './opencode-21-events';
import type { EventMappingEntry } from './event-mapper';
import { log } from '../core/utils/logger';

// Re-export auth utilities for consumers (single implementation source)
export { DEFAULT_AUTH_PATH, readOpencodeAuth, getProviderApiKey } from './auth';
export type { ProviderCredential } from './auth';

// ─── SQLite 直读层（opencode.db） ────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { DatabaseSync } = require('node:sqlite') as {
  DatabaseSync: new (path: string, opts?: { readOnly?: boolean }) => {
    prepare(sql: string): {
      all(...params: unknown[]): Record<string, unknown>[];
    };
    close(): void;
  };
};

interface DbSessionRow {
  id: string;
  project_id: string;
  parent_id: string | null;
  directory: string;
  title: string;
  metadata: Record<string, unknown> | null;
  time_created: number;
  time_updated: number;
}

function normalizeDir(dir: string): string {
  return dir.replace(/\\/g, '/').toLowerCase().replace(/\/+$/, '');
}

export function opencodeDbPath(): string {
  const base = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
  return path.join(base, 'opencode', 'opencode.db');
}

function toSessionShape(row: DbSessionRow): SessionInfo {
  return {
    id: row.id,
    projectID: row.project_id,
    directory: row.directory,
    title: row.title,
    parentID: row.parent_id ?? undefined,
    metadata: row.metadata ?? undefined,
    time: { created: row.time_created, updated: row.time_updated },
  };
}

function projectIdsForDirectory(
  db: { prepare(sql: string): { all(...params: unknown[]): Record<string, unknown>[] } },
  directory: string,
): string[] {
  const target = normalizeDir(directory);
  const ids = new Set<string>();

  try {
    const byDir = db.prepare('SELECT project_id, directory FROM project_directory').all();
    for (const row of byDir) {
      const rowDir = row.directory;
      if (typeof rowDir === 'string' && normalizeDir(rowDir) === target) {
        ids.add(String(row.project_id));
      }
    }
  } catch { /* column may be absent on old schemas */ }

  try {
    const byWorktree = db.prepare('SELECT id, worktree FROM project').all();
    for (const row of byWorktree) {
      const rowDir = row.worktree;
      if (typeof rowDir === 'string' && normalizeDir(rowDir) === target) {
        ids.add(String(row.id));
      }
    }
  } catch { /* ignore */ }

  return [...ids];
}

function sessionsUnderDirectory(
  db: { prepare(sql: string): { all(...params: unknown[]): Record<string, unknown>[] } },
  directory: string,
  limit = 200,
): DbSessionRow[] {
  const target = normalizeDir(directory);
  const rows = db.prepare(
    `SELECT id, project_id, parent_id, directory, title, metadata, time_created, time_updated
     FROM session
     ORDER BY time_updated DESC
     LIMIT 5000`,
  ).all() as unknown as DbSessionRow[];

  const matching: DbSessionRow[] = [];
  for (const row of rows) {
    const rowDir = normalizeDir(row.directory || '');
    if (rowDir === target || rowDir.startsWith(target + '/')) matching.push(row);
    if (matching.length >= limit) break;
  }
  return matching;
}

function listSessionsFromDb(directory: string, limit = 200): SessionInfo[] {
  if (!directory) return [];
  const dbPath = opencodeDbPath();
  if (!fs.existsSync(dbPath)) return [];

  let db: InstanceType<typeof DatabaseSync>;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
  } catch {
    return [];
  }

  try {
    const projectIds = projectIdsForDirectory(db, directory);
    const out: SessionInfo[] = [];
    const seen = new Set<string>();

    const push = (row: DbSessionRow) => {
      if (seen.has(row.id)) return;
      seen.add(row.id);
      out.push(toSessionShape(row));
    };

    if (projectIds.length > 0) {
      const placeholders = projectIds.map(() => '?').join(', ');
      const rows = db.prepare(
        `SELECT id, project_id, parent_id, directory, title, metadata, time_created, time_updated
         FROM session
         WHERE project_id IN (${placeholders})
         ORDER BY time_updated DESC
         LIMIT ?`,
      ).all(...projectIds, limit) as unknown as DbSessionRow[];
      for (const row of rows) push(row);
    }

    if (out.length === 0) {
      for (const row of sessionsUnderDirectory(db, directory, limit)) push(row);
    }

    return out;
  } finally {
    try { db.close(); } catch { /* ignore */ }
  }
}

// ─── Agent 定义序列化（AgentDefinition → opencode frontmatter） ─────────────

const OPENCODE_BUILTIN_PERM_KEYS = new Set(['question', 'plan_exit']);

export function serializeAgentToFrontmatter(def: AgentDefinition): string {
  const lines: string[] = ['---'];

  if (def.mode) lines.push(`mode: ${def.mode}`);
  lines.push(`description: ${def.description}`);
  if (def.color) lines.push(`color: "${def.color}"`);
  if (def.model) lines.push(`model: ${def.model}`);
  if (def.temperature !== undefined) lines.push(`temperature: ${def.temperature}`);

  const permLines: string[] = [];
  const tools = def.permissions.tools ?? {};
  const deferredTools: [string, string][] = [];

  for (const [key, rule] of Object.entries(tools)) {
    if (OPENCODE_BUILTIN_PERM_KEYS.has(key)) {
      permLines.push(`  ${key}: ${rule}`);
    } else {
      deferredTools.push([key, rule]);
    }
  }

  if (def.permissions.task) {
    permLines.push('  task:');
    for (const [key, rule] of Object.entries(def.permissions.task)) {
      permLines.push(`    ${key}: ${rule}`);
    }
  }

  if (def.permissions.edit) {
    permLines.push('  edit:');
    permLines.push(`    "*": ${def.permissions.edit}`);
  }

  if (def.permissions.bash) {
    permLines.push(`  bash: ${def.permissions.bash}`);
  }

  for (const [key, rule] of deferredTools) {
    permLines.push(`  ${key}: ${rule}`);
  }

  if (def.tools) {
    lines.push('tools:');
    for (const [tool, enabled] of Object.entries(def.tools)) {
      lines.push(`  '${tool}': ${enabled}`);
    }
  }

  if (permLines.length > 0) {
    lines.push('permission:');
    lines.push(...permLines);
  }

  lines.push('---');
  lines.push('');
  lines.push(def.systemPrompt);
  lines.push('');

  return lines.join('\n');
}

export function installAgentFile(name: string, def: AgentDefinition, baseDir: string): string {
  const dir = baseDir;
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${name}.md`);
  const content = serializeAgentToFrontmatter(def);
  fs.writeFileSync(filePath, content, 'utf-8');
  return filePath;
}

function opencodeAgentDir(): string {
  return path.join(os.homedir(), '.config', 'opencode', 'agent');
}

// ─── Runtime 工厂 ────────────────────────────────────────────────────────────

export interface OpencodeRuntimeConfig {
  baseUrl: string;
  headers?: Record<string, string>;
  /** 裸 `opencode`（自适应方言）置 true：runtime 挂 resolveEventEntry，gateway
   *  在（重）接线事件流时经 SSE peek 探测选 @v1/@v2 表（fail-safe 恒 @v1）。
   *  钉死方言（opencode@v1/@v2）不置——其映射表由注册 extras 直接携带。 */
  dialectProbe?: boolean;
}

export async function createOpencodeRuntime(config: OpencodeRuntimeConfig): Promise<AgentRuntime> {
  const client = await createOpencodeAdapter(config);  const isExternal = !!process.env.MAFW_SERVER_SERVE_URL;
  const caps = fullCapabilities();
  if (isExternal) {
    // External runtimes only probe; they don't manage the serve process.
    caps.agentProcessApi = false;
  }
  const rt: AgentRuntime = Object.assign(client, {
    name: 'opencode' as const,
    capabilities: caps,
    external: isExternal,
    ...(config.dialectProbe
      ? {
          /** 自适应方言入口（contract.resolveEventEntry）：探测 serve 的 v2 面
           *  可见性（sync/next 事件），v2 → @v2 混合消费表，否则/失败 → @v1。
           *  返回完整 entry（含 transformEvent——终审 Critical #1：遗漏会使
           *  wrapDialectEventStream 的整体替换丢掉转换器，message.updated 全灭）。 */
          async resolveEventEntry(): Promise<EventMappingEntry> {
            const dialect = await probeOpencodeDialect(
              (rt as unknown as { getBaseUrl(): string }).getBaseUrl(),
            );
            (rt as AgentRuntime & { activeDialect?: string }).activeDialect = dialect;
            // 2.1.0：顶层 type/data 信封 + session.* 富事件流 → @2.1 合成表
            if (dialect === 'v21') {
              return {
                eventSource: OPENCODE_21_EVENT_SOURCE,
                eventMappings: OPENCODE_21_EVENT_MAPPINGS,
                transformEvent: translateOpencode21Event,
              };
            }
            return {
              eventSource: OPENCODE_EVENT_SOURCE,
              eventMappings: dialect === 'v2' ? OPENCODE_V2_EVENT_MAPPINGS : OPENCODE_V1_EVENT_MAPPINGS,
              transformEvent: OPENCODE_TRANSFORM_EVENT,
            };
          },
        }
      : {}),
    credentials: {
      getApiKey(provider: string): string | null {
        return getProviderApiKey(provider) ?? null;
      },
    },
    getBaseUrl(): string {
      // 地址归 runtime 所有：bootstrap 取配置，spawnServe 吸收 sidecar 实际
      // URL 后（含动态端口），gateway 一律经此读取，不直连配置。
      return process.env.MAFW_SERVER_SERVE_URL || config.baseUrl;
    },
    async healthCheck(): Promise<boolean> {
      try {
        // 2.1.0（2026-10-22 修复）：真 API 面 + 认证探测——旧 /global/health 在 2.1.0
        // 落 SPA（HTML 200 假阳性）；/api/session?limit=1 实测 200 且验证 auth 链路。
        const res = await fetch(`${config.baseUrl.replace(/\/+$/, '')}/api/session?limit=1`, {
          headers: { ...serveAuthHeaders(), ...(config.headers ?? {}) },
          signal: AbortSignal.timeout(3000),
        } as any);
        return res.ok;
      } catch {
        return false;
      }
    },
  });
  rt.session.listByDirectory = async (directory: string, limit?: number): Promise<SessionInfo[]> => {
    return listSessionsFromDb(directory, limit);
  };
  rt.agents = {
    async install(name: string, definition: AgentDefinition): Promise<void> {
      const dir = opencodeAgentDir();
      const existed = fs.existsSync(path.join(dir, `${name}.md`));
      const filePath = installAgentFile(name, definition, dir);
      log.info(`[ManagerAgent] ${existed ? 'updated' : 'wrote'} ${filePath}`);
    },
  };
  // 工具注册通道（tools）由 adapter 提供（Tier-0 必选面的一部分——ack no-op +
  // OPENCODE_NATIVE_TOOLS 清单，见 opencode-adapter.ts）。

  // completionApi: stateless single-shot completion over the shared direct-HTTP
  // transport. Endpoint/key resolution mirrors index-scan's chain (opencode
  // provider config options → auth.json), so any OpenAI-compatible provider
  // connected in opencode works out of the box.
  rt.completion = {
    async complete(req: CompletionRequest): Promise<CompletionResult> {
      return httpComplete(req, {
        scanEndpoints: (gatewayConfig as any).recall?.scanEndpoints || undefined,
        resolveEndpoint: async (providerID) => {
          try {
            const cfg: any = await client.config.get();
            const base = cfg?.provider?.[providerID]?.options?.baseURL;
            if (typeof base === 'string' && base) return `${base.replace(/\/+$/, '')}/chat/completions`;
          } catch { /* fail-open to the next resolution step */ }
          return null;
        },
        resolveApiKey: async (providerID) => {
          try {
            const viaAuth = getProviderApiKey(providerID);
            if (viaAuth) return viaAuth;
            const cfg: any = await client.config.get();
            const key = cfg?.provider?.[providerID]?.options?.apiKey;
            if (typeof key === 'string' && key) return key;
          } catch { /* fail-open to the next resolution step */ }
          return null;
        },
      });
    },
  };

  // agentProcess: owned runtimes provide BOTH primitives themselves —
  // spawnServe (windowsHide-safe `opencode serve` sidecar) and restart (kill
  // the serve port; gateway orchestrates the respawn + event resubscribe).
  // Gateway core never hardcodes agent-specific spawn details.
  // MCP 运行时管理（mcpApi）：opencode 的 v2 HTTP / CLI 兜底 / 配置文档形状全部
  // 收敛在 opencode-mcp.ts；gateway 只消费 RuntimeMcpChannel 契约。
  rt.mcp = createOpencodeMcpChannel({
    getBaseUrl: () => rt.getBaseUrl?.() ?? config.baseUrl,
    headers: () => ({ ...serveAuthHeaders(), ...(config.headers ?? {}) }),
    getConfigDocuments: async () => {
      try {
        const cfg: any = await client.config.get();
        return Array.isArray(cfg) ? cfg : [];
      } catch {
        return [];
      }
    },
    listCliOutput: () =>
      new Promise<string>((resolve) => {
        try {
          const cmd = resolveMcpListCommand(resolveOpencodeBin(), fs.existsSync);
          if (!cmd) {
            resolve('');
            return;
          }
          execFile(
            cmd.bin,
            ['mcp', 'list'],
            { timeout: 15_000, windowsHide: true, shell: cmd.shell },
            (err, stdout) => {
              resolve(err && !stdout ? '' : String(stdout ?? ''));
            },
          );
        } catch {
          resolve('');
        }
      }),
  });

  // MCP 配置持久化（mcpConfigApi）：opencode.jsonc 的 JSONC 编辑/备份/原子写/乐观锁
  // 全在 opencode-mcp-config.ts；gateway 门面不感知文件与格式。
  rt.mcp.config = createOpencodeMcpConfigChannel({
    configPath: () => path.join(os.homedir(), '.config', 'opencode', 'opencode.jsonc'),
    exists: (p) => fs.existsSync(p),
    readFile: (p) => fs.readFileSync(p, 'utf-8'),
    backup: (p) => {
      const b = `${p}.bak-mafw-${Date.now()}`;
      fs.copyFileSync(p, b);
      return b;
    },
    writeFileAtomic: (p, text) => {
      const tmp = `${p}.tmp-mafw-${process.pid}-${Date.now()}`;
      fs.writeFileSync(tmp, text, 'utf-8');
      try {
        fs.renameSync(tmp, p);
      } catch {
        try { fs.unlinkSync(p); } catch { /* ignore */ }
        fs.renameSync(tmp, p);
      }
    },
    applyRuntime: async (name, cfg) => {
      const base = (rt.getBaseUrl?.() ?? config.baseUrl).replace(/\/+$/, '') + '/api';
      const headers = {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...serveAuthHeaders(),
        ...(config.headers ?? {}),
      };
      try {
        const put = await fetch(`${base}/experimental/mcp/${encodeURIComponent(name)}`, {
          method: 'PUT',
          headers,
          body: JSON.stringify({ config: cfg }),
          signal: AbortSignal.timeout(8000),
        });
        if (!put.ok) return false;
        const connect = await fetch(`${base}/experimental/mcp/${encodeURIComponent(name)}/connect`, {
          method: 'POST',
          headers,
          signal: AbortSignal.timeout(8000),
        });
        return connect.ok;
      } catch {
        return false;
      }
    },
    removeRuntime: async (name) => {
      const base = (rt.getBaseUrl?.() ?? config.baseUrl).replace(/\/+$/, '') + '/api';
      try {
        const res = await fetch(`${base}/experimental/mcp/${encodeURIComponent(name)}`, {
          method: 'DELETE',
          headers: { Accept: 'application/json', ...serveAuthHeaders(), ...(config.headers ?? {}) },
          signal: AbortSignal.timeout(8000),
        });
        return res.ok;
      } catch {
        return false;
      }
    },
    listBackups: (p) => {
      try {
        const dir = path.dirname(p);
        const base = path.basename(p);
        return fs
          .readdirSync(dir)
          .filter((f) => f.startsWith(`${base}.bak-mafw-`))
          .map((f) => path.join(dir, f));
      } catch {
        return [];
      }
    },
  });

  if (!rt.external) {
    rt.agentProcess = {
      spawnServe: async (opts) => {
        // host/port 缺省由 runtime 自定（serve 端口是实现细节，gateway 不传）
        const sidecar = await startServeSidecar({
          host: opts.host ?? gatewayConfig.server.serveHost ?? '127.0.0.1',
          port: opts.port ?? gatewayConfig.server.servePort,
          timeoutMs: opts.timeoutMs,
          onOutput: opts.onOutput,
          onExit: opts.onExit,
          // 2.1.0（2026-10-22 修复）：serve 强制 Basic auth——gateway 主动设密码
          // （resolveServePassword 单源：env 显式优先，缺省进程内生成——adapter
          // 认证头同源）。不设则 serve 随机生成，gateway API 不可达。
          password: resolveServePassword(),
        });
        // 吸收 sidecar 报告的实际地址（可能与请求端口不同，如动态分配）：
        // 之后 getBaseUrl/healthCheck/adapter 请求全部跟随实际 URL。
        config.baseUrl = sidecar.url;
        return sidecar;
      },
      killServe: () => killServePort(gatewayConfig.server.servePort),
      async restart(): Promise<void> {
        log.info('[Runtime] agentProcess.restart() — killing serve (gateway orchestrates respawn)');
        killServePort(gatewayConfig.server.servePort);
      },
    };
  }

  return rt;
}
