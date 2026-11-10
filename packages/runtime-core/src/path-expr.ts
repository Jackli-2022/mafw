/**
 * 裁剪 JSONPath 子集求值器 —— 事件映射表/facet 规则表共用。
 * 仅点号段 + 数组下标；无 eval、无脚本表达式（表达式价值 = 可被宿主静态校验，
 * eval 一开此价值归零——同进程可信插件下这不是安全问题是可分析性问题）。
 */

/** 纯数据条件。equals 与 exists 二选一；exists = truthy 检查（对齐现状 `||` 语义）。 */
export interface Condition {
  path: string;
  equals?: unknown;
  exists?: true;
}

const PATH_RE = /^\$(\.[A-Za-z_][A-Za-z0-9_-]*|\[\d+\])*$/;
const SEG_RE = /\.[A-Za-z_][A-Za-z0-9_-]*|\[\d+\]/g;

export function isValidPath(p: string): boolean {
  return typeof p === 'string' && PATH_RE.test(p);
}

export function getPath(obj: unknown, path: string): unknown {
  if (!isValidPath(path)) return undefined;
  const segs = path.slice(1).match(SEG_RE) ?? [];
  let cur: any = obj;
  for (const s of segs) {
    if (cur === null || cur === undefined) return undefined;
    cur = s[0] === '.' ? cur[s.slice(1)] : cur[Number(s.slice(1, -1))];
  }
  return cur;
}

export function evalConditions(conds: Condition[] | undefined, raw: unknown): boolean {
  if (!conds || conds.length === 0) return true;
  for (const c of conds) {
    const v = getPath(raw, c.path);
    if (c.exists === true) {
      if (!v) return false;
    } else if ('equals' in c) {
      if (v !== c.equals) return false;
    } else {
      return false; // 畸形条件（加载期校验应已拦截）
    }
  }
  return true;
}

const TPL_RE = /\{(\$[^}]*)\}/g;

/** EventBridge 式模板：'pi_step_{$.sessionID}'。任一插值路径不存在 → undefined。 */
export function renderTemplate(tpl: string, raw: unknown): string | undefined {
  let missing = false;
  const out = tpl.replace(TPL_RE, (_m, p: string) => {
    const v = getPath(raw, p);
    if (v === undefined || v === null) { missing = true; return ''; }
    return String(v);
  });
  return missing ? undefined : out;
}

/** fields 构造目标写入（仅点号段，无下标——构造场景不需要数组）。 */
export function setPath(obj: Record<string, any>, dottedKey: string, value: unknown): void {
  const segs = dottedKey.split('.');
  let cur = obj;
  for (let i = 0; i < segs.length - 1; i++) {
    if (typeof cur[segs[i]] !== 'object' || cur[segs[i]] === null) cur[segs[i]] = {};
    cur = cur[segs[i]];
  }
  cur[segs[segs.length - 1]] = value;
}
