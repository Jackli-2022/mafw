/**
 * 认知面声明式规则引擎（spec：2026-10-22-cognition-gate-rewrite-design.md §5.2）。
 *
 * gate/rewrite 两动词的驱动面：规则是**数据非代码**（match 正则 + 模板插值）——
 * 与 Claude hooks（shell 脚本）刻意分歧：无任意代码执行面，可审计可热重载。
 *
 * 纯函数全同步无 IO：
 * - validateRules：加载期校验（prompt+ask 拒绝 C6；坏正则跳过 C8）
 * - ruleMatches：on/tool/match 三级过滤（match 文本截 10KB——同步热路径无超时，
 *   护栏 + 责任面声明）
 * - evaluateGateRules：首条命中 → deny/ask/rewrite（transform 不进此枚举——
 *   input 门单独消费 evaluateTransformRule）
 * - applyRedact：text 部件变换、非文本部件（image 等）原样透传（C7——
 *   matplotlib/媒体结果防丢）
 */

export interface CognitionRule {
  on: 'tool_call' | 'prompt' | 'tool_result';
  tool?: string;
  match?: string;
  action: 'deny' | 'ask' | 'rewrite' | 'transform' | 'redact';
  reason?: string;
  input?: Record<string, string>;
  text?: string;
  name?: string;
}

export type GateDecision =
  | { decision: 'allow' }
  | { decision: 'deny'; reason?: string; rule?: string }
  | { decision: 'rewrite'; input: Record<string, unknown>; rule?: string }
  | { decision: 'ask'; reason?: string; rule?: string };

/** ReDoS 护栏（C8）：match 测试文本截 10KB——同步求值无超时，长度帽是唯一防线。 */
export const MATCH_TEXT_CAP = 10_240;

const VALID_ON = new Set(['tool_call', 'prompt', 'tool_result']);
const VALID_ACTION = new Set(['deny', 'ask', 'rewrite', 'transform', 'redact']);

/** 加载期校验：坏条目跳过 + error 有声（fail-open 但不静默）。 */
export function validateRules(raw: unknown): { valid: CognitionRule[]; errors: string[] } {
  const valid: CognitionRule[] = [];
  const errors: string[] = [];
  if (!Array.isArray(raw)) return { valid, errors: [] };
  for (let i = 0; i < raw.length; i++) {
    const entry = raw[i];
    if (!entry || typeof entry !== 'object') {
      errors.push(`rule[${i}]: not an object`);
      continue;
    }
    const r = entry as Record<string, unknown>;
    if (!VALID_ON.has(String(r.on))) {
      errors.push(`rule[${i}]: invalid on '${String(r.on)}'`);
      continue;
    }
    if (!VALID_ACTION.has(String(r.action))) {
      errors.push(`rule[${i}]: invalid action '${String(r.action)}'`);
      continue;
    }
    // C6：prompt+ask 无语义（pi 无 prompt 人工通道）——加载期拒绝
    if (r.on === 'prompt' && r.action === 'ask') {
      errors.push(`rule[${i}]: action 'ask' is not valid for on:'prompt' (no human channel for prompts)`);
      continue;
    }
    if (typeof r.match === 'string' && r.match.length > 0) {
      try {
        new RegExp(r.match);
      } catch (err: any) {
        errors.push(`rule[${i}]: bad regex '${r.match}': ${err?.message ?? err}`);
        continue;
      }
    }
    valid.push(entry as unknown as CognitionRule);
  }
  return { valid, errors };
}

/** 三级过滤：on → tool（缺省=全部）→ match（缺省=不过滤；文本截 MATCH_TEXT_CAP）。 */
export function ruleMatches(
  rule: CognitionRule,
  payload: { kind: CognitionRule['on']; tool?: string; text?: string },
): boolean {
  if (rule.on !== payload.kind) return false;
  if (rule.tool && rule.tool !== payload.tool) return false;
  if (rule.match) {
    const re = new RegExp(rule.match);
    const text = (payload.text ?? '').slice(0, MATCH_TEXT_CAP);
    if (!re.test(text)) return false;
  }
  return true;
}

/** {{field}} 插值：缺字段→空串（模板责任面：作者保证字段存在）。 */
export function interpolateTemplate(tpl: string, original: Record<string, unknown>): string {
  return tpl.replace(/\{\{(\w+)\}\}/g, (_, k: string) => String(original[k] ?? ''));
}

/** gate 决策（tool_call/prompt 的 deny/ask/rewrite）：首条命中；transform/redact 不在此枚举。 */
export function evaluateGateRules(
  rules: CognitionRule[],
  payload: { kind: 'tool_call' | 'prompt'; tool?: string; text?: string; input?: Record<string, unknown> },
): GateDecision | null {
  for (const rule of rules) {
    if (!ruleMatches(rule, payload)) continue;
    if (rule.action === 'deny') {
      return { decision: 'deny', ...(rule.reason ? { reason: rule.reason } : {}), ...(rule.name ? { rule: rule.name } : {}) };
    }
    if (rule.action === 'ask') {
      return { decision: 'ask', ...(rule.reason ? { reason: rule.reason } : {}), ...(rule.name ? { rule: rule.name } : {}) };
    }
    if (rule.action === 'rewrite') {
      const input: Record<string, unknown> = {};
      for (const [k, tpl] of Object.entries(rule.input ?? {})) {
        input[k] = interpolateTemplate(tpl, payload.input ?? {});
      }
      return { decision: 'rewrite', input, ...(rule.name ? { rule: rule.name } : {}) };
    }
    // transform/redact 不进 GateDecision（input 门 / tool_result 路径单独消费）
  }
  return null;
}

/** prompt transform 规则求值（input 门专用——不进 GateDecision 枚举）。 */
export function evaluateTransformRule(
  rules: CognitionRule[],
  payload: { text: string },
): { text: string; rule?: string } | null {
  for (const rule of rules) {
    if (rule.action !== 'transform') continue;
    if (!ruleMatches(rule, { kind: 'prompt', text: payload.text })) continue;
    const text = typeof rule.text === 'string'
      ? interpolateTemplate(rule.text, { text: payload.text })
      : payload.text;
    return { text, ...(rule.name ? { rule: rule.name } : {}) };
  }
  return null;
}

/** redact：text 部件变换、非文本部件原样透传（C7——图片防丢）。 */
export function applyRedact<T extends { type: string; text?: string; [k: string]: unknown }>(
  content: T[],
  redact: (s: string) => string,
): T[] {
  return content.map((part) =>
    part.type === 'text' && typeof part.text === 'string'
      ? { ...part, text: redact(part.text) }
      : part,
  );
}
