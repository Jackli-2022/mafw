/**
 * opencode 原生消息 → MAFW View DTO 的**规范字段生产者**（history / live 共用）。
 *
 * spec: docs/superpowers/specs/2026-11-02-runtime-experience-full-migration-design.md §5.2
 *
 * opencode 的原生载体与规范字段不同名：
 *  - assistant 模型：`modelID` + `providerID`（+ `variant`）→ `model { providerID, modelID, variant? }`
 *  - 回合终态：`finish`（原生 finish）→ `stopReason`（`contract.stopReasonOf`）
 *  - 错误：`error { name, data:{ message } }` → `error { kind, message }`
 *    （`kind` 为中性分类；不得让 UI 依赖原生类名判中止）
 *  - 工具结果：历史 `state.content[]`（无 `state.output`）→ `state.output`
 *
 * 约定：
 *  - 只**补齐**规范字段，原生字段（`modelID`/`providerID`/`finish`/`state.content`）
 *    在过渡期原样保留（诊断与 trajectory 仍读取；不属于 wire 兼容 shim）。
 *  - `error` 是唯一被替换的键（原生与规范不能共存）：规范形写入 flat。
 *  - 零拷贝：部件列表只在工具部件真正补齐时新建；消息字段值已等价时返回
 *    **原对象引用**（重复归一不产生新对象——见 `canonicalMessage`）。
 */
import { stopReasonOf } from './contract';
import { canonicalError, errorKindOf } from './canonical-error';
import type { MafwMessageError, MafwModelRef, StopReason } from './canonical-types';

// 错误归一实现已下沉到中性文件（`events/event-log-migrate.ts` 也要用，业务层不依赖
// adapter 模块）；这里原样再导出，保持既有导入路径与语义不变。
export { canonicalError, errorKindOf, errorTextOf, isCanonicalError } from './canonical-error';
export type { MafwErrorKind } from './canonical-error';

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** assistant 模型引用：原生 `providerID`+`modelID`（或已有 `model` 对象）。 */
export function assistantModelOf(info: any): MafwModelRef | undefined {
  if (!info || typeof info !== 'object') return undefined;
  const providerID = asString(info.providerID) || asString(info.model?.providerID);
  const modelID = asString(info.modelID) || asString(info.model?.modelID) || asString(info.model?.id);
  if (!providerID || !modelID) return undefined;
  const variant = asString(info.variant) || asString(info.model?.variant);
  return { providerID, modelID, ...(variant ? { variant } : {}) };
}

/** 回合终态：已有规范值 → 原生 `finish` → 错误兜底。 */
export function canonicalStopReason(info: any): StopReason | undefined {
  if (!info || typeof info !== 'object') return undefined;
  if (typeof info.stopReason === 'string' && info.stopReason) return info.stopReason as StopReason;
  if (typeof info.finish === 'string' && info.finish) return stopReasonOf(info.finish);
  if (info.error) return errorKindOf(info.error) === 'abort' ? 'cancelled' : 'error';
  return undefined;
}

/** 规范 assistant 字段（非 assistant / 无可补字段 → `{}`）。 */
export interface CanonicalMessageFields {
  model?: MafwModelRef
  stopReason?: StopReason
  error?: MafwMessageError
}

export function canonicalMessageFields(info: any): CanonicalMessageFields {
  if (!info || typeof info !== 'object' || info.role !== 'assistant') return {};
  const model = assistantModelOf(info);
  const stopReason = canonicalStopReason(info);
  const error = canonicalError(info.error);
  return {
    ...(model ? { model } : {}),
    ...(stopReason ? { stopReason } : {}),
    ...(error ? { error } : {}),
  };
}

/** 工具结果文本：`state.output` 优先，历史 `state.content[]` 兜底。 */
export function toolStateOutput(state: any): string | undefined {
  if (!state || typeof state !== 'object') return undefined;
  if (typeof state.output === 'string' && state.output) return state.output;
  if (!Array.isArray(state.content)) return undefined;
  const text = state.content
    .filter((p: any) => p && typeof p.text === 'string')
    .map((p: any) => p.text as string)
    .join('\n');
  return text.trim() ? text : undefined;
}

/** 工具部件规范形：补 `state.output`（已有 output 时返回原引用）。 */
export function canonicalToolPart(part: any): any {
  if (!part || typeof part !== 'object' || part.type !== 'tool') return part;
  const state = part.state;
  if (!state || typeof state !== 'object') return part;
  if (typeof state.output === 'string' && state.output) return part;
  const output = toolStateOutput(state);
  if (output === undefined) return part;
  return { ...part, state: { ...state, output } };
}

/** 部件列表规范形：无改动时返回原数组引用（零拷贝不变量）。 */
export function canonicalParts(parts: any): any {
  if (!Array.isArray(parts)) return parts;
  let changed = false;
  const out = parts.map((part) => {
    const next = canonicalToolPart(part);
    if (next !== part) changed = true;
    return next;
  });
  return changed ? out : parts;
}

/**
 * 消息规范形（history / live 共用）：补 assistant 规范字段 + 工具 output。
 *
 * 零拷贝：字段值已等价时不重写（`stopReason` 值比较、`model`/`error` 逐字段
 * 比较），零件无变化时保留原数组引用；两者都无变化 → 返回**原对象引用**
 * （重复归一 / facade 救回路径不产生新对象）。
 */
function sameModelRef(a: any, b: MafwModelRef | undefined): boolean {
  if (!b) return true;
  return a?.providerID === b.providerID && a?.modelID === b.modelID && (a?.variant ?? '') === (b.variant ?? '');
}

function sameMessageError(a: any, b: MafwMessageError | undefined): boolean {
  if (!b) return true;
  return a?.kind === b.kind && a?.message === b.message;
}

function hasSameFields(message: any, fields: CanonicalMessageFields): boolean {
  if (!sameModelRef(message.model, fields.model)) return false;
  if (fields.stopReason && message.stopReason !== fields.stopReason) return false;
  if (!sameMessageError(message.error, fields.error)) return false;
  return true;
}

export function canonicalMessage(message: any): any {
  if (!message || typeof message !== 'object') return message;
  const fields = canonicalMessageFields(message);
  const content = canonicalParts(message.content);
  const contentChanged = content !== message.content;
  const fieldsChanged = !hasSameFields(message, fields);
  if (!fieldsChanged && !contentChanged) return message;
  return {
    ...message,
    ...(fieldsChanged ? fields : {}),
    ...(contentChanged ? { content } : {}),
  };
}
