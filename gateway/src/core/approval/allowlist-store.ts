import { ApprovalCandidate, commandTextOf } from './safety-classifier';

export interface AllowlistEntry { tool: string; prefix?: string }

export interface AllowlistStoreDeps {
  /** 懒读 config（经 config.raw 保证 watcher 热生效）；非数组 fail-open 当空表 */
  readRawAllowlist(): unknown;
  /** config.persistOverrides —— deepMerge 对数组整组替换 */
  persist(overrides: Record<string, any>): { changed: string[] };
}

export function parseEntry(raw: string): AllowlistEntry | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  const idx = s.indexOf(':');
  if (idx === -1) return { tool: s };
  if (idx === 0) return null; // 空 tool（":x"）无效
  const tool = s.slice(0, idx).trim();
  const prefix = s.slice(idx + 1).trim().replace(/\*+$/, '').trim();
  if (!tool) return null;
  return prefix ? { tool, prefix } : { tool };
}

export class AllowlistStore {
  constructor(private deps: AllowlistStoreDeps) {}

  private rawList(): string[] {
    const raw = this.deps.readRawAllowlist();
    return Array.isArray(raw) ? raw.map((x) => String(x)) : [];
  }

  list(): AllowlistEntry[] {
    return this.rawList().map(parseEntry).filter((e): e is AllowlistEntry => !!e);
  }

  add(entry: AllowlistEntry): { ok: boolean; entries: AllowlistEntry[] } {
    if (!entry?.tool || typeof entry.tool !== 'string') return { ok: false, entries: this.list() };
    const raw = this.rawList();
    const serialized = entry.prefix ? `${entry.tool}:${entry.prefix}` : entry.tool;
    if (raw.includes(serialized)) return { ok: true, entries: this.list() };
    raw.push(serialized);
    this.deps.persist({ approval: { allowlist: raw } });
    return { ok: true, entries: this.list() };
  }

  remove(entry: AllowlistEntry): { ok: boolean; entries: AllowlistEntry[] } {
    const raw = this.rawList();
    const serialized = entry.prefix ? `${entry.tool}:${entry.prefix}` : entry.tool;
    const next = raw.filter((e) => e !== serialized);
    if (next.length === raw.length) return { ok: false, entries: this.list() };
    this.deps.persist({ approval: { allowlist: next } });
    return { ok: true, entries: this.list() };
  }

  matches(toolName: string, candidate: ApprovalCandidate): boolean {
    return this.list().some((e) => {
      if (e.tool.toLowerCase() !== toolName.toLowerCase()) return false;
      if (!e.prefix) return true;
      const prefix = e.prefix.toLowerCase();
      const text = commandTextOf(candidate).toLowerCase();
      const patterns = candidate.patterns.map((p) => p.toLowerCase().replace(/\*+$/, ''));
      return text.startsWith(prefix) || patterns.some((p) => p.startsWith(prefix));
    });
  }
}
