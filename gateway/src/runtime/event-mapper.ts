/**
 * 插件事件映射执行器 —— 原生事件 → canonical 事件（纯数据表驱动）。
 * 设计：docs/superpowers/specs/2026-10-08-event-mapping-registration-design.md（B1 rev2 起强制 default-deny）
 * 匹配优先级：eventMappings（数组序，含 drop 行与 canonicalIdentity() 恒等行）→ transformEvent → 拦截+计数。
 *
 * Plan 6 Task 2：纯映射执行器已迁至 `@mafw/runtime-core`（`event-mapping.ts`），
 * 本模块只保留 gateway-only 的两件事：
 *  - canonical 词汇注入（MAFW 事件面 ∪ 工具三原语，单源在本仓库 gateway 词汇表）；
 *  - `wrapGlobalEventStream`（runtime.global.event 包装，依赖 gateway 加载期语义）。
 */
import {
  applyEventMappings,
  canonicalIdentity as coreCanonicalIdentity,
  canonicalTypeSet as coreCanonicalTypeSet,
} from '@mafw/runtime-core';
import type { EventMappingEntry, EventMapping, TranslationHooks } from '@mafw/runtime-core';
import { MAFW_RUNTIME_EVENT_NAMES } from './mafw-vocabulary';
import { TOOL_PRIMITIVE_TYPES } from './tool-part-assembler';

export {
  applyEventMappings,
  validateEventMappings,
  hasEventDeclarations,
} from '@mafw/runtime-core';
export type {
  EventMapping,
  EventSourceShape,
  TransformEventFn,
  TranslationHooks,
  EventMappingEntry,
  RawRuntimeEvent,
  FieldValue,
} from '@mafw/runtime-core';

/** gateway 侧入口恒等翻译词汇：MAFW 事件面（= SDK RUNTIME_EVENT_TYPES）∪ 工具三原语。 */
export const RUNTIME_IDENTITY_TYPES: readonly string[] = [
  ...MAFW_RUNTIME_EVENT_NAMES,
  ...TOOL_PRIMITIVE_TYPES,
];

/**
 * gateway 词汇版恒等翻译行（默认参数 = 契约 AdapterEvent 面，gateway 必须显式注入
 * 完整 MAFW 词汇：`part.complete` / `task.updated` / `session.config` 等不在 AdapterEvent ABI 内）。
 */
export function canonicalIdentity(passProperties?: string): EventMapping[] {
  return coreCanonicalIdentity(passProperties, RUNTIME_IDENTITY_TYPES);
}

/** gateway 词汇版 canonical 集合（plugin-check 的 canonical `to` 校验用）。 */
export function canonicalTypeSet(): ReadonlySet<string> {
  return coreCanonicalTypeSet(RUNTIME_IDENTITY_TYPES);
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
