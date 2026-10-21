/**
 * opencode 原生事件 → MAFW 词汇 v2 的翻译声明（@v1 方言表）。
 *
 * v2（2026-10-12）起 opencode 不再拥有「免翻译特权」：经 registerBuiltin
 * 携 eventSource + eventMappings 接入，与文件插件同一注册接口（加载期
 * 校验 + dry-event 试衣间 + 流包装）。B1（rev2）起 transformEvent 退役——
 * legacy 族与 sync 信封改为显式 drop 行（声明式压制计 suppressed），词汇外
 * 新词经 unmatched 拦截 + 计数（漏网探测器，升级后跑 conformance 即暴露）。
 *
 * canonical v3 / Plan 2（2026-10-21）：@v1 方言表全量处置刷新——
 *  - N3 修正：`session.next.tool.started/updated/ended` 是不存在的幽灵名
 *    （SDK union 无此词），真名是 tool.called/progress/success；
 *  - F6 落地：SDK Event union 89 成员全量处置（next 族 32 + 遥测 41 显式
 *    drop，零 unmatched 漏网），由 opencode-vocabulary-snapshot.test.ts
 *    以 89 基线钉扎——SDK 升级漂移先红快照，强制重审方言表。
 *  - @v2 方言表（混合消费）见 OPENCODE_V2_EVENT_MAPPINGS（Task 2）。
 *
 * 设计：docs/superpowers/specs/2026-10-12-native-event-vocabulary-design.md §4.2
 * + 2026-10-21-runtime-canonical-v3-design.md §3.3 / §3.7.1
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

/**
 * @v1 方言表：消费 legacy 家族（2.x serve 双发中的 legacy 侧；v1-only serve 的全部）。
 * @v2 方言的差集见 OPENCODE_V2_EVENT_MAPPINGS——两表互斥（双发防双计）。
 */
export const OPENCODE_V1_EVENT_MAPPINGS: EventMapping[] = [
  // ---- 回合终态（v2 语义修正：五终态双轨合并） ----
  { from: 'session.idle', to: 'turn.completed', passProperties: '$.payload.properties' },
  { from: 'session.error', to: 'turn.failed', passProperties: '$.payload.properties' },
  // 防御行（不在 SDK union，legacy 兼容——2026-10-12 spec :30-31）
  { from: 'message.error', to: 'turn.failed', passProperties: '$.payload.properties' },
  { from: 'message.aborted', to: 'turn.aborted', passProperties: '$.payload.properties' },
  // ---- part.* 去冗余前缀 ----
  { from: 'message.part.updated', to: 'part.updated', passProperties: '$.payload.properties' },
  { from: 'message.part.delta', to: 'part.delta', passProperties: '$.payload.properties' },
  // 防御行（不在 SDK union，legacy 兼容）
  { from: 'message.part.complete', to: 'part.complete', passProperties: '$.payload.properties' },
  // ---- plan 域（ACP plan / codex todo_list 同域） ----
  { from: 'todo.updated', to: 'plan.updated', passProperties: '$.payload.properties' },
  // ---- @v1 方言显式 drop：next 族全 32（2.x 双发的 next 侧不消费——@v2 表独占） ----
  ...([
    'session.next.agent.switched', 'session.next.model.switched', 'session.next.moved',
    'session.next.prompted', 'session.next.prompt.admitted', 'session.next.context.updated',
    'session.next.synthetic', 'session.next.shell.started', 'session.next.shell.ended',
    'session.next.step.started', 'session.next.step.ended', 'session.next.step.failed',
    'session.next.text.started', 'session.next.text.delta', 'session.next.text.ended',
    'session.next.reasoning.started', 'session.next.reasoning.delta', 'session.next.reasoning.ended',
    'session.next.tool.input.started', 'session.next.tool.input.delta', 'session.next.tool.input.ended',
    'session.next.tool.called', 'session.next.tool.progress', 'session.next.tool.success',
    'session.next.tool.failed', 'session.next.retried',
    'session.next.compaction.started', 'session.next.compaction.delta', 'session.next.compaction.ended',
    'session.next.revert.staged', 'session.next.revert.cleared', 'session.next.revert.committed',
  ] as const).map((t): EventMapping => ({ from: t, to: 'drop' })),
  // ---- @v1 方言显式 drop：v2 专有名（双发的 v2 侧不消费——@v2 表独占） ----
  ...([
    'permission.v2.asked', 'permission.v2.replied',
    'question.v2.asked', 'question.v2.replied', 'question.v2.rejected',
  ] as const).map((t): EventMapping => ({ from: t, to: 'drop' })),
  // ---- F6 遥测族 drop（无 MAFW 消费方；显式声明保 suppressed 计数纯净） ----
  ...([
    'models-dev.refreshed', 'integration.updated', 'integration.connection.updated', 'catalog.updated',
    'message.removed', 'message.part.removed',
    'installation.updated', 'installation.update-available',
    'file.edited', 'reference.updated', 'plugin.added',
    'project.directories.updated', 'project.updated',
    'file.watcher.updated', 'lsp.updated', 'vcs.branch.updated',
    'pty.created', 'pty.updated', 'pty.exited', 'pty.deleted',
    'tui.prompt.append', 'tui.command.execute', 'tui.toast.show', 'tui.session.select',
    'mcp.tools.changed', 'mcp.browser.open.failed', 'command.executed',
    'session.status',
    'workspace.ready', 'workspace.failed', 'workspace.status',
    'worktree.ready', 'worktree.failed',
    'server.connected', 'server.instance.disposed', 'global.disposed',
  ] as const).map((t): EventMapping => ({ from: t, to: 'drop' })),
  // ---- runtime 原生信封（非 SDK union；RUNTIME_NATIVE_DROPPED 同款，显式行保计数） ----
  { from: 'sync', to: 'drop' },
  // ---- canonical identity（词汇单源派生，B1：同名收编词的显式注册；
  //      message.updated 除外——经 OPENCODE_TRANSFORM_EVENT 产 flat {message}） ----
  ...canonicalIdentity('$.payload.properties').filter((m) => m.from !== 'message.updated'),
];

/** 兼容 alias（index.ts 渐进切换到方言名；Plan 2 Task 3 重接线后收敛） */
export const OPENCODE_EVENT_MAPPINGS: EventMapping[] = OPENCODE_V1_EVENT_MAPPINGS;

/**
 * @v2 方言表（混合消费）：2.x serve 的 next 族为主 + 非 next 的 legacy 继续消费，
 * 重叠 legacy 显式 drop（双发防双计——@v1 表与 @v2 表互斥独占各自家族）。
 *
 * 行序敏感：specific 行（判别/drop）在前，canonicalIdentity 恒等行殿后
 * （mappings 数组序 first-match）。载荷字段形状以 SDK types.gen.d.ts 实测为准
 * （Plan 2 调研钉死：tool.called{assistantMessageID, callID, tool, input}、
 *  text.delta{textID, delta}、reasoning.delta{reasoningID, delta} 等）。
 */
export const OPENCODE_V2_EVENT_MAPPINGS: EventMapping[] = [
  // ---- 回合生命周期（next 族原生） ----
  { from: 'session.next.prompted', to: 'turn.started', passProperties: '$.payload.properties' },
  // ---- 工具三原语（原语组——经 gateway 侧 assembler 合帧为 part.updated 快照） ----
  { from: 'session.next.tool.called', to: 'tool.call', fields: {
      callID: { path: '$.payload.properties.callID' },
      tool: { path: '$.payload.properties.tool' },
      input: { path: '$.payload.properties.input' },
      messageID: { path: '$.payload.properties.assistantMessageID' },
    } },
  { from: 'session.next.tool.input.delta', to: 'tool.delta', fields: {
      callID: { path: '$.payload.properties.callID' },
      kind: { const: 'input' },
      text: { path: '$.payload.properties.delta' },
    } },
  { from: 'session.next.tool.progress', to: 'tool.delta', fields: {
      callID: { path: '$.payload.properties.callID' },
      kind: { const: 'output' },
    } },
  { from: 'session.next.tool.success', to: 'tool.result', fields: {
      callID: { path: '$.payload.properties.callID' },
      output: { path: '$.payload.properties.content' },
      messageID: { path: '$.payload.properties.assistantMessageID' },
    } },
  { from: 'session.next.tool.failed', to: 'tool.result', fields: {
      callID: { path: '$.payload.properties.callID' },
      isError: { const: true },
      output: { path: '$.payload.properties.error' },
      messageID: { path: '$.payload.properties.assistantMessageID' },
    } },
  // ---- 文本/推理流（part.delta 载荷 = {partID, messageID, field, delta}——desktop chat-stream 契约） ----
  { from: 'session.next.text.delta', to: 'part.delta', fields: {
      partID: { path: '$.payload.properties.textID' },
      messageID: { path: '$.payload.properties.assistantMessageID' },
      field: { const: 'text' },
      delta: { path: '$.payload.properties.delta' },
    } },
  { from: 'session.next.reasoning.delta', to: 'part.delta', fields: {
      partID: { path: '$.payload.properties.reasoningID' },
      messageID: { path: '$.payload.properties.assistantMessageID' },
      field: { const: 'text' },
      delta: { path: '$.payload.properties.delta' },
    } },
  // ---- 压缩（原生对，替代 legacy session.compacted 单发） ----
  { from: 'session.next.compaction.started', to: 'session.compacting', passProperties: '$.payload.properties' },
  { from: 'session.next.compaction.ended', to: 'session.compacted', passProperties: '$.payload.properties' },
  // ---- 审批/问答 v2 名（收编 canonical 名） ----
  { from: 'permission.v2.asked', to: 'permission.asked', passProperties: '$.payload.properties' },
  { from: 'permission.v2.replied', to: 'permission.replied', passProperties: '$.payload.properties' },
  { from: 'question.v2.asked', to: 'question.asked', passProperties: '$.payload.properties' },
  { from: 'question.v2.replied', to: 'question.replied', passProperties: '$.payload.properties' },
  { from: 'question.v2.rejected', to: 'question.rejected', passProperties: '$.payload.properties' },
  // ---- session.error 判别（行序敏感：aborted 判别行在前） ----
  { from: 'session.error', to: 'turn.aborted',
    when: [{ path: '$.payload.properties.error.name', equals: 'MessageAbortedError' }],
    passProperties: '$.payload.properties' },
  { from: 'session.error', to: 'turn.failed', passProperties: '$.payload.properties' },
  // ---- 非 next 的 legacy 继续消费（next 族不覆盖的语义） ----
  { from: 'session.idle', to: 'turn.completed', passProperties: '$.payload.properties' },
  { from: 'todo.updated', to: 'plan.updated', passProperties: '$.payload.properties' },
  { from: 'message.aborted', to: 'turn.aborted', passProperties: '$.payload.properties' }, // 防御行（不在 union）
  // ---- 重叠 legacy 显式 drop（双发防双计——@v2 方言不消费） ----
  ...([
    'message.part.updated', 'message.part.delta', 'message.part.complete',
    'permission.asked', 'permission.replied',
    'question.asked', 'question.replied', 'question.rejected',
    'session.compacted',
    'sync', // runtime 原生信封（非 union）
  ] as const).map((t): EventMapping => ({ from: t, to: 'drop' })),
  // ---- next 孤儿族 drop（F6 处置：本期无 canonical 家） ----
  ...([
    'session.next.prompt.admitted', 'session.next.context.updated', 'session.next.synthetic',
    'session.next.moved', 'session.next.agent.switched', 'session.next.model.switched',
    'session.next.retried',
    'session.next.shell.started', 'session.next.shell.ended',
    'session.next.step.started', 'session.next.step.ended', 'session.next.step.failed',
    'session.next.text.started', 'session.next.text.ended',
    'session.next.reasoning.started', 'session.next.reasoning.ended',
    'session.next.tool.input.started', 'session.next.tool.input.ended',
    'session.next.compaction.delta',
    'session.next.revert.staged', 'session.next.revert.cleared', 'session.next.revert.committed',
  ] as const).map((t): EventMapping => ({ from: t, to: 'drop' })),
  // ---- F6 遥测族 drop（与 @v1 表同款） ----
  ...([
    'models-dev.refreshed', 'integration.updated', 'integration.connection.updated', 'catalog.updated',
    'message.removed', 'message.part.removed',
    'installation.updated', 'installation.update-available',
    'file.edited', 'reference.updated', 'plugin.added',
    'project.directories.updated', 'project.updated',
    'file.watcher.updated', 'lsp.updated', 'vcs.branch.updated',
    'pty.created', 'pty.updated', 'pty.exited', 'pty.deleted',
    'tui.prompt.append', 'tui.command.execute', 'tui.toast.show', 'tui.session.select',
    'mcp.tools.changed', 'mcp.browser.open.failed', 'command.executed',
    'session.status',
    'workspace.ready', 'workspace.failed', 'workspace.status',
    'worktree.ready', 'worktree.failed',
    'server.connected', 'server.instance.disposed', 'global.disposed',
  ] as const).map((t): EventMapping => ({ from: t, to: 'drop' })),
  // ---- canonical identity（词汇单源派生，恒等行殿后；message.updated 除外——
  //      经 OPENCODE_TRANSFORM_EVENT 产 flat {message}，见下） ----
  ...canonicalIdentity('$.payload.properties').filter((m) => m.from !== 'message.updated'),
];

/**
 * message.updated 载荷 flat 翻转（Plan 2 Task 6，@v1/@v2 共享）：
 * 原生载荷 `{info: {...}}` → canonical `{message: {...}}`（零换名信封搬移——
 * info 字段全量展开为 message 值；spread 未来防漏，字段枚举不可维护）。
 * identity 行已排除 message.updated（映射优先级在前会拦截 transform）。
 * SSE wire 出口经 event-broadcast → toWireEventPayload 还原 {info}（桌面零改动）。
 */
export const OPENCODE_TRANSFORM_EVENT: TransformEventFn = (event: any) => {
  const t = event?.payload?.type;
  if (t !== 'message.updated') return undefined;
  const props = event?.payload?.properties ?? {};
  // transform 输出不经 mapper 的 sessionID 注入（映射行专用）——自行提取
  // （与 eventSource.sessionIdPath 同路径集：payload 顶层 / properties）
  const sid = event?.sessionID ?? event?.payload?.sessionID ?? props?.sessionID;
  return {
    payload: {
      type: 'message.updated',
      properties: { ...(sid ? { sessionID: sid } : {}), message: props?.info ?? {} },
    },
    ...(sid ? { sessionID: sid } : {}),
    ...(event?.directory !== undefined ? { directory: event.directory } : {}),
  };
};
