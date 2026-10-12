/**
 * 插件事件映射执行器 —— 原生事件 → canonical 事件（纯数据表驱动）。
 * 设计：docs/superpowers/specs/2026-10-08-event-mapping-registration-design.md
 * 匹配优先级：eventMappings（数组顺序）→ canonical 直发 passthrough → transformEvent → 丢弃+遥测。
 */
import { getPath, evalConditions, renderTemplate, setPath, Condition } from './path-expr';

export type FieldValue =
  | { path: string; default?: unknown }
  | { const: unknown }
  | { template: string };

export interface EventMapping {
  from: string | string[];
  /** canonical 类型，或 'drop' 显式丢弃 */
  to: string;
  when?: Condition[];
  /**
   * 整段透传原语：输出 properties 从该路径对象深拷贝起步，`fields` 在其上覆写。
   * 用于「改类型名 + 保留富载荷」（如 opencode message.part.updated → part.updated）：
   * fields 逐字段枚举在富载荷上不可维护。
   */
  passProperties?: string;
  fields?: Record<string, FieldValue>;
}

export interface EventSourceShape {
  typePath: string;
  /** 多路径回退（取首个 truthy）——sessionID 的承载位置因事件而异时用数组。 */
  sessionIdPath?: string | string[];
  directoryPath?: string;
}

export type TransformEventFn = (raw: any) => any | any[] | null;

export interface EventMappingEntry {
  eventSource?: EventSourceShape;
  eventMappings?: EventMapping[];
  transformEvent?: TransformEventFn;
}

/** sessionID 注入约定：与 pi 现状输出逐字节对齐（part.updated 进 part，其余进 properties）。 */
const SESSION_ID_TARGETS: Record<string, 'part' | 'properties'> = {
  'part.updated': 'part',
};

function evalField(v: FieldValue, raw: any): unknown {
  if ('const' in v) return v.const;
  if ('template' in v) return renderTemplate(v.template, raw);
  const got = getPath(raw, v.path);
  return got ?? v.default; // nullish 语义（对齐 pi 现状 delta ?? ''）
}

export function applyEventMappings(
  raw: any,
  entry: EventMappingEntry,
  isCanonicalType: (t: string) => boolean,
  onUnknown?: (t: string) => void,
): any[] {
  const source = entry.eventSource;
  const nativeType: unknown = source ? getPath(raw, source.typePath) : undefined;
  // 已 canonical 信封（如 pi push 的 permission.asked）或畸形事件 → 原样透传，
  // 下游 normalize/畸形诊断各自处理。
  if (typeof nativeType !== 'string' || !nativeType) return [raw];

  const sidPaths = !source?.sessionIdPath
    ? []
    : Array.isArray(source.sessionIdPath) ? source.sessionIdPath : [source.sessionIdPath];
  const sessionID = sidPaths.map((p) => getPath(raw, p)).find((v) => v) as string | undefined;
  const directory = source?.directoryPath ? getPath(raw, source.directoryPath) : undefined;

  for (const m of entry.eventMappings ?? []) {
    const froms = Array.isArray(m.from) ? m.from : [m.from];
    if (!froms.includes(nativeType)) continue;
    if (!evalConditions(m.when, raw)) continue;
    if (m.to === 'drop') return [];
    let properties: Record<string, any> = {};
    if (m.passProperties) {
      const src = getPath(raw, m.passProperties);
      if (src && typeof src === 'object') {
        // 深拷贝防 aliasing：输出事件与 raw 输入不共享可变子树。
        properties = JSON.parse(JSON.stringify(src)) as Record<string, any>;
      }
    }
    for (const [key, fv] of Object.entries(m.fields ?? {})) {
      const v = evalField(fv, raw);
      if (v !== undefined) setPath(properties, key, v); // 路径不存在 → 字段不创建
    }
    if (typeof sessionID === 'string' && sessionID) {
      if (SESSION_ID_TARGETS[m.to] === 'part') {
        if (properties.part && properties.part.sessionID === undefined) properties.part.sessionID = sessionID;
      } else if (properties.sessionID === undefined) {
        properties.sessionID = sessionID;
      }
    }
    return [{ payload: { type: m.to, properties }, sessionID: sessionID as any, directory: directory as any }];
  }

  if (isCanonicalType(nativeType)) return [raw]; // 插件直发 canonical 类型

  if (entry.transformEvent) {
    const out = entry.transformEvent(raw);
    if (out === null || out === undefined) return [];
    return Array.isArray(out) ? out : [out];
  }

  onUnknown?.(nativeType);
  return [];
}

export function validateEventMappings(entry: EventMappingEntry, canonicalTypes: ReadonlySet<string>): string[] {
  const issues: string[] = [];
  if (entry.eventMappings && entry.eventMappings.length > 0 && !entry.eventSource?.typePath) {
    issues.push('eventMappings declared but eventSource.typePath is missing');
  }
  if (entry.eventSource) {
    for (const [k, p] of Object.entries({
      typePath: entry.eventSource.typePath,
      sessionIdPath: entry.eventSource.sessionIdPath,
      directoryPath: entry.eventSource.directoryPath,
    })) {
      const paths = Array.isArray(p) ? p : [p];
      for (const pp of paths) {
        if (pp !== undefined && !/^\$/.test(pp)) issues.push(`eventSource.${k}: bad path '${pp}' (must start with '$')`);
      }
    }
  }
  for (const m of entry.eventMappings ?? []) {
    if (!m.from || (Array.isArray(m.from) && m.from.length === 0)) issues.push(`mapping to '${m.to}': empty from`);
    if (m.to !== 'drop' && !canonicalTypes.has(m.to)) issues.push(`mapping '${m.from}' → unknown canonical type '${m.to}'`);
    if (m.passProperties !== undefined && !/^\$/.test(m.passProperties)) {
      issues.push(`mapping '${m.from}': bad passProperties path '${m.passProperties}' (must start with '$')`);
    }
    for (const [key, fv] of Object.entries(m.fields ?? {})) {
      if ('path' in fv && !/^\$/.test(fv.path)) issues.push(`mapping '${m.from}' field '${key}': bad path '${fv.path}'`);
      if ('template' in fv && !/\{\$[^}]*\}/.test(fv.template)) issues.push(`mapping '${m.from}' field '${key}': template has no interpolation`);
    }
    for (const c of m.when ?? []) {
      if (!/^\$/.test(c.path)) issues.push(`mapping '${m.from}' when: bad path '${c.path}'`);
    }
  }
  return issues;
}

/**
 * 包装 runtime.global.event()：原生流在此过翻译表（v2 强制接线——不再有
 * 「免翻译特权」；无声明的 runtime 恒等透传 + onNoMappings 警告一次）。
 * 声明了 eventMappings/transformEvent 的 runtime，其原生流映射为 canonical。
 */
export function wrapGlobalEventStream(
  rt: any,
  entry: EventMappingEntry,
  isCanonicalType: (t: string) => boolean,
  onUnknown?: (t: string) => void,
  onNoMappings?: () => void,
): void {
  const hasDeclarations = (entry.eventMappings?.length ?? 0) > 0 || !!entry.transformEvent;
  if (!hasDeclarations) onNoMappings?.();
  const orig = rt.global.event.bind(rt.global);
  rt.global.event = async () => {
    const result = await orig();
    const stream = result?.stream ?? result;
    if (!stream || typeof stream[Symbol.asyncIterator] !== 'function') return result;
    const mapped = (async function* () {
      for await (const raw of stream) {
        for (const evt of applyEventMappings(raw, entry, isCanonicalType, onUnknown)) yield evt;
      }
    })();
    return result?.stream ? { ...result, stream: mapped } : mapped;
  };
}
