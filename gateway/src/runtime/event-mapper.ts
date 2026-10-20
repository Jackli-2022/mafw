/**
 * 插件事件映射执行器 —— 原生事件 → canonical 事件（纯数据表驱动）。
 * 设计：docs/superpowers/specs/2026-10-08-event-mapping-registration-design.md（B1 rev2 起强制 default-deny）
 * 匹配优先级：eventMappings（数组序，含 drop 行与 canonicalIdentity() 恒等行）→ transformEvent → 拦截+计数。
 */
import { getPath, evalConditions, renderTemplate, setPath, Condition } from './path-expr';
import { MAFW_RUNTIME_EVENT_NAMES } from './mafw-vocabulary';
import { TOOL_PRIMITIVE_TYPES } from './tool-part-assembler';

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

/** 翻译执行 hooks（B1/B2/B3 可观测面；全部可选、fail-open）。 */
export interface TranslationHooks {
  /** 未命中任何注册翻译（词汇漂移/漏声明——监控信号，进 unmatched 计数）。 */
  onUnmatched?: (type: string) => void;
  /** 声明式压制：drop 行命中 / transformEvent 显式返回 null（作者意图，单独计）。 */
  onSuppressed?: (type: string) => void;
  /** transformEvent 抛错或输出非法形状（B2 守卫接入）。 */
  onTranslationError?: (raw: any, reason: string) => void;
}

export interface EventMappingEntry {
  eventSource?: EventSourceShape;
  eventMappings?: EventMapping[];
  transformEvent?: TransformEventFn;
}

/** 入口恒等翻译词汇：runtime 契约事件面（= SDK RUNTIME_EVENT_TYPES）∪ 工具三原语。 */
export const RUNTIME_IDENTITY_TYPES: readonly string[] = [
  ...MAFW_RUNTIME_EVENT_NAMES,
  ...TOOL_PRIMITIVE_TYPES,
];

/**
 * 词汇单源派生的恒等翻译行（B1 identity 声明）。
 * 恒等行 = 「该类型已注册翻译，翻译是恒等」——default-deny 下同名事件经此放行；
 * 词汇表加新类型自动覆盖（契约内类型即放行），runtime 私货类型被拦逼显式注册。
 * passProperties 传 runtime 信封的 properties 路径（opencode '$.payload.properties'）。
 */
export function canonicalIdentity(passProperties?: string): EventMapping[] {
  return RUNTIME_IDENTITY_TYPES.map((t) => ({
    from: t,
    to: t,
    ...(passProperties ? { passProperties } : {}),
  }));
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
  hooks?: TranslationHooks,
): any[] {
  const source = entry.eventSource;
  const nativeType: unknown = source ? getPath(raw, source.typePath) : undefined;
  if (typeof nativeType !== 'string' || !nativeType) {
    // typePath 不可解析：信封形态（pi 已翻译流）或畸形事件。
    // 信封 canonical（含工具三原语）→ 放行（已声明翻译的产物）；未知类型 → 入口拦截；
    // 畸形（无可解析类型）→ 原样透传给下游畸形诊断（isMalformedEvent）。
    const envelopeType = typeof raw?.payload?.type === 'string' ? raw.payload.type : '';
    if (!envelopeType) return [raw];
    if (isCanonicalType(envelopeType)) return [raw];
    hooks?.onUnmatched?.(envelopeType);
    return [];
  }

  const sidPaths = !source?.sessionIdPath
    ? []
    : Array.isArray(source.sessionIdPath) ? source.sessionIdPath : [source.sessionIdPath];
  const sessionID = sidPaths.map((p) => getPath(raw, p)).find((v) => v) as string | undefined;
  const directory = source?.directoryPath ? getPath(raw, source.directoryPath) : undefined;

  for (const m of entry.eventMappings ?? []) {
    const froms = Array.isArray(m.from) ? m.from : [m.from];
    if (!froms.includes(nativeType)) continue;
    if (!evalConditions(m.when, raw)) continue;
    if (m.to === 'drop') {
      hooks?.onSuppressed?.(nativeType);
      return [];
    }
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

  // canonical 直发分支已删除（B1 default-deny）：同名收编经 canonicalIdentity() 恒等行。
  if (entry.transformEvent) {
    const out = entry.transformEvent(raw);
    if (out === null || out === undefined) {
      hooks?.onSuppressed?.(nativeType);
      return [];
    }
    return Array.isArray(out) ? out : [out];
  }

  hooks?.onUnmatched?.(nativeType);
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

/** 是否携带任何翻译声明（映射行或 transformEvent）——无声明 runtime 在 default-deny 下原生流全灭。 */
export function hasEventDeclarations(entry: EventMappingEntry): boolean {
  return (entry.eventMappings?.length ?? 0) > 0 || !!entry.transformEvent;
}

/**
 * 包装 runtime.global.event()：原生流在此过翻译表（v2 强制接线）。
 * 匹配优先级：eventMappings（数组序，含 identity/drop 行）→ transformEvent → 拦截+计数
 * （B1 default-deny——canonical 直发分支已删除，同名收编经 canonicalIdentity() 恒等行；
 * 无声明的 runtime 由加载期 eventStream 降级拦截，onNoMappings 为运行时兜底信号）。
 */
export function wrapGlobalEventStream(
  rt: any,
  entry: EventMappingEntry,
  isCanonicalType: (t: string) => boolean,
  hooks?: TranslationHooks & { onNoMappings?: () => void },
): void {
  const hasDeclarations = (entry.eventMappings?.length ?? 0) > 0 || !!entry.transformEvent;
  if (!hasDeclarations) hooks?.onNoMappings?.();
  const orig = rt.global.event.bind(rt.global);
  rt.global.event = async () => {
    const result = await orig();
    const stream = result?.stream ?? result;
    if (!stream || typeof stream[Symbol.asyncIterator] !== 'function') return result;
    const mapped = (async function* () {
      for await (const raw of stream) {
        for (const evt of applyEventMappings(raw, entry, isCanonicalType, hooks)) yield evt;
      }
    })();
    return result?.stream ? { ...result, stream: mapped } : mapped;
  };
}
