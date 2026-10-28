// gateway/src/runtime/opencode-mcp-config.ts
// MCP 配置持久化通道的 **opencode 适配器实现**（mcpConfigApi）。
// 文件路径、JSONC 编辑、备份、原子写、掩码、运行时即时生效全部在这里；
// gateway 门面不感知 opencode.jsonc / jsonc-parser / fs。
import * as crypto from 'crypto';
import type {
  RuntimeMcpConfigChannel,
  RuntimeMcpConfigPreview,
  RuntimeMcpConfigResult,
  RuntimeMcpServerConfigInput,
} from './contract';
import {
  editServer,
  maskSecrets,
  parseConfig,
  removeServerEntry,
  renderDiff,
  restoreServersSubtree,
} from './mcp-jsonc';

export type McpConfigErrorCode =
  | 'etag_mismatch'
  | 'exists'
  | 'type_mismatch'
  | 'invalid'
  | 'too_large'
  | 'not_found'
  | 'io_error';

export class McpConfigError extends Error {
  constructor(public code: McpConfigErrorCode, message: string) {
    super(message);
    this.name = 'McpConfigError';
  }
}

export const MCP_CONFIG_MAX_BYTES = 512 * 1024;
const NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;

export interface OpencodeMcpConfigDeps {
  configPath(): string;
  exists(p: string): boolean;
  readFile(p: string): string;
  backup(p: string): string;
  writeFileAtomic(p: string, text: string): void;
  /** 写盘后尝试让 serve 立即加载（PUT /api/experimental/mcp/:server）。 */
  applyRuntime(name: string, config: Record<string, any>): Promise<boolean>;
  removeRuntime(name: string): Promise<boolean>;
  now?(): number;
  /** 最近备份列表（restore 缺省选择；按 mtime 倒序）。 */
  listBackups?(p: string): string[];
}

function sha256(text: string): string {
  return 'sha256:' + crypto.createHash('sha256').update(text).digest('hex');
}

function validate(input: RuntimeMcpServerConfigInput): void {
  if (!NAME_RE.test(input.name)) throw new McpConfigError('invalid', `invalid server name: ${input.name}`);
  if (input.type === 'remote') {
    if (!input.url || !/^https?:\/\//i.test(input.url)) {
      throw new McpConfigError('invalid', 'remote server requires http(s) url');
    }
  } else if (input.type === 'local') {
    if (!Array.isArray(input.command) || input.command.length === 0 || !input.command[0]) {
      throw new McpConfigError('invalid', 'local server requires non-empty command[]');
    }
  } else {
    throw new McpConfigError('invalid', 'type must be remote|local');
  }
}

/** diff 只展示 mcp.servers（掩码后）——避免把 apiKey/headers 带进 UI/日志。 */
function serversDiff(beforeText: string, afterText: string): string {
  const before = parseConfig(beforeText);
  const after = parseConfig(afterText);
  const safe = (r: typeof before): string =>
    r.ok ? JSON.stringify(maskSecrets(r.servers), null, 2) : '(unparsed)';
  return renderDiff(safe(before), safe(after));
}

export function createOpencodeMcpConfigChannel(deps: OpencodeMcpConfigDeps): RuntimeMcpConfigChannel {
  const now = () => (deps.now ? deps.now() : Date.now());

  function readCurrent(): { path: string; text: string } {
    const p = deps.configPath();
    if (!deps.exists(p)) throw new McpConfigError('not_found', `config not found: ${p}`);
    const text = deps.readFile(p);
    if (Buffer.byteLength(text, 'utf-8') > MCP_CONFIG_MAX_BYTES) {
      throw new McpConfigError('too_large', 'config file exceeds 512KB');
    }
    return { path: p, text };
  }

  function checkToken(text: string, token: string): void {
    if (token !== sha256(text)) {
      throw new McpConfigError('etag_mismatch', 'config changed since preview; re-preview required');
    }
  }

  function backupName(p: string): string {
    return `${p}.bak-mafw-${now()}`;
  }

  return {
    async preview(input: RuntimeMcpServerConfigInput): Promise<RuntimeMcpConfigPreview> {
      validate(input);
      const { path: p, text } = readCurrent();
      const r = editServer(text, input);
      if (!r.ok) throw new McpConfigError(r.code, r.message);
      return {
        token: sha256(text),
        target: p,
        diff: serversDiff(text, r.text),
        backup: backupName(p),
        ...(r.preserved.length ? { preserved: r.preserved } : {}),
        warnings: [],
      };
    },

    async previewRemove(name: string): Promise<RuntimeMcpConfigPreview> {
      const { path: p, text } = readCurrent();
      const r = removeServerEntry(text, name);
      if (!r.ok) throw new McpConfigError(r.code, r.message);
      return {
        token: sha256(text),
        target: p,
        diff: serversDiff(text, r.text),
        backup: backupName(p),
        warnings: [],
      };
    },

    async apply(input: RuntimeMcpServerConfigInput & { token: string; confirm: true }): Promise<RuntimeMcpConfigResult> {
      validate(input);
      const { path: p, text } = readCurrent();
      checkToken(text, input.token);
      const r = editServer(text, input);
      if (!r.ok) throw new McpConfigError(r.code, r.message);
      const backup = deps.backup(p);
      deps.writeFileAtomic(p, r.text);
      const runtimeConfig =
        input.type === 'remote'
          ? { type: 'remote', url: input.url, disabled: false }
          : { type: 'local', command: input.command, disabled: false };
      let runtimeApplied = false;
      try {
        runtimeApplied = await deps.applyRuntime(input.name, runtimeConfig);
      } catch {
        runtimeApplied = false;
      }
      return { applied: true, runtimeApplied, backup };
    },

    async remove(name: string, opts: { token: string; confirm: true }): Promise<RuntimeMcpConfigResult> {
      const { path: p, text } = readCurrent();
      checkToken(text, opts.token);
      const r = removeServerEntry(text, name);
      if (!r.ok) throw new McpConfigError(r.code, r.message);
      const backup = deps.backup(p);
      deps.writeFileAtomic(p, r.text);
      // 先文件后运行时：文件写失败会抛出，运行时不动。
      let runtimeApplied = false;
      try {
        runtimeApplied = await deps.removeRuntime(name);
      } catch {
        runtimeApplied = false;
      }
      return { applied: true, runtimeApplied, backup };
    },

    async restore(opts: { token: string; confirm: true; backupPath?: string }): Promise<RuntimeMcpConfigResult> {
      const { path: p, text } = readCurrent();
      checkToken(text, opts.token);
      const backups = deps.listBackups ? deps.listBackups(p) : [];
      const backupPath = opts.backupPath ?? backups[0];
      if (!backupPath) {
        throw new McpConfigError('not_found', 'no backup available');
      }
      // 白名单：必须与配置文件同目录、文件名匹配 .bak-mafw-（先校验路径形状，再看存在性）
      const sameDir = backupPath.startsWith(p.replace(/[^\\/]+$/, ''));
      if (!sameDir || !/\.bak-mafw-\d+$/.test(backupPath)) {
        throw new McpConfigError('invalid', 'backupPath must be a .bak-mafw-* file next to the config');
      }
      if (!deps.exists(backupPath)) {
        throw new McpConfigError('not_found', 'backup not found');
      }
      const r = restoreServersSubtree(text, deps.readFile(backupPath));
      if (!r.ok) throw new McpConfigError('invalid', r.message);
      const currentBackup = deps.backup(p);
      deps.writeFileAtomic(p, r.text);
      // 全量运行时同步成本高：交给下一次 serve 重启；这里明确 runtimeApplied=false。
      return { applied: true, runtimeApplied: false, backup: currentBackup };
    },
  };
}
