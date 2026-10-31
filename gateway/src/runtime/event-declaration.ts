/**
 * 事件声明矩阵 —— 「插件声明了什么事件翻译」的唯一判定源。
 *
 * 供三处共用：
 *   - loader（文件插件扫描期）
 *   - index.ts（激活期降级）
 *   - plugin-check（离线检查器）
 *
 * 语义（spec 2026-10-31-runtime-plugin-ergonomics-design §4.1）：
 *   declared（推荐）= 插件导出 eventSource/eventMappings/transformEvent，gateway 真执行器翻译；
 *   self（逃逸）    = 插件自己翻译成 canonical 再推总线，显式签名画押，不降级但会被标注。
 */
import type { RuntimeCapabilities } from './contract';
import { hasEventDeclarations, type EventMappingEntry } from './event-mapper';

export type EventTranslationMode = 'declared' | 'self';

export interface EventDeclarationResolution {
  mode: EventTranslationMode;
  eventStream: boolean;
  issues: string[];
}

export function resolveEventDeclaration(
  caps: Pick<RuntimeCapabilities, 'eventStream'>,
  entry: EventMappingEntry,
): EventDeclarationResolution {
  const hasDeclarations = hasEventDeclarations(entry);
  const issues: string[] = [];
  let mode: EventTranslationMode = entry.eventTranslation === 'self' ? 'self' : 'declared';

  // 矛盾声明：self 与映射/transform 同时存在 —— declared 胜出（映射照常生效），
  // 作者必须删掉其中一个（静默忽略任何一侧都会制造双重翻译或死配置）。
  if (mode === 'self' && hasDeclarations) {
    issues.push('eventTranslation self contradicts eventMappings/transformEvent — declared wins (remove one)');
    mode = 'declared';
  }

  let eventStream = !!caps.eventStream;
  // default-deny 前置：声明 eventStream 却没有任何翻译声明（且未显式 self）= 原生流会被整条拦截。
  if (eventStream && !hasDeclarations && mode !== 'self') {
    eventStream = false;
    issues.push(
      'eventStream capability declared but no eventMappings/transformEvent — ' +
      'default-deny would drop the entire native stream; capability downgraded',
    );
  }

  // 交叉校验（loader / plugin-check 同源，code review I6）：声明面与能力位互相矛盾。
  const declaredStream = !!caps.eventStream;
  const hasMappings = (entry.eventMappings?.length ?? 0) > 0;
  if (hasMappings && !declaredStream) {
    issues.push('eventMappings declared but capabilities.eventStream is false — mappings never applied');
  }
  if (entry.transformEvent && !declaredStream) {
    issues.push('transformEvent declared but capabilities.eventStream is false — never invoked');
  }
  if (entry.eventSource && !hasMappings && !entry.transformEvent) {
    issues.push('eventSource declared but neither eventMappings nor transformEvent — dead config');
  }

  return { mode, eventStream, issues };
}
