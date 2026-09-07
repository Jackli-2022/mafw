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
import { AgentRuntime, SessionInfo, fullCapabilities } from './contract';
import { AgentDefinition } from './agent-definition';
import { startServeSidecar, killServePort } from './serve-sidecar';
import { createOpencodeAdapter } from '../opencode-adapter';
import { config as gatewayConfig } from '../config';
import { getProviderApiKey } from './auth';
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
  directory?: string;
  headers?: Record<string, string>;
}

export async function createOpencodeRuntime(config: OpencodeRuntimeConfig): Promise<AgentRuntime> {
  const client = await createOpencodeAdapter(config);
  const isExternal = !!process.env.MAFW_SERVER_SERVE_URL;
  const caps = fullCapabilities();
  if (isExternal) {
    // External runtimes only probe; they don't manage the serve process.
    caps.agentProcessApi = false;
  }
  const rt: AgentRuntime = Object.assign(client, {
    name: 'opencode' as const,
    capabilities: caps,
    external: isExternal,
    credentials: {
      getApiKey(provider: string): string | null {
        return getProviderApiKey(provider) ?? null;
      },
    },
    getBaseUrl(): string {
      return process.env.MAFW_SERVER_SERVE_URL || gatewayConfig.server.serveUrl;
    },
    async healthCheck(): Promise<boolean> {
      try {
        const res = await fetch(`${config.baseUrl}/global/health`, {
          headers: config.headers,
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

  // agentProcess: owned runtimes provide BOTH primitives themselves —
  // spawnServe (windowsHide-safe `opencode serve` sidecar) and restart (kill
  // the serve port; gateway orchestrates the respawn + event resubscribe).
  // Gateway core never hardcodes agent-specific spawn details.
  if (!rt.external) {
    rt.agentProcess = {
      spawnServe: (opts) => startServeSidecar(opts),
      async restart(): Promise<void> {
        log.info('[Runtime] agentProcess.restart() — killing serve (gateway orchestrates respawn)');
        killServePort(gatewayConfig.server.servePort);
      },
    };
  }

  return rt;
}
