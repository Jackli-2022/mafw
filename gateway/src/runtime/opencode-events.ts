/**
 * opencode 原生事件 → MAFW 词汇 v2 的翻译声明。
 *
 * v2（2026-10-12）起 opencode 不再拥有「免翻译特权」：经 registerBuiltin
 * 携 eventSource + eventMappings 接入，与文件插件同一注册接口（加载期
 * 校验 + dry-event 试衣间 + 流包装）。B1（rev2）起 transformEvent 退役——
 * legacy 族与 sync 信封改为显式 drop 行（声明式压制计 suppressed），词汇外
 * 新词经 unmatched 拦截 + 计数（漏网探测器，升级后跑 conformance 即暴露）。
 *
 * 设计：docs/superpowers/specs/2026-10-12-native-event-vocabulary-design.md §4.2
 * + docs/superpowers/specs/2026-10-20-runtime-unification-batch-design.md B1
 */
import { canonicalIdentity } from './event-mapper';
import type { EventMapping, EventSourceShape } from './event-mapper';

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
  // ---- legacy 族 + sync 信封：显式 drop 行（原 transformEvent 前缀丢弃的表化，B1） ----
  ...([
    'session.next.step.ended', 'session.next.reasoning.ended',
    'session.next.tool.started', 'session.next.tool.updated',
    'session.next.tool.ended', 'session.next.tool.failed',
    'sync',
  ] as const).map((t): EventMapping => ({ from: t, to: 'drop' })),
  // ---- canonical identity（词汇单源派生，B1：同名收编词的显式注册） ----
  ...canonicalIdentity('$.payload.properties'),
];

