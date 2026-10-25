/**
 * opencode 2.1.0 原生事件 → MAFW canonical 词汇（@2.1 方言）。
 *
 * 2.1.0 的 SSE 信封是 `{ id, created, type, data, location?, durable? }`
 * （GET /api/event），事件是 session 级富语义流，**没有** v1 的
 * message.updated / part.updated / turn.completed。本表把它们合成为
 * canonical 事件，使 gateway 的 facet 管线与 desktop/TUI 的既有处理器
 * 无需感知 2.1 词汇：
 *
 *   session.text.started/delta/ended      → part.updated / part.delta（text）
 *   session.reasoning.started/delta/ended → part.updated / part.delta（reasoning）
 *   session.step.started                  → message.updated（assistant info）
 *   session.step.ended                    → part.updated（step-finish，BudgetGuard step 切面）
 *   session.tool.*                        → part.updated（tool 快照，桌面工具卡）
 *   session.execution.started/succeeded/failed → turn.started / turn.completed / turn.failed
 *   session.usage.updated                 → usage.updated
 *   permission.v2.asked/replied           → permission.asked / permission.replied
 *
 * part id 约定：text/reasoning = `${assistantMessageID}-p${ordinal}`，与历史
 * 合成 id（adapter messages 的 `${message.id}-p${index}`）逐字对齐，避免
 * 实时/历史双份；tool part id = callID（与历史 tool part 的 id 一致）。
 *
 * 未识别类型原样透传（unknownEvents 计数，升级漂移可见）。
 */
import { MAFW } from './mafw-vocabulary';
import { stopReasonOf } from './contract';
import { formToQuestion } from './form-question';
import type { EventMapping, EventSourceShape, TransformEventFn } from './event-mapper';
import type { RawRuntimeEvent } from './normalize';

/** 2.1.0 信封：type 顶层，sessionID 在 data，目录在 location。 */
export const OPENCODE_21_EVENT_SOURCE: EventSourceShape = {
  typePath: '$.type',
  sessionIdPath: ['$.data.sessionID'],
  directoryPath: '$.location.directory',
};

/** 无消费者或纯遥测的 2.1 事件（显式压制，进 suppressed 计数）。 */
const NOISE_TYPES = [
  'server.connected',
  'project.updated',
  'models-dev.refreshed',
  'integration.updated',
  'integration.connection.updated',
  'provider.updated',
  'model.updated',
  'agent.updated',
  'command.updated',
  'skill.updated',
  'websearch.updated',
  'reference.updated',
  'plugin.updated',
  'plugin.added',
  'mcp.status.changed',
  'mcp.resources.changed',
  'session.instructions.updated',
  'session.step.streamed',
  'session.step.failed',
  'session.revert.staged',
  'session.revert.cleared',
  'session.revert.committed',
  'shell.created',
  'shell.exited',
  'file.edited',
  'file.watcher.updated',
  'lsp.updated',
  'vcs.branch.updated',
  'installation.updated',
  'installation.update.available',
] as const;

export const OPENCODE_21_EVENT_MAPPINGS: EventMapping[] = [
  // 生命周期
  { from: 'session.created', to: MAFW.sessionCreated, passProperties: '$.data' },
  { from: 'session.deleted', to: MAFW.sessionDeleted, passProperties: '$.data' },
  // 回合终态 / step
  { from: 'session.execution.started', to: MAFW.turnStarted, passProperties: '$.data' },
  { from: 'session.usage.updated', to: MAFW.usageUpdated, passProperties: '$.data' },
  // 压缩
  { from: 'session.compaction.started', to: MAFW.sessionCompacting, passProperties: '$.data' },
  { from: 'session.compaction.ended', to: MAFW.sessionCompacted, passProperties: '$.data' },
  // 审批（v2 形状 {id, action, resources} → canonical {id, permission, patterns}）
  { from: 'permission.v2.asked', to: MAFW.permissionAsked, passProperties: '$.data',
    fields: {
      requestId: { path: '$.data.id' },
      permission: { path: '$.data.action' },
      patterns: { path: '$.data.resources', default: [] },
    } },
  { from: 'permission.v2.replied', to: MAFW.permissionReplied, passProperties: '$.data',
    fields: { requestId: { path: '$.data.requestID' } } },
  // 问询（原生 v2 question；form 载荷走 transform 归一，legacy questions[] 原样透传）
  { from: 'question.v2.replied', to: MAFW.questionReplied, passProperties: '$.data' },
  { from: 'question.v2.rejected', to: MAFW.questionRejected, passProperties: '$.data' },
  // 计划/todo（2.1 保留 todo.updated 事件；初始水合仍无 /todo 路由）
  { from: 'todo.updated', to: MAFW.planUpdated, passProperties: '$.data' },
  // 显式压制
  { from: NOISE_TYPES as unknown as string[], to: 'drop' },
];

function eventOf(raw: any, type: string, properties: Record<string, any>): RawRuntimeEvent {
  const sessionID = typeof raw?.data?.sessionID === 'string' ? raw.data.sessionID : undefined;
  return {
    payload: { type, properties: { ...(sessionID ? { sessionID } : {}), ...properties }, ...(sessionID ? { sessionID } : {}) },
    ...(sessionID ? { sessionID } : {}),
    ...(raw?.location?.directory ? { directory: raw.location.directory } : {}),
  } as RawRuntimeEvent;
}

function partIdOf(data: any): string {
  return `${data?.assistantMessageID ?? 'msg'}-p${Number.isFinite(data?.ordinal) ? data.ordinal : 0}`;
}

/** tool 输入跨事件补齐：success/failed 事件本身不带 input。 */
const toolState = new Map<string, { name?: string; input?: any; started?: number }>();
const TOOL_STATE_CAP = 500;

/** per-session last step finish：execution.succeeded 事件本身未必带 finish。 */
const lastFinish = new Map<string, string>();

function rememberTool(id: string, patch: { name?: string; input?: any; started?: number }) {
  if (!id) return;
  const cur = toolState.get(id) ?? {};
  toolState.set(id, { ...cur, ...patch });
  if (toolState.size > TOOL_STATE_CAP) {
    const first = toolState.keys().next().value;
    if (first) toolState.delete(first);
  }
}

function toolPart(data: any, state: Record<string, any>, extra?: Record<string, any>): Record<string, any> {
  return {
    id: data?.id,
    sessionID: data?.sessionID,
    messageID: data?.assistantMessageID,
    type: 'tool',
    tool: extra?.tool ?? data?.name ?? toolState.get(data?.id)?.name ?? 'unknown',
    callID: data?.id,
    state,
  };
}

function textOfContent(content: any): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((p) => p && typeof p.text === 'string')
    .map((p) => p.text)
    .join('');
}

/** 复杂事件合成器（映射表未命中的类型才会走到这里）。 */
export const translateOpencode21Event: TransformEventFn = (raw: any) => {
  const type = typeof raw?.type === 'string' ? raw.type : '';
  const data: any = raw?.data ?? {};
  if (!type) return raw;

  switch (type) {
    case 'question.v2.asked': {
      const form = data?.form?.fields ? data.form : (Array.isArray(data?.fields) ? data : null);
      return eventOf(raw, MAFW.questionAsked, form ? formToQuestion(form) : data);
    }

    case 'session.execution.succeeded': {
      const finish = typeof data.finish === 'string' ? data.finish : lastFinish.get(data.sessionID);
      if (data.sessionID) lastFinish.delete(data.sessionID);
      return eventOf(raw, MAFW.turnCompleted, {
        sessionID: data.sessionID,
        stopReason: stopReasonOf(finish),
        ...(finish ? { finish } : {}),
      });
    }

    case 'session.execution.failed': {
      if (data.sessionID) lastFinish.delete(data.sessionID);
      return eventOf(raw, MAFW.turnFailed, {
        sessionID: data.sessionID,
        error: data.error?.message ?? 'turn failed',
        errorCode: data.error?.type ?? 'unknown',
        stopReason: 'error',
      });
    }

    case 'session.execution.interrupted':
      return eventOf(raw, MAFW.turnAborted, {
        sessionID: data.sessionID,
        stopReason: 'cancelled',
      });

    case 'session.diff':
      return eventOf(raw, MAFW.sessionDiff, {
        sessionID: data.sessionID,
        diff: data.diff ?? data.files ?? [],
      });

    case 'session.compaction.failed':
      return eventOf(raw, MAFW.sessionCompacted, {
        sessionID: data.sessionID,
        status: 'failed',
        error: data.error?.message ?? data.error ?? 'compaction failed',
        reason: data.reason,
      });

    case 'session.retry.scheduled':
      return eventOf(raw, MAFW.messageUpdated, {
        info: {
          id: data.assistantMessageID ?? data.messageID,
          sessionID: data.sessionID,
          role: 'assistant',
          retry: {
            attempt: data.attempt,
            at: data.at ?? raw.created,
            error: data.error,
          },
        },
      });

    case 'session.inbox.enqueued':
    case 'session.inbox.delivered':
    case 'session.inbox.update':
    case 'session.inbox.cancel':
    case 'session.inbox.cancelled':
    case 'session.inbox.delivery.changed':
      return eventOf(raw, MAFW.queueUpdated, {
        sessionID: data.sessionID,
        action: type.slice('session.inbox.'.length),
        ...(data.item ? { item: data.item } : {}),
        ...(data.entry ? { item: data.entry } : {}),
        ...(data.id ? { id: data.id } : {}),
      });

    case 'session.renamed':
      return eventOf(raw, MAFW.sessionUpdated, { info: { id: data.sessionID, title: data.title } });

    case 'session.agent.selected':
      return eventOf(raw, MAFW.sessionUpdated, { info: { id: data.sessionID, agent: data.agent } });

    case 'session.model.selected':
      return eventOf(raw, MAFW.sessionUpdated, {
        info: { id: data.sessionID, model: data.model ? { providerID: data.model.providerID, modelID: data.model.id ?? data.model.modelID } : undefined },
      });

    case 'session.step.started':
      return eventOf(raw, MAFW.messageUpdated, {
        info: {
          id: data.assistantMessageID,
          sessionID: data.sessionID,
          role: 'assistant',
          ...(data.agent ? { agent: data.agent } : {}),
          ...(data.model
            ? { model: { providerID: data.model.providerID, modelID: data.model.id ?? data.model.modelID, ...(data.model.variant ? { variant: data.model.variant } : {}) } }
            : {}),
          time: { created: data.started ?? raw.created ?? Date.now() },
        },
      });

    case 'session.step.ended':
      if (data.sessionID && data.finish) lastFinish.set(data.sessionID, data.finish);
      return eventOf(raw, MAFW.partUpdated, {
        part: {
          id: `${data.assistantMessageID ?? 'msg'}-p-step`,
          sessionID: data.sessionID,
          messageID: data.assistantMessageID,
          type: 'step-finish',
          reason: data.finish,
          cost: data.cost,
          tokens: data.tokens,
        },
      });

    case 'session.text.started':
      return eventOf(raw, MAFW.partUpdated, {
        part: { id: partIdOf(data), sessionID: data.sessionID, messageID: data.assistantMessageID, type: 'text', text: '' },
      });
    case 'session.text.delta':
      return eventOf(raw, MAFW.partDelta, {
        messageID: data.assistantMessageID,
        partID: partIdOf(data),
        field: 'text',
        delta: data.delta ?? '',
      });
    case 'session.text.ended':
      return eventOf(raw, MAFW.partUpdated, {
        part: { id: partIdOf(data), sessionID: data.sessionID, messageID: data.assistantMessageID, type: 'text', text: data.text ?? '' },
      });

    case 'session.reasoning.started':
      return eventOf(raw, MAFW.partUpdated, {
        part: { id: partIdOf(data), sessionID: data.sessionID, messageID: data.assistantMessageID, type: 'reasoning', text: '' },
      });
    case 'session.reasoning.delta':
      return eventOf(raw, MAFW.partDelta, {
        messageID: data.assistantMessageID,
        partID: partIdOf(data),
        field: 'reasoning',
        delta: data.delta ?? '',
      });
    case 'session.reasoning.ended':
      return eventOf(raw, MAFW.partUpdated, {
        part: { id: partIdOf(data), sessionID: data.sessionID, messageID: data.assistantMessageID, type: 'reasoning', text: data.text ?? '' },
      });

    case 'session.tool.input.started':
      rememberTool(data.id, { name: data.name, started: raw.created });
      return eventOf(raw, MAFW.partUpdated, {
        part: toolPart(data, { status: 'running', input: {}, time: { start: raw.created } }, { tool: data.name }),
      });
    case 'session.tool.input.ended': {
      let input: any = toolState.get(data.id)?.input;
      if (typeof data.text === 'string') {
        try { input = JSON.parse(data.text); } catch { /* keep previous */ }
      }
      rememberTool(data.id, { input });
      return eventOf(raw, MAFW.partUpdated, {
        part: toolPart(data, { status: 'running', input: input ?? {}, time: { start: toolState.get(data.id)?.started ?? raw.created } }),
      });
    }
    case 'session.tool.called':
      rememberTool(data.id, { input: data.input });
      return eventOf(raw, MAFW.partUpdated, {
        part: toolPart(data, { status: 'running', input: data.input ?? {}, time: { start: toolState.get(data.id)?.started ?? raw.created } }),
      });
    case 'session.tool.progress':
      return eventOf(raw, MAFW.partUpdated, {
        part: toolPart(data, {
          status: 'running',
          input: toolState.get(data.id)?.input ?? {},
          ...(data.metadata ? { metadata: data.metadata } : {}),
        }),
      });
    case 'session.tool.success': {
      const st = toolState.get(data.id);
      toolState.delete(data.id);
      return eventOf(raw, MAFW.partUpdated, {
        part: toolPart(data, {
          status: 'completed',
          input: st?.input ?? {},
          output: textOfContent(data.content),
          ...(data.metadata ? { metadata: data.metadata } : {}),
          time: { start: st?.started ?? raw.created, end: raw.created },
        }, { tool: st?.name }),
      });
    }
    case 'session.tool.failed': {
      const st = toolState.get(data.id);
      toolState.delete(data.id);
      const errText = typeof data.error?.message === 'string'
        ? data.error.message
        : (typeof data.error === 'string' ? data.error : 'tool failed');
      return eventOf(raw, MAFW.partUpdated, {
        part: toolPart(data, {
          status: 'error',
          input: st?.input ?? {},
          error: errText,
          output: errText,
          ...(data.metadata ? { metadata: data.metadata } : {}),
          time: { start: st?.started ?? raw.created, end: raw.created },
        }, { tool: st?.name }),
      });
    }
    default:
      // 未识别：原样透传（unknownEvents 监控可见）
      return raw;
  }
};
