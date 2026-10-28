// gateway/src/runtime/mcp-jsonc.ts
// JSONC 保注释编辑（opencode 适配器内部使用）。
// - 用 jsonc-parser 的 parse/modify/applyEdits：保留注释、格式、其余键。
// - 覆盖 = 字段级合并（只改 type/url/command），headers/env/oauth/disabled 等默认保留。
// - type 变更必须显式 replace（避免悄悄丢掉整块字段）。
import { applyEdits, modify, parse, type ParseError, type FormattingOptions } from 'jsonc-parser';

export interface McpServerEditInput {
  name: string;
  type: 'remote' | 'local';
  url?: string;
  command?: string[];
  overwrite?: boolean;
  replace?: boolean;
}

export type ConfigParse =
  | { ok: true; servers: Record<string, any> }
  | { ok: false; error: { line: number; column: number; message: string } };

export type EditResult =
  | { ok: true; text: string; preserved: string[] }
  | { ok: false; code: 'exists' | 'type_mismatch' | 'invalid'; message: string };

export type RemoveResult =
  | { ok: true; text: string }
  | { ok: false; code: 'not_found' | 'invalid'; message: string };

export type RestoreResult =
  | { ok: true; text: string }
  | { ok: false; code: 'invalid'; message: string };

function lineColumn(text: string, offset: number): { line: number; column: number } {
  const before = text.slice(0, Math.max(0, offset));
  const lines = before.split(/\r?\n/);
  return { line: lines.length, column: (lines[lines.length - 1] ?? '').length + 1 };
}

function formatting(text: string): FormattingOptions {
  const indentMatch = text.match(/^([ \t]+)"/m);
  const indent = indentMatch?.[1] ?? '  ';
  return {
    insertSpaces: !indent.includes('\t'),
    tabSize: indent.includes('\t') ? 1 : indent.length,
    eol: text.includes('\r\n') ? '\r\n' : '\n',
  };
}

function parseValue(text: string): { ok: true; value: any } | { ok: false; error: ParseError } {
  const errors: ParseError[] = [];
  const value = parse(text, errors, { allowTrailingComma: true, disallowComments: false });
  if (errors.length > 0) return { ok: false, error: errors[0]! };
  return { ok: true, value };
}

export function parseConfig(text: string): ConfigParse {
  const parsed = parseValue(text);
  if (!parsed.ok) {
    const { line, column } = lineColumn(text, parsed.error.offset);
    return { ok: false, error: { line, column, message: `JSONC parse error (offset ${parsed.error.offset})` } };
  }
  const servers = parsed.value?.mcp?.servers;
  if (servers === undefined) return { ok: true, servers: {} };
  if (!servers || typeof servers !== 'object' || Array.isArray(servers)) {
    return { ok: false, error: { line: 1, column: 1, message: 'mcp.servers must be an object' } };
  }
  return { ok: true, servers: servers as Record<string, any> };
}

function applyModify(text: string, path: (string | number)[], value: any): string {
  return applyEdits(text, modify(text, path, value, { formattingOptions: formatting(text) }));
}

function preservedKeys(existing: any, submitted: Set<string>): string[] {
  const out: string[] = [];
  for (const key of Object.keys(existing ?? {})) {
    if (submitted.has(key)) continue;
    out.push(key);
  }
  return out;
}

export function editServer(text: string, input: McpServerEditInput): EditResult {
  const parsed = parseConfig(text);
  if (!parsed.ok) return { ok: false, code: 'invalid', message: parsed.error.message };
  const existing = parsed.servers[input.name] as any | undefined;
  if (existing !== undefined && !input.overwrite) {
    return { ok: false, code: 'exists', message: `server "${input.name}" already exists` };
  }
  if (existing && existing.type && existing.type !== input.type && !input.replace) {
    return { ok: false, code: 'type_mismatch', message: `server "${input.name}" type is ${existing.type}; pass replace:true to change it` };
  }

  let next: string;
  let preserved: string[] = [];

  if (input.type === 'remote' && !input.url) {
    return { ok: false, code: 'invalid', message: 'remote server requires url' };
  }
  if (input.type === 'local' && (!Array.isArray(input.command) || input.command.length === 0)) {
    return { ok: false, code: 'invalid', message: 'local server requires command' };
  }

  if (!existing || input.replace) {
    const cfg =
      input.type === 'remote'
        ? { type: 'remote', url: input.url }
        : { type: 'local', command: input.command };
    next = applyModify(text, ['mcp', 'servers', input.name], cfg);
  } else {
    // 字段级合并：只改本次提交的字段，其余原样保留。
    if (input.type === 'remote') {
      next = applyModify(text, ['mcp', 'servers', input.name, 'url'], input.url);
      preserved = preservedKeys(existing, new Set(['type', 'url']));
    } else {
      next = applyModify(text, ['mcp', 'servers', input.name, 'command'], input.command);
      preserved = preservedKeys(existing, new Set(['type', 'command']));
    }
  }

  const verify = parseConfig(next);
  if (!verify.ok) return { ok: false, code: 'invalid', message: verify.error.message };
  return { ok: true, text: next, preserved };
}

export function removeServerEntry(text: string, name: string): RemoveResult {
  const parsed = parseConfig(text);
  if (!parsed.ok) return { ok: false, code: 'invalid', message: parsed.error.message };
  if (parsed.servers[name] === undefined) {
    return { ok: false, code: 'not_found', message: `server "${name}" not found` };
  }
  const next = applyModify(text, ['mcp', 'servers', name], undefined);
  const verify = parseConfig(next);
  if (!verify.ok) return { ok: false, code: 'invalid', message: verify.error.message };
  return { ok: true, text: next };
}

export function restoreServersSubtree(currentText: string, backupText: string): RestoreResult {
  const current = parseConfig(currentText);
  if (!current.ok) return { ok: false, code: 'invalid', message: current.error.message };
  const backup = parseConfig(backupText);
  if (!backup.ok) return { ok: false, code: 'invalid', message: backup.error.message };
  const next = applyModify(currentText, ['mcp', 'servers'], backup.servers);
  const verify = parseConfig(next);
  if (!verify.ok) return { ok: false, code: 'invalid', message: verify.error.message };
  return { ok: true, text: next };
}

const SECRET_KEY = /token|secret|password|api[-_]?key|authorization/i;

/** 递归掩码敏感值：headers/environment 的全部值 + key 名含 token/secret/password/apiKey/authorization。 */
export function maskSecrets(value: any, key?: string): any {
  if (key && (key === 'headers' || key === 'environment' || key === 'env')) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return Object.fromEntries(Object.keys(value).map((k) => [k, '••••']));
    }
  }
  if (key && SECRET_KEY.test(key) && typeof value === 'string') return '••••';
  if (Array.isArray(value)) return value.map((v) => maskSecrets(v));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, maskSecrets(v, k)]));
  }
  return value;
}

/** 简单行级 diff（LCS），仅用于 preview 展示。 */
export function renderDiff(before: string, after: string): string {
  const a = before.split(/\r?\n/);
  const b = after.split(/\r?\n/);
  const n = a.length;
  const m = b.length;
  // LCS 长度表（文件通常很小；上限保护）
  if (n * m > 4_000_000) {
    return `--- before\n${before}\n+++ after\n${after}`;
  }
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const out: string[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push(` ${a[i]}`);
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      out.push(`-${a[i]}`);
      i++;
    } else {
      out.push(`+${b[j]}`);
      j++;
    }
  }
  while (i < n) out.push(`-${a[i++]}`);
  while (j < m) out.push(`+${b[j++]}`);
  return out.join('\n');
}
