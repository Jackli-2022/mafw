/**
 * Phase D2：`handleRuntimeEvent` 的有序 stage 表（gateway/src/index.ts 原 277 行
 * 顺序敏感 if 链的逐字抽取）。
 *
 * 形状：**facet/state 门控的 STAGE PIPELINE**，不是 per-type handler 清单 ——
 * 一个事件会命中约 10 个 stage。表的位置就是执行顺序（Ruling D2-R1：没有冗余
 * `order` 字段），拓扑断言用 `stageIndex(name)` 比较（见 event-dispatch.test.ts）。
 *
 * 等价契约（binding）：
 *   - `matches` 是 legacy 的块级 if 条件，`run` 是块体；块体逐字搬移，只把
 *     `this.x` 换成 `ctx.x()`（live getter，绝不快照），块内自带 try/catch 与
 *     log 字符串原样保留。
 *   - **只有三段可以 HALT**（legacy 的 `return`）：`nativeDrop`（RUNTIME_NATIVE_DROPPED）、
 *     `toolPrimitiveDrop`（TOOL_PRIMITIVE_TYPES）、`internalFilter`（memoryWorker
 *     链中丢弃——仅 turn 终态放行）。HALT 停掉全部下游 stage。
 *   - **零 await**：整链同步（approval 的 `policy.evaluate` 是同步契约，
 *     policy-service.ts:10）。autoCheckpoint / compact flush / queue flush 保持
 *     fire-and-forget，不引入等待。
 *   - 不新增 pipeline 级 try/catch：legacy 没有，段内各自兜底。
 *
 * 不在本模块：`broadcast()` / `setupEventBus()` / `subscribeToEvents()` /
 * `emitNodeEvent` / RuntimeBus（D3 material）。
 *
 * 类型约定：`matches` 已保证的门控（sessionID 存在、f.approval 非空……）不会跨函数
 * 窄化，`run` 里用 `as` 重新取形（`sessionID as string` / `approval as ApprovalFacet`），
 * 不改语义。
 */
import { log } from '../core/utils/logger';
import { TaskSkippedError, TaskTimeoutError } from '../scheduler';
import { applyApprovalPolicy } from '../core/approval/hook';
import { isMalformedEvent, type ApprovalFacet, type EventFacets } from './normalize';
import { isKnownEventType, type UnknownEventTracker } from './event-telemetry';
import { RUNTIME_NATIVE_DROPPED } from './event-flow-matrix';
import { TOOL_PRIMITIVE_TYPES } from './tool-part-assembler';
import { enrichToolIdentity } from './tool-classes';
import { enrichPermissionEvent, projectQuestionRequest } from './view-projections';
import { mafwBroadcast } from './event-broadcast';
import { MAFW } from './mafw-vocabulary';
import type { TtlMap } from '../concurrency/ttl-map';
import type { BusinessRuntime } from './contract';
import type { ApprovalPolicyService } from '../core/approval/policy-service';
import type { BudgetGuard } from '../core/budget-guard';
import type { InternalRolesView } from '../session/views/internal-roles';
import type { NodeDriver } from '../core/goal/driver';
import type { RunCoordinator } from '../core/run/run-coordinator';
import type { BackgroundJobRegistry } from '../core/background/background-jobs';
import type { IdentityState } from './identity-state';
import type { ChatSessionManager } from '../chat/chat-sessions';
import type { IndexScanService } from '../recall/index-scan';
import type { Scheduler } from '../scheduler';
import type { TurnPipeline } from '../recall/turn-pipeline';
import type { TrajectoryCollector } from '../trajectory/collector';

/** 归一化结果（runtime/normalize.ts 单源，不在此重复定义）。 */
export type { EventFacets };

/** conformance event tap 回调形状（TtlMap 值类型，与 index.ts 字段同形）。 */
export type EventTapCallback = (e: { type: string; sessionID?: string; at: number }) => void;

/**
 * 链上每一步能看到的组合根状态。**全部是 live getter**（D1 模式）：表是长驻对象，
 * 快照会读陈旧值；`setTokenWriterSession` 是唯一的写回口（legacy 直接赋值字段）。
 */
export interface DispatchCtx {
  /** 活跃 runtime 名（malformed/unknown 遥测 + [SSE] 日志）。 */
  runtimeName(): string;
  /** 畸形事件 warn 限频表（per-runtime，live Map）。 */
  malformedEventWarnAt(): Map<string, number>;
  /** 未知事件计数（live tracker）。 */
  unknownEventTracker(): UnknownEventTracker;
  /** Conformance event tap 表（live TtlMap，5min TTL）。 */
  eventTaps(): TtlMap<string, Set<EventTapCallback>>;
  /** Goal 编排驱动（NodeDriver 事件侧）。 */
  goalDriver(): NodeDriver | null;
  /** busy 追踪（turn.started 置位 / 终态清除 / 事件刷新时间戳）。 */
  busySessions(): Map<string, number>;
  /** run 状态协调器（终态收尾）。 */
  runCoordinator(): RunCoordinator | null | undefined;
  /** runtime shell 台账（background.job.updated）。 */
  backgroundShells(): BackgroundJobRegistry;
  /** 审批政策环（asked 事件同步评估）。 */
  approvalPolicy(): ApprovalPolicyService;
  /** 业务 runtime 面（approval auto-reply 走 session.permissionReply）。 */
  runtime(): BusinessRuntime | null;
  /** Turn 级身份绑定（turn.completed 清理）。 */
  identityState(): IdentityState;
  /** T2-1 自动检查点（内部已门控；调用方 fire-and-forget）。 */
  recordAutoCheckpoint(sessionID: string): Promise<void>;
  /** per-prompt 预算会话集合（终态清理判定）。 */
  promptBudgetSessions(): Set<string>;
  /** per-goal-session 预算 guard（step 计数 + 终态清理）。 */
  budgetGuards(): Map<string, BudgetGuard>;
  /** 回合终态续发（fire-and-forget）。 */
  flushSessionQueue(sessionID: string): void;
  /** 内部会话 role 视图（memoryWorker 判定）。 */
  internalSessionRoles(): InternalRolesView;
  /** self-update 调用者定位：每事件刷新 last-active。 */
  lastActiveBySession(): Map<string, number>;
  /** 自更新 restart token 写入者（getter/setter pair，legacy 为直接赋值）。 */
  getTokenWriterSession(): { sessionID: string; at: number } | null;
  setTokenWriterSession(value: { sessionID: string; at: number }): void;
  /** 最近一次带 shell command 的写入（per-session）。 */
  lastWriteBySession(): Map<string, { at: number; command: string }>;
  /** Path T trajectory 累加器。 */
  trajectoryCollector(): TrajectoryCollector | null;
  /** 统一广播出口（Mode A：EventStore append + SSE/WS/push）。 */
  broadcast(event: { type: string; [key: string]: any }): void;
  /** 统一调度器（compaction flush 提交）。 */
  scheduler(): Scheduler;
  /** T1 回合管线（compaction flush 消费）。 */
  getTurnPipeline(): TurnPipeline;
  /** index-scan 服务（compaction flush 后刷新缓存）。 */
  scanService(): IndexScanService | null;
  /** per-session SSE（Mode B）管理器。 */
  chatSessions(): ChatSessionManager;
}

/** 段执行结果：`'halt'` = legacy 的 `return`（停掉全部下游 stage）。 */
export type StageOutcome = void | 'halt';

export interface DispatchStage {
  name: string;
  matches(f: EventFacets, evt: any, ctx: DispatchCtx): boolean;
  run(f: EventFacets, evt: any, ctx: DispatchCtx): StageOutcome;
}

/** turn 终态三元组（memoryWorker 链中丢弃的唯一放行集）。 */
const TURN_TERMINALS: ReadonlySet<string> = new Set([
  MAFW.turnCompleted,
  MAFW.turnFailed,
  MAFW.turnAborted,
]);

/**
 * memory-system 会话判定（legacy 1867-68 逐字）：index-scan / extract / reflect。
 * 纯函数、无状态；internalFilter 之外的 3 段（trajectory / compaction / 广播
 * internal 标记）读同一判定。legacy 把结果存在局部变量里复用；链是同步的
 * （零 await），`internalSessionRoles` 不会在段间变化，重算与复用等价。
 */
function isMemoryWorker(sessionID: string | undefined, ctx: DispatchCtx): boolean {
  const role = sessionID ? ctx.internalSessionRoles().get(sessionID) : undefined;
  return !!role && (role === 'index-scan' || role === 'extract' || role === 'reflect');
}

// ── 1. runtime 原生信封丢弃 ────────────────────────────────────────────────
const nativeDrop: DispatchStage = {
  name: 'nativeDrop',
  matches: (f) => RUNTIME_NATIVE_DROPPED.has(f.type),
  // opencode v2 sync 信封：与 legacy 事件双发的状态重同步噪声，gateway
  // 边界丢弃（处置登记于 event-flow-matrix.ts RUNTIME_NATIVE_DROPPED）。
  // 放行会重复处理 + desktop miss 告警 + [SSE] 日志刷屏。
  run: () => 'halt',
};

// ── 2. 工具三原语丢弃 ──────────────────────────────────────────────────────
const toolPrimitiveDrop: DispatchStage = {
  name: 'toolPrimitiveDrop',
  matches: (f) => TOOL_PRIMITIVE_TYPES.has(f.type),
  // 工具三原语属 assembler 内部入口：正常路径已被 wrapToolPartAssembly 消费，
  // 漏到这里说明装配层未接线——丢弃防广播污染（tool part 只能以合成快照形态出站）。
  run: () => 'halt',
};

// ── 3. 畸形事件诊断（限频 30s） ────────────────────────────────────────────
const malformedWarn: DispatchStage = {
  name: 'malformedWarn',
  matches: (_f, evt) => isMalformedEvent(evt),
  // 畸形事件诊断（限频）：runtime 插件发来的事件 type/properties 全空时
  // 静默穿过会污染 trajectory 与桌面 SSE——这里给可定位诊断。
  run: (_f, evt, ctx) => {
    const now = Date.now();
    const last = ctx.malformedEventWarnAt().get(ctx.runtimeName()) ?? 0;
    if (now - last > 30_000) {
      ctx.malformedEventWarnAt().set(ctx.runtimeName(), now);
      let summary: string;
      try { summary = JSON.stringify(evt)?.slice(0, 200) ?? '(unserializable)'; } catch { summary = '(unserializable)'; }
      log.warn(`[SSE] malformed event from runtime '${ctx.runtimeName()}' (no type/properties) — dropped consumers may misbehave; payload: ${summary}`);
    }
  },
};

// ── 4. 未知类型遥测（fail-open 不阻断） ────────────────────────────────────
const unknownTypeTelemetry: DispatchStage = {
  name: 'unknownTypeTelemetry',
  matches: (f) => !isKnownEventType(f.type),
  // 未知类型遥测（全量启用）：首次出现时 warn 一次给可定位诊断，
  // 计数经 GET /api/runtime 的 unknownEvents 暴露。fail-open 不阻断。
  run: (f, _evt, ctx) => {
    try {
      const { firstSeen } = ctx.unknownEventTracker().record(ctx.runtimeName(), f.type);
      if (firstSeen) {
        log.warn(
          `[SSE] runtime '${ctx.runtimeName()}' emitted unknown event type '${f.type}' ` +
          `(not canonical, not plugin:* namespaced) — desktop will show it as ` +
          `'miss' in the event inspector; counters: GET /api/runtime .unknownEvents`,
        );
      }
    } catch { /* fail-open */ }
  },
};

// ── 5. 工具语义类别 enrich（单点，必须先于全部下游） ──────────────────────
const enrichToolIdentityStage: DispatchStage = {
  name: 'enrichToolIdentity',
  matches: () => true,
  // 工具语义类别 enrich（additive 可选字段 part.toolClass + part.canonicalTool；
  // tool-classes.ts 单源——审批 read-only 档 / 身份类别 / 渲染四级查找链共用此维度）。
  // 单点 enrich 保证 eventTaps / trajectory / broadcast 全下游可见。
  run: (_f, evt) => {
    try { enrichToolIdentity(evt); } catch { /* fail-open：enrich 绝不阻断事件链 */ }
  },
};

// ── 6. Conformance event tap（先于 internal 过滤） ────────────────────────
const conformanceTap: DispatchStage = {
  name: 'conformanceTap',
  matches: (f) => !!f.sessionID,
  // Conformance event tap：per-session 临时观察者（POST /api/runtime/conformance 用）。
  // 放在 internal 过滤之前——tap 要看到该会话的全量事件（fail-open 不阻断主链）。
  run: (f, _evt, ctx) => {
    const sessionID = f.sessionID as string;
    const taps = ctx.eventTaps().get(sessionID);
    if (taps && taps.size) {
      const snap = { type: f.type, sessionID, at: Date.now(), ...(f.properties?.part ? { part: f.properties.part } : {}) };
      for (const t of taps) { try { t(snap); } catch { /* fail-open */ } }
    }
  },
};

// ── 7. Goal 节点监听（回合归属水位 / idle / error） ────────────────────────
const goalActivity: DispatchStage = {
  name: 'goalActivity',
  matches: (f) => !!f.sessionID,
  // Goal node listeners: NodeDriver 完成/失败双门的事件侧（spec §3）。
  // v2：turn.completed/turn.failed 是回合终态一等公民（opencode session.idle /
  // pi agent_end 经翻译层产出），双保险的 broadcast 切面已随 Mode A 改写删除。
  run: (f, _evt, ctx) => {
    const { type, properties: props, sessionID } = f;
    const sid = sessionID as string;
    // 回合归属：本回合的活动水位。没有它，陈旧 idle 与真结束无法区分。
    if (
      type === MAFW.turnStarted ||
      type === MAFW.partUpdated ||
      type === MAFW.partDelta ||
      type === MAFW.messageUpdated
    ) {
      ctx.goalDriver()?.noteSessionActivity(sid);
    }
    if (type === MAFW.turnCompleted) ctx.goalDriver()?.onSessionIdle(sid);
    if (type === MAFW.turnFailed) {
      const rawError = (props as any)?.error;
      const code = typeof rawError === 'object' && rawError
        ? String(rawError.type ?? rawError.code ?? 'session_error')
        : String((props as any)?.errorCode ?? 'session_error');
      const message = typeof rawError === 'object' && rawError
        ? String(rawError.message ?? rawError.type ?? 'session error')
        : String(rawError ?? 'session error');
      ctx.goalDriver()?.onSessionError(sid, message, code);
    }
  },
};

// ── 8. 回合开始置 busy（spec 2026-10-22-session-queue-inbox §5.1 v2） ─────
const turnStartedBusy: DispatchStage = {
  name: 'turnStartedBusy',
  matches: (f) => !!f.sessionID && f.type === MAFW.turnStarted,
  // busy 追踪（spec 2026-10-22-session-queue-inbox §5.1 v2）：turn.started 置位；
  // 本词汇的首个消费者——配对可靠性由 15min TTL 清扫兜底（防楔死，v2 Q2）。
  run: (f, _evt, ctx) => {
    const sessionID = f.sessionID as string;
    ctx.busySessions().set(sessionID, Date.now());
    ctx.runCoordinator()?.onTurnStarted(sessionID);
  },
};

// ── 9. runtime shell 台账 ─────────────────────────────────────────────────
const backgroundJob: DispatchStage = {
  name: 'backgroundJob',
  matches: (f) => f.type === MAFW.backgroundJobUpdated,
  // Task 3：runtime shell 台账（synthetic / shell 生命周期经翻译层产出的 canonical
  // background.job.updated）。终态不回退；广播仍走下方统一出口（不重复发）。
  run: (f, _evt, ctx) => {
    const job = (f.properties as any)?.job;
    if (job && typeof job === 'object') {
      try { ctx.backgroundShells().apply(job as any, { directory: f.directory }); } catch { /* fail-open */ }
    }
  },
};

// ── 10. Approval policy（同步评估，必须先于 internal 过滤） ────────────────
const approvalPolicy: DispatchStage = {
  name: 'approvalPolicy',
  matches: (f) => !!f.approval && !!f.sessionID,
  // Approval policy：asked 事件先于 internal 过滤与 Mode A 广播评估（内部会话
  // fail-safe 需在 memoryWorker drop 之前生效）；决策附在广播 properties.mafwPolicy，
  // 三端据此分流（非 human = 直接渲染已决记录，不弹交互卡）。
  // SYNC contract：policy.evaluate / probeScope 是同步的（policy-service.ts:10）——
  // 这里不得引入 await / setImmediate。
  run: (f, _evt, ctx) => {
    applyApprovalPolicy(ctx.approvalPolicy(), ctx.runtime(), f.approval as ApprovalFacet, f.sessionID as string, f.properties);
  },
};

// ── 11. 规范权限字段投影（asked/replied 同一投影） ────────────────────────
const permissionEnrich: DispatchStage = {
  name: 'permissionEnrich',
  matches: (f) =>
    (f.type === MAFW.permissionAsked || f.type === MAFW.permissionReplied) && !!f.sessionID,
  // 规范权限字段并入载荷（id/kind/targets/suggestedRule…）：asked 与 replied **同一投影**。
  // pi 的 `{requestId, toolName, args}` 与 opencode 的 `{id, permission, patterns}` 在出口
  // 收敛成同一张卡片（review I2：pi 卡片曾丢 id、只显示 "shell"）；replied 无工具元数据也
  // 必须带 canonical id（opencode v2 用 requestID），否则桌面/远端按 `requestID || id` 找
  // 不到卡、永远销账不掉。原生答复字段（approved/decision/message/reply）原样保留；
  // 审批策略与答复语义不变——这里只做投影。
  run: (f, _evt) => {
    try { enrichPermissionEvent(f.properties, f.sessionID as string); } catch { /* fail-open：卡片退回客户端兜底 */ }
  },
};

// ── 12. 问题载荷投影 ──────────────────────────────────────────────────────
const questionRequest: DispatchStage = {
  name: 'questionRequest',
  matches: (f) => f.type === 'question.asked' && !!f.sessionID,
  // 问题载荷同样补规范字段（`questions[].question/options`）；原生 form 字段保留。
  run: (f) => {
    try {
      const projected = projectQuestionRequest(f.properties, f.sessionID as string);
      if (projected && typeof projected === 'object') Object.assign(f.properties, projected);
    } catch { /* fail-open */ }
  },
};

// ── 13. Turn 级身份绑定清理 ────────────────────────────────────────────────
const identityClearTurn: DispatchStage = {
  name: 'identityClearTurn',
  matches: (f) => f.type === MAFW.turnCompleted && !!f.sessionID,
  // Turn-level identity binding cleanup: a user-picked identity lasts one turn.
  run: (f, _evt, ctx) => {
    ctx.identityState().clearTurnBindings(f.sessionID as string);
  },
};

// ── 14. 自动检查点（fire-and-forget，先于 memoryWorker 早退） ─────────────
const autoCheckpoint: DispatchStage = {
  name: 'autoCheckpoint',
  matches: (f) => f.type === MAFW.turnCompleted && !!f.sessionID,
  // T2-1：自动检查点（fail-open；门控在 runAutoCheckpoint 内——内部会话/隐藏会话/
  // 非 checkpointApi runtime 全跳过）。挂在 memoryWorker 早退之前，role 门兜底。
  run: (f, _evt, ctx) => {
    const sessionID = f.sessionID as string;
    void ctx.recordAutoCheckpoint(sessionID).catch((err: any) => {
      log.warn(`[Checkpoint] auto record failed for ${sessionID} (non-fatal): ${err?.message ?? err}`);
    });
  },
};

// ── 15. 回合终态清理（预算 → busy → run 收尾 → 队列续发） ─────────────────
const terminalCleanup: DispatchStage = {
  name: 'terminalCleanup',
  matches: (f) => TURN_TERMINALS.has(f.type) && !!f.sessionID,
  // P0-2：per-prompt 预算 guard 回合终态清理（三终态；防上次预算泄漏到
  // 后续无预算 prompt。goal guard 不在此列——其生命周期是整个 goal）。
  run: (f, _evt, ctx) => {
    const { type } = f;
    const sessionID = f.sessionID as string;
    if (ctx.promptBudgetSessions().delete(sessionID)) ctx.budgetGuards().delete(sessionID);
    // busy 清除 + 队列续发（每终态一条，fire-and-forget）
    ctx.busySessions().delete(sessionID);
    // T2-2：run 状态收尾/落定（resumed 才 finish；suspend 的 abort 终态只 settle）
    try {
      ctx.runCoordinator()?.onTerminal(
        sessionID,
        type === MAFW.turnCompleted ? 'completed' : type === MAFW.turnFailed ? 'failed' : 'aborted',
      );
    } catch (err: any) {
      log.warn(`[Run] terminal handling failed for ${sessionID} (non-fatal): ${err?.message ?? err}`);
    }
    ctx.flushSessionQueue(sessionID);
  },
};

// ── 16. 内部会话链中丢弃（HALT；仅 turn 终态放行） ────────────────────────
const internalFilter: DispatchStage = {
  name: 'internalFilter',
  matches: (f, _evt, ctx) => isMemoryWorker(f.sessionID, ctx) && !TURN_TERMINALS.has(f.type),
  // Only memory-system sessions (index-scan / extract / reflect workers) are
  // internal: their token-level deltas flooded the desktop renderer (per-delta
  // store writes + re-render storms froze the UI). Tiered policy for them:
  // token noise dropped; lifecycle events (idle/error) still broadcast, tagged
  // `internal`, so the UI can surface pipeline status. Every other session —
  // user chats AND manager goal sessions — passes through untouched.
  run: () => 'halt',
};

// ── 17. delta 日志抑制 ────────────────────────────────────────────────────
const partDeltaLog: DispatchStage = {
  name: 'partDeltaLog',
  matches: () => true,
  // deltas are never logged for any session (per-token lines churned the 5MB log)
  run: (f, _evt, ctx) => {
    if (f.type !== MAFW.partDelta) log.info(`[SSE] ${ctx.runtimeName()} event: ${f.type} sessionID=${f.sessionID}`);
  },
};

// ── 18. 会话活跃水位 + 自更新调用者定位 ───────────────────────────────────
const sessionActivity: DispatchStage = {
  name: 'sessionActivity',
  matches: (f) => !!f.sessionID,
  // Caller-location bookkeeping for self-update: every event refreshes the
  // session's last-active stamp; tool events carrying a shell command that
  // touches the restart token file pin the exact session that wrote it.
  run: (f, _evt, ctx) => {
    const sessionID = f.sessionID as string;
    ctx.lastActiveBySession().set(sessionID, Date.now());
    // T2-2：长回合只要有事件就刷新 busy 时间戳（15min 清扫不得误删活跃回合）。
    if (ctx.busySessions().has(sessionID)) ctx.busySessions().set(sessionID, Date.now());
    if (f.toolCommand) {
      if (/pending-restart/i.test(f.toolCommand)) {
        ctx.setTokenWriterSession({ sessionID, at: Date.now() });
      }
      ctx.lastWriteBySession().set(sessionID, { at: Date.now(), command: f.toolCommand });
    }
  },
};

// ── 19. Path T：trajectory 累加 + trajectory.event 派生广播 ───────────────
const trajectoryHandle: DispatchStage = {
  name: 'trajectoryHandle',
  matches: () => true,
  // Path T: trajectory accumulation — writes SQLite + broadcasts trajectory.event/trajectory.turn
  run: (f, _evt, ctx) => {
    const { type, properties: props, sessionID } = f;
    const memoryWorker = isMemoryWorker(sessionID, ctx);
    try {
      if (!memoryWorker) {
        const collector = ctx.trajectoryCollector();
        if (collector) {
          const trajEvt = collector.handleEvent(type, props, f.directory);
          if (trajEvt) {
            ctx.broadcast(mafwBroadcast({ type: MAFW.trajectoryEvent, properties: trajEvt, sessionID }, memoryWorker));
          }
        }
      }
    } catch (err: any) {
      log.warn(`[Trajectory] handle failed (non-fatal): ${err.message}`);
    }
  },
};

// ── 20. 会话压缩 flush（fire-and-forget，skip 策略） ──────────────────────
const compactionFlush: DispatchStage = {
  name: 'compactionFlush',
  matches: (f, _evt, ctx) => !!f.compaction && !!f.sessionID && !isMemoryWorker(f.sessionID, ctx),
  // Compaction flush: 会话压缩发生时把该 session 的 pending T1 回合立即喂给
  // turnCompress（fail-open；同 session 的 flush 在飞则跳过本轮）。Per-session
  // mutexKey 与 hourly cron 的 action key 不同，互不阻塞（pipeline 内部有
  // per-session runExclusive 兜底）。
  run: (f, _evt, ctx) => {
    const sessionID = f.sessionID as string;
    void ctx.scheduler()
      .submit(
        {
          id: `compact-flush:${sessionID}`,
          priority: 'background',
          mutexKey: `compact-flush:${sessionID}`,
          strategy: 'skip',
          timeoutMs: 30 * 60_000,
        },
        async () => {
          try {
            const pipeline = ctx.getTurnPipeline();
            const res = await pipeline.runSession(sessionID);
            if (res.turns > 0) {
              log.info(`[TurnPipeline] compaction flush session=${sessionID} turns=${res.turns} archived=${res.archived}`);
              ctx.scanService()?.refreshCache();
            }
          } catch (err: any) {
            log.warn(`[TurnPipeline] compaction flush failed (non-fatal): ${err.message}`);
          }
        },
      )
      .catch((err) => {
        if (err instanceof TaskSkippedError) {
          log.info(`[TurnPipeline] compaction flush ${sessionID} skipped: previous flush in flight`);
          return;
        }
        if (err instanceof TaskTimeoutError) {
          log.warn(`[TurnPipeline] compaction flush ${sessionID} watchdog timeout`);
          return;
        }
        log.warn(`[TurnPipeline] compaction flush ${sessionID} submit failed (non-fatal): ${err instanceof Error ? err.message : err}`);
      });
  },
};

// ── 21. BudgetGuard step（goal-session 硬停） ──────────────────────────────
const budgetStep: DispatchStage = {
  name: 'budgetStep',
  matches: (f) => !!f.step && !!f.sessionID,
  // BudgetGuard: goal-session turn/cost hard stop (turnBudgetApi-lacking
  // runtimes). Guard auto-detonates once → detach.
  run: (f, _evt, ctx) => {
    const sessionID = f.sessionID as string;
    const guard = ctx.budgetGuards().get(sessionID);
    if (guard) {
      guard.onStep();
      if (guard.triggered) ctx.budgetGuards().delete(sessionID);
    }
  },
};

// ── 22. Per-session SSE（Mode B）转发 ─────────────────────────────────────
const modeBDelta: DispatchStage = {
  name: 'modeBDelta',
  matches: (f, _evt, ctx) => !!f.sessionID && ctx.chatSessions().hasListeners(f.sessionID),
  // Per-session SSE (Mode B) forwarding
  run: (f, _evt, ctx) => {
    const sessionID = f.sessionID as string;
    if (f.chatSignal === 'delta' && f.deltaText) {
      ctx.chatSessions().pushDelta(sessionID, f.deltaText);
    } else if (f.chatSignal === 'complete') {
      ctx.chatSessions().pushComplete(sessionID);
    } else if (f.chatSignal === 'error') {
      ctx.chatSessions().pushError(sessionID, String(f.chatError || 'Unknown error'));
    }
  },
};

// ── 23. 回合聚合 + usage 合成（派生广播，先于 passthrough） ────────────────
const turnIdleAggregate: DispatchStage = {
  name: 'turnIdleAggregate',
  matches: (f) => f.type === MAFW.turnCompleted && !!f.sessionID,
  // Global broadcast (Mode A — used by the desktop renderer).
  // v2：Mode A 改写 hack（session.idle→message.complete / session.error→
  // message.error）已删除——turn.completed/turn.failed 是词汇一等公民，翻译层
  // 直接产出；回合聚合与 usage 合成挂在 turn.completed，广播统一 passthrough。
  run: (f, _evt, ctx) => {
    const sessionID = f.sessionID as string;
    const memoryWorker = isMemoryWorker(sessionID, ctx);
    try {
      const collector = ctx.trajectoryCollector();
      if (collector) {
        const turn = collector.onIdle(sessionID);
        if (turn) {
          ctx.broadcast(mafwBroadcast({ type: MAFW.trajectoryTurn, properties: turn, sessionID }, memoryWorker));
          // v2 增量：usage.updated 从回合聚合合成（tokens/cost 汇总；Tier 0 之外
          // 的可选组，desktop UsagePill 事件化消费留后续，轮询保留兜底）。
          if (turn.tokens || turn.cost) {
            ctx.broadcast(mafwBroadcast({
              type: MAFW.usageUpdated,
              properties: { tokens: turn.tokens, cost: turn.cost, model: turn.model, provider: turn.provider, turnID: turn.turnID },
              sessionID,
            }, memoryWorker));
          }
        }
      }
    } catch (err: any) {
      log.warn(`[Trajectory] turn aggregation failed (non-fatal): ${err.message}`);
    }
  },
};

// ── 24. 统一 passthrough 广播（恒为最后一段） ─────────────────────────────
const finalBroadcast: DispatchStage = {
  name: 'finalBroadcast',
  matches: () => true,
  run: (f, _evt, ctx) => {
    // turn.failed 保留 error 字段提取（消费方错误展示的 wire 契约）；其余 passthrough。
    const errorText = f.type === MAFW.turnFailed
      ? (f.properties?.error instanceof Error ? f.properties.error.message : String(f.properties?.error ?? 'Unknown error'))
      : undefined;
    ctx.broadcast(mafwBroadcast(
      {
        type: f.type, properties: f.properties, sessionID: f.sessionID,
        directory: f.directory,
        ...(errorText !== undefined ? { error: errorText } : {}),
      },
      isMemoryWorker(f.sessionID, ctx),
    ));
  },
};

/**
 * 有序 stage 表 —— **数组位置就是执行顺序**（Ruling D2-R1）。
 * 24 段与 legacy `handleRuntimeEvent` 的块一一对应，顺序逐字保持。
 */
export const DISPATCH_STAGES: DispatchStage[] = [
  nativeDrop,          //  1
  toolPrimitiveDrop,   //  2
  malformedWarn,       //  3
  unknownTypeTelemetry,//  4
  enrichToolIdentityStage, // 5
  conformanceTap,      //  6
  goalActivity,        //  7
  turnStartedBusy,     //  8
  backgroundJob,       //  9
  approvalPolicy,      // 10
  permissionEnrich,    // 11
  questionRequest,     // 12
  identityClearTurn,   // 13
  autoCheckpoint,      // 14
  terminalCleanup,     // 15
  internalFilter,      // 16
  partDeltaLog,        // 17
  sessionActivity,     // 18
  trajectoryHandle,    // 19
  compactionFlush,     // 20
  budgetStep,          // 21
  modeBDelta,          // 22
  turnIdleAggregate,   // 23
  finalBroadcast,      // 24
];

/** stage 名 → 位置（拓扑断言用；未知名抛错，不返回 -1 静默通过）。 */
export function stageIndex(name: string): number {
  const index = DISPATCH_STAGES.findIndex((stage) => stage.name === name);
  if (index < 0) throw new Error(`unknown dispatch stage: ${name}`);
  return index;
}

/**
 * 执行整条链：`matches` → `run`；`'halt'` 停掉全部下游。
 * 不加 pipeline 级 try/catch —— legacy 没有（段内各自 fail-open）。
 */
export function runEventPipeline(f: EventFacets, evt: any, ctx: DispatchCtx): void {
  for (const stage of DISPATCH_STAGES) {
    if (!stage.matches(f, evt, ctx)) continue;
    if (stage.run(f, evt, ctx) === 'halt') return;
  }
}
