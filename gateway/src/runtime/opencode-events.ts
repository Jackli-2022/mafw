/**
 * opencode 原生事件 → MAFW 词汇 v2 的翻译声明。
 *
 * v2（2026-10-12）起 opencode 不再拥有「免翻译特权」：经 registerBuiltin
 * 携 eventSource + eventMappings + transformEvent 接入，与文件插件同一
 * 注册接口（加载期校验 + dry-event 试衣间 + 流包装）。
 *
 * 设计：docs/superpowers/specs/2026-10-12-native-event-vocabulary-design.md §4.2
 * - 差异行显式声明（改名/合并）；同名收编词（session.created 等）经
 *   canonical passthrough 机制通过——机制非特权，任何 runtime 走统一
 *   wrap 均适用。
 * - transformEvent 前缀丢弃 session.next.* legacy 族与 sync 信封。
 */
import { canonicalIdentity } from './event-mapper';
import type { EventMapping, EventSourceShape, TransformEventFn } from './event-mapper';

/** opencode 原生事件信封：GlobalEvent { directory, payload: { type, properties, sessionID? } } */
export const OPENCODE_EVENT_SOURCE: EventSourceShape = {
  typePath: '$.payload.type',
  // sessionID 的承载位置因事件而异：部分事件在 payload 顶层，部分在 properties
  sessionIdPath: ['$.payload.sessionID', '$.payload.properties.sessionID'],
  directoryPath: '$.directory',
};

export const OPENCODE_EVENT_MAPPINGS: EventMapping[] = [
  // ---- 回合终态三元组（v2 语义修正：五终态双轨合并） ----
  { from: 'session.idle', to: 'turn.completed', passProperties: '$.payload.properties' },
  { from: 'session.error', to: 'turn.failed', passProperties: '$.payload.properties' },
  { from: 'message.error', to: 'turn.failed', passProperties: '$.payload.properties' },
  { from: 'message.aborted', to: 'turn.aborted', passProperties: '$.payload.properties' },
  // ---- part.* 去冗余前缀 ----
  { from: 'message.part.updated', to: 'part.updated', passProperties: '$.payload.properties' },
  { from: 'message.part.delta', to: 'part.delta', passProperties: '$.payload.properties' },
  { from: 'message.part.complete', to: 'part.complete', passProperties: '$.payload.properties' },
  // ---- plan 域（ACP plan / codex todo_list 同域） ----
  { from: 'todo.updated', to: 'plan.updated', passProperties: '$.payload.properties' },
  // ---- canonical identity（词汇单源派生，B1：同名收编词的显式注册） ----
  ...canonicalIdentity('$.payload.properties'),
];

/**
 * legacy 族 + sync 信封前缀丢弃：
 * - session.next.* 六条（step.ended / reasoning.ended / tool.{started,updated,ended,failed}）
 *   ——唯一 MAFW 侧消费者是 v1 宿主插件（opencode 进程内原生 hook，不经 gateway）。
 * - sync：opencode v2 事件溯源信封，与 legacy 双发（RUNTIME_NATIVE_DROPPED
 *   的边界防御之外，翻译层再兜一层）。
 */
export const opencodeTransformEvent: TransformEventFn = (raw) => {
  const t = raw?.payload?.type || raw?.type;
  if (typeof t === 'string' && (t.startsWith('session.next.') || t === 'sync')) return null;
  return raw;
};
