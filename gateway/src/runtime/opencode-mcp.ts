// gateway/src/runtime/opencode-mcp.ts
// MCP 运行时管理通道的 **opencode 适配器实现**（mcpApi）。
//
// 分层原则（2026-10-28 架构修正）：gateway 只依赖 RuntimeMcpChannel 契约，
// opencode 的具体形态（v2 HTTP /api/mcp、/api/experimental/mcp/:server/*、
// CLI `opencode mcp list`、Windows shim 细节、配置文档形状）全部留在本文件。
//
// wire 实证（2026-10-28）：
//   GET  /api/mcp?location=                     → {location, data:[{name, status:{status,error?}}]}
//   POST /api/experimental/mcp/:server/connect  → 204
//   POST /api/experimental/mcp/:server/disconnect → 204
//   PUT/DELETE /api/experimental/mcp/:server    → 增删（纯运行时，不落盘；B4 持久化另走配置写入）
import * as path from 'path';
import type { RuntimeMcpChannel, RuntimeMcpServer, RuntimeMcpStatus } from './contract';

export type McpListStatus = RuntimeMcpStatus;
export interface McpListEntry {
  name: string;
  status: McpListStatus;
  detail?: string;
}

const ANSI_RE = /\x1b\[[0-9;]*m/g;

/** 解析 `opencode mcp list` 输出：`✓ mafw  connected` / `✗ x  failed: …`。 */
export function parseMcpListOutput(text: string): McpListEntry[] {
  const out: McpListEntry[] = [];
  for (const rawLine of (text ?? '').split(/\r?\n/)) {
    const line = rawLine.replace(ANSI_RE, '').trim();
    if (!line) continue;
    const m = line.match(/^[✓✔✗×!]\s+(\S+)\s+(.+)$/);
    if (!m) continue;
    const name = m[1]!;
    const rest = m[2]!.trim();
    let status: McpListStatus = 'unknown';
    const low = rest.toLowerCase();
    if (low.startsWith('connected')) status = 'connected';
    else if (low.startsWith('disabled')) status = 'disabled';
    else if (low.startsWith('failed') || low.startsWith('error')) status = 'failed';
    else if (low.includes('auth') || low.includes('sign in') || low.includes('login')) status = 'needs_auth';
    out.push({ name, status, ...(rest.length > 24 ? { detail: rest.slice(0, 80) } : {}) });
  }
  return out;
}

/**
 * execFile 的 Windows shim 处置（wire 实证 2026-10-28）：
 * - `.ps1` 直跑 EFTYPE / shell 下 15s 挂死——不可用；
 * - `.cmd` 直跑同步抛 EINVAL，必须 shell:true；
 * - 官方全局布局的 `<prefix>/node_modules/@opencode/cli/bin/opencode.exe` 直跑最快（139ms）——优先。
 */
export interface McpListCommand {
  bin: string;
  shell: boolean;
}

export function resolveMcpListCommand(
  resolvedBin: string,
  exists: (p: string) => boolean,
): McpListCommand | null {
  if (!resolvedBin) return null;
  if (/\.(exe|com)$/i.test(resolvedBin) && exists(resolvedBin)) return { bin: resolvedBin, shell: false };
  // npm 全局 shim（.cmd/.ps1）旁边找官方 exe（@opencode/cli 布局）。
  const dir = path.dirname(resolvedBin);
  const exe = path.join(dir, 'node_modules', '@opencode', 'cli', 'bin', 'opencode.exe');
  if (exists(exe)) return { bin: exe, shell: false };
  if (/\.(cmd|bat)$/i.test(resolvedBin) && exists(resolvedBin)) return { bin: resolvedBin, shell: true };
  if (/\.ps1$/i.test(resolvedBin)) return null;
  return exists(resolvedBin) ? { bin: resolvedBin, shell: false } : null;
}

function normalizeStatus(raw: unknown): RuntimeMcpStatus {
  const s = String(raw ?? '').toLowerCase();
  if (s === 'connected') return 'connected';
  if (s === 'disabled') return 'disabled';
  if (s === 'failed' || s === 'error') return 'failed';
  if (s === 'needs_auth' || s === 'needs_client_registration') return 'needs_auth';
  return 'unknown';
}

function sourceBasename(p: unknown): string {
  return String(p ?? '').split(/[\\/]/).pop() ?? '';
}

export interface OpencodeMcpDeps {
  /** serve 基址（不含 /api）。 */
  getBaseUrl(): string;
  /** serve 认证头等。 */
  headers(): Record<string, string>;
  /** opencode 配置文档层（[{type:'document', path, info}]）。 */
  getConfigDocuments(): Promise<any[]>;
  /** 运行 `opencode mcp list` 并返回 stdout（fail-open：错误返回空串）。 */
  listCliOutput(): Promise<string>;
  fetchImpl?: typeof fetch;
}

/**
 * opencode 的 MCP 通道实现：配置文档 + 运行时状态合并；连接/断开走 v2 HTTP；
 * HTTP 不可用时回退 CLI 状态解析（只影响列表，不影响连接/断开）。
 */
export function createOpencodeMcpChannel(deps: OpencodeMcpDeps): RuntimeMcpChannel {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const base = () => deps.getBaseUrl().replace(/\/+$/, '');
  const auth = () => ({ Accept: 'application/json', ...deps.headers() });

  async function postAction(
    name: string,
    action: 'connect' | 'disconnect',
    opts?: { directory?: string },
  ): Promise<boolean> {
    const q = opts?.directory ? `?location=${encodeURIComponent(opts.directory)}` : '';
    const res = await fetchImpl(
      `${base()}/api/experimental/mcp/${encodeURIComponent(name)}/${action}${q}`,
      { method: 'POST', headers: auth(), signal: AbortSignal.timeout(8000) },
    );
    return res.ok;
  }

  return {
    async list(opts): Promise<RuntimeMcpServer[]> {
      const servers = new Map<string, RuntimeMcpServer>();

      // 1) 配置定义（来源/类型/URL/命令/disabled）
      try {
        for (const doc of await deps.getConfigDocuments()) {
          const defs = doc?.info?.mcp?.servers;
          if (!defs || typeof defs !== 'object') continue;
          for (const [name, cfg] of Object.entries<any>(defs)) {
            servers.set(name, {
              name,
              status: 'unknown',
              type: cfg?.type === 'remote' ? 'remote' : 'local',
              ...(typeof cfg?.url === 'string' ? { url: cfg.url } : {}),
              ...(Array.isArray(cfg?.command) ? { command: cfg.command.map(String) } : {}),
              ...(doc?.path ? { source: sourceBasename(doc.path) } : {}),
              ...(cfg?.disabled === true ? { disabled: true } : {}),
            });
          }
        }
      } catch { /* fail-open：配置层不可读时仍可返回运行时状态 */ }

      // 2) 运行时状态（v2 HTTP）
      const statuses = new Map<string, { status: RuntimeMcpStatus; detail?: string }>();
      try {
        const q = opts?.directory ? `?location=${encodeURIComponent(opts.directory)}` : '';
        const res = await fetchImpl(`${base()}/api/mcp${q}`, {
          headers: auth(),
          signal: AbortSignal.timeout(4000),
        });
        if (res.ok) {
          const j: any = await res.json();
          for (const item of Array.isArray(j?.data) ? j.data : []) {
            if (!item?.name) continue;
            const s = item.status;
            statuses.set(String(item.name), {
              status: normalizeStatus(typeof s === 'string' ? s : s?.status),
              ...(typeof s === 'object' && s?.error ? { detail: String(s.error).slice(0, 160) } : {}),
            });
          }
        }
      } catch { /* 回退 CLI */ }

      // 3) 状态合并（含运行时-only 服务器）
      for (const [name, st] of statuses) {
        const prev = servers.get(name);
        servers.set(name, { ...(prev ?? { name }), status: st.status, ...(st.detail ? { detail: st.detail } : {}) });
      }

      // 4) HTTP 与配置都不可用 → CLI 兜底
      if (servers.size === 0) {
        try {
          for (const e of parseMcpListOutput(await deps.listCliOutput())) {
            servers.set(e.name, { name: e.name, status: e.status, ...(e.detail ? { detail: e.detail } : {}) });
          }
        } catch { /* fail-open */ }
      }

      return [...servers.values()].sort((a, b) => a.name.localeCompare(b.name));
    },

    connect: (name, opts) => postAction(name, 'connect', opts),
    disconnect: (name, opts) => postAction(name, 'disconnect', opts),
  };
}
