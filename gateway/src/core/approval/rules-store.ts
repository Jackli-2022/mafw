// 持久审批规则（spec 切片 1）：~/.mafw/permission-rules.json，条目 {tool, pattern?, action}。
// 取代 config.yaml approval.allowlist 成为规则唯一存储（过渡期 evaluate 双读，
// 接线在 index.ts）。fail-open：文件缺失/损坏 → 空表（宁可多问，不静默放行）。
import * as fs from 'fs';
import * as path from 'path';
import { ApprovalCandidate, commandTextOf } from './safety-classifier';

export interface PermissionRule { tool: string; pattern?: string; action: 'allow' }

function fileOf(dir: string): string { return path.join(dir, 'permission-rules.json'); }

function sameRule(a: PermissionRule, b: PermissionRule): boolean {
  return a.tool === b.tool && (a.pattern ?? '') === (b.pattern ?? '') && a.action === b.action;
}

export class PermissionRulesStore {
  constructor(private dir: string) {}

  private read(): PermissionRule[] {
    try {
      const raw = JSON.parse(fs.readFileSync(fileOf(this.dir), 'utf8'));
      const rules = Array.isArray(raw?.rules) ? raw.rules : [];
      return rules.filter((r: any) => r && typeof r.tool === 'string' && r.tool.trim()
        && (r.pattern === undefined || typeof r.pattern === 'string')
        && r.action === 'allow') as PermissionRule[];
    } catch { return []; }
  }

  private write(rules: PermissionRule[]): void {
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      const tmp = fileOf(this.dir) + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify({ rules }, null, 2));
      fs.renameSync(tmp, fileOf(this.dir));
    } catch { /* fail-open：写失败不抛，调用方可重读内存态 */ }
  }

  list(): PermissionRule[] { return this.read(); }

  add(rule: PermissionRule): { ok: boolean; rules: PermissionRule[] } {
    if (!rule?.tool || typeof rule.tool !== 'string' || rule.action !== 'allow') {
      return { ok: false, rules: this.list() };
    }
    const clean: PermissionRule = rule.pattern
      ? { tool: rule.tool, pattern: rule.pattern, action: 'allow' }
      : { tool: rule.tool, action: 'allow' };
    const rules = this.read();
    if (rules.some((r) => sameRule(r, clean))) return { ok: true, rules };
    rules.push(clean);
    this.write(rules);
    return { ok: true, rules };
  }

  remove(rule: PermissionRule): { ok: boolean; rules: PermissionRule[] } {
    const rules = this.read();
    const next = rules.filter((r) => !sameRule(r, rule));
    if (next.length === rules.length) return { ok: false, rules };
    this.write(next);
    return { ok: true, rules: next };
  }

  matches(toolName: string, candidate: ApprovalCandidate): boolean {
    return this.read().some((e) => {
      if (e.tool.toLowerCase() !== toolName.toLowerCase()) return false;
      if (!e.pattern) return true;
      const prefix = e.pattern.toLowerCase().replace(/\*+$/, '');
      const text = commandTextOf(candidate).toLowerCase();
      const patterns = candidate.patterns.map((p) => p.toLowerCase().replace(/\*+$/, ''));
      return text.startsWith(prefix) || patterns.some((p) => p.startsWith(prefix));
    });
  }
}

/** 'always' 审批 → 规则（纯函数）。scope true = 旧行为（prefix 优先）；'tool' = 裸工具名。 */
export function deriveAlwaysRule(
  found: { permission?: string; toolName?: string; patterns?: string[] },
  scope: 'tool' | 'prefix' | true,
): PermissionRule | null {
  const tool = String(found?.permission ?? found?.toolName ?? '').trim();
  if (!tool) return null;
  const firstPattern = Array.isArray(found?.patterns) ? String(found.patterns[0] ?? '').trim() : '';
  const prefix = firstPattern.replace(/\*+$/, '').trim();
  if (scope === 'tool' || !prefix) return { tool, action: 'allow' };
  return { tool, pattern: prefix, action: 'allow' };
}
