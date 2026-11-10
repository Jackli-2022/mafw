/**
 * D2 Task 1（RED-first）+ Task 3（Review Focus 行为钉扎）：
 * `handleRuntimeEvent` 抽取为有序 stage 表后的**拓扑 + 行为守卫**。
 *
 * 表的位置就是执行顺序（Ruling D2-R1：没有 `order: number` 冗余字段），因此
 * 拓扑约束一律用 `stageIndex(name)` 比较表达——名字是稳定锚点，插入/重排会被
 * 这里抓住，而不是靠人工读 277 行 if 链。
 *
 * 钉的是 legacy 链里的 5 条**只写在注释里**的次序契约（Ruling D2-R3）：
 *   - approval 先于 internal drop（内部会话 fail-safe 必须在 memoryWorker 丢弃前生效）；
 *   - conformance tap 先于 internal drop（tap 要看到该会话全量事件）；
 *   - autoCheckpoint 先于 memoryWorker 早退（门控在 runAutoCheckpoint 内，role 门兜底）；
 *   - enrichToolIdentity 先于 conformance tap（tap 快照必须看到 toolClass）；
 *   - internalFilter 先于 trajectoryHandle（worker 的 token 噪声不得进 trajectory）；
 *   - finalBroadcast 恒为最后一段（派生广播先于 passthrough）。
 *
 * Task 3 用**真实** `DISPATCH_STAGES` + `runEventPipeline`（不 mock 管线本身）+
 * 录制型 fake `DispatchCtx`，把 Review Focus 的 5 个失败模式钉成可执行断言：
 *   (a) 内部会话 drop 语义（非终态 halt + 终态仍出站）；
 *   (b) 派生广播先于 passthrough 的 seq 次序；
 *   (c) 终态 4 步微观次序；
 *   (d) approval 同步评估（无延后）+ 抛错语义（hook 内 fail-open；管线级无 try/catch）；
 *   (e) enrich 先于 tap 快照（tap 看到的是富化后的载荷）。
 * 外加矩阵交叉校验：两段丢弃门的命中集必须恰等于矩阵里声明的丢弃集。
 */
import {
  DISPATCH_STAGES,
  runEventPipeline,
  stageIndex,
  type DispatchCtx,
} from '../../../src/runtime/event-dispatch';
import { normalizeOpencodeEvent, type EventFacets } from '../../../src/runtime/normalize';
import { EVENT_FLOW_MATRIX, RUNTIME_NATIVE_DROPPED } from '../../../src/runtime/event-flow-matrix';
import { TOOL_PRIMITIVE_TYPES } from '../../../src/runtime/tool-part-assembler';
import { isKnownEventType } from '../../../src/runtime/event-telemetry';
import { MAFW } from '../../../src/runtime/mafw-vocabulary';
import { TtlMap } from '../../../src/concurrency/ttl-map';
import { appendApprovalRecord } from '../../../src/core/approval/decision-log';

// 审批评估会落一行 approval-decisions.jsonl（decision-log.ts 直写 ~/.mafw/logs）。
// 只 mock 这个**叶子**副作用，管线与 hook 本身保持真实。
jest.mock('../../../src/core/approval/decision-log', () => ({
  appendApprovalRecord: jest.fn(),
}));
const appendApprovalRecordMock = appendApprovalRecord as unknown as jest.Mock;

// ─────────────────────────────────────────────────────────────────────────────
// 录制型 fake DispatchCtx（established wiring-test style：真实模块 + 录制 fake）
// ─────────────────────────────────────────────────────────────────────────────

interface BroadcastRecord {
  type: string;
  data: { type: string; properties?: any; sessionID?: string; directory?: string; error?: string; internal?: boolean };
}

/** 带 tag 的 Set/Map：把「谁先删」录进 timeline（终态 4 步微观次序用）。 */
class RecordingSet<T> extends Set<T> {
  constructor(private readonly tag: string, private readonly timeline: string[], values: T[] = []) {
    super(values);
  }

  override delete(value: T): boolean {
    const removed = super.delete(value);
    this.timeline.push(`${this.tag}.delete`);
    return removed;
  }
}

class RecordingMap<K, V> extends Map<K, V> {
  constructor(private readonly tag: string, private readonly timeline: string[], entries: Array<[K, V]> = []) {
    super(entries);
  }

  override delete(key: K): boolean {
    const removed = super.delete(key);
    this.timeline.push(`${this.tag}.delete`);
    return removed;
  }
}

interface WorldOptions {
  /** sessionID → internal role（memoryWorker 判定）。 */
  roles?: Record<string, string>;
  /** turn 终态前已在 busy / per-prompt 预算里的会话（终态清理断言用）。 */
  busy?: string[];
  promptBudget?: string[];
}

interface TrajectoryStub {
  handleEvent?: (type: string, props: any, directory?: string) => any;
  onIdle?: (sessionID: string) => any;
}

interface World {
  ctx: DispatchCtx;
  timeline: string[];
  broadcasts: BroadcastRecord[];
  trajectoryCalls: Array<{ type: string; props: any }>;
  taps: TtlMap<string, Set<(snap: { type: string; sessionID?: string; at: number; part?: any }) => void>>;
  lastActive: Map<string, number>;
  /** 可变旋钮（fake 成员读它，测试里按需改写）。 */
  cfg: {
    collector: TrajectoryStub | null;
    policy: any;
    runCoordinator: any;
    /** sessionActivity 的 lastActiveBySession 抛错（钉「管线级无 try/catch」）。 */
    lastActiveThrows: boolean;
  };
}

function makeWorld(options: WorldOptions = {}): World {
  const timeline: string[] = [];
  const broadcasts: BroadcastRecord[] = [];
  const trajectoryCalls: Array<{ type: string; props: any }> = [];
  const lastActive = new Map<string, number>();
  const lastWrite = new Map<string, { at: number; command: string }>();
  const taps = new TtlMap<string, Set<any>>(5 * 60_000);
  const roles = new Map<string, string>(Object.entries(options.roles ?? {}));
  const busy = new RecordingMap<string, number>('busySessions', timeline, (options.busy ?? []).map((s) => [s, Date.now()]));
  const promptBudget = new RecordingSet<string>('promptBudget', timeline, options.promptBudget ?? []);
  const budgetGuards = new RecordingMap<string, any>('budgetGuards', timeline);
  let tokenWriter: { sessionID: string; at: number } | null = null;

  const cfg: World['cfg'] = {
    collector: null,
    policy: { probeScope: () => undefined, evaluate: () => ({ action: 'human', verdict: 'normal', reason: 'default' }) },
    runCoordinator: null,
    lastActiveThrows: false,
  };

  const ctx = {
    runtimeName: () => 'test-runtime',
    malformedEventWarnAt: () => new Map<string, number>(),
    unknownEventTracker: () => ({ record: () => ({ firstSeen: false, total: 1 }) }),
    eventTaps: () => taps,
    goalDriver: () => null,
    busySessions: () => busy,
    runCoordinator: () => cfg.runCoordinator,
    backgroundShells: () => ({ apply: () => undefined }),
    approvalPolicy: () => cfg.policy,
    runtime: () => null,
    identityState: () => ({ clearTurnBindings: () => undefined }),
    recordAutoCheckpoint: async () => { timeline.push('checkpoint'); },
    promptBudgetSessions: () => promptBudget,
    budgetGuards: () => budgetGuards,
    flushSessionQueue: (sessionID: string) => { timeline.push(`queue.flush:${sessionID}`); },
    internalSessionRoles: () => ({ get: (id: string) => roles.get(id) }),
    lastActiveBySession: () => {
      if (cfg.lastActiveThrows) throw new Error('last-active boom');
      return lastActive;
    },
    getTokenWriterSession: () => tokenWriter,
    setTokenWriterSession: (value: { sessionID: string; at: number }) => { tokenWriter = value; },
    lastWriteBySession: () => lastWrite,
    trajectoryCollector: () => {
      const collector = cfg.collector;
      if (!collector) return null;
      return {
        handleEvent: (type: string, props: any, directory?: string) => {
          trajectoryCalls.push({ type, props });
          timeline.push(`trajectory.handleEvent:${type}`);
          return collector.handleEvent ? collector.handleEvent(type, props, directory) : null;
        },
        onIdle: (sessionID: string) => {
          timeline.push('trajectory.onIdle');
          return collector.onIdle ? collector.onIdle(sessionID) : null;
        },
      };
    },
    broadcast: (event: BroadcastRecord) => {
      broadcasts.push(event);
      timeline.push(`broadcast:${event.data.type}`);
    },
    scheduler: () => ({ submit: () => Promise.resolve() }),
    getTurnPipeline: () => ({ runSession: async () => ({ turns: 0, archived: 0 }) }),
    scanService: () => null,
    chatSessions: () => ({
      hasListeners: () => false,
      pushDelta: () => undefined,
      pushComplete: () => undefined,
      pushError: () => undefined,
    }),
  } as unknown as DispatchCtx;

  return { ctx, timeline, broadcasts, trajectoryCalls, taps, lastActive, cfg };
}

/** 生产形状的信封事件（GlobalEvent：type/properties 在 payload 内）。 */
function envelopeEvent(type: string, properties: any = {}, extra: any = {}) {
  return { directory: '/repo', ...extra, payload: { type, properties } };
}

/** 走真实 normalize + 真实管线，返回 facets（properties 与 raw 共享引用）。 */
function dispatch(world: World, type: string, properties: any = {}, extra: any = {}): EventFacets {
  const evt = envelopeEvent(type, properties, extra);
  const f = normalizeOpencodeEvent(evt);
  runEventPipeline(f, evt, world.ctx);
  return f;
}

describe('D2 dispatch stage table', () => {
  it('is a non-empty ordered array with unique stage names', () => {
    expect(Array.isArray(DISPATCH_STAGES)).toBe(true);
    expect(DISPATCH_STAGES.length).toBeGreaterThan(0);
    const names = DISPATCH_STAGES.map((s) => s.name);
    expect(names.every((name) => typeof name === 'string' && name.length > 0)).toBe(true);
    expect(new Set(names).size).toBe(names.length);
  });

  it('every stage exposes matches + run', () => {
    for (const stage of DISPATCH_STAGES) {
      expect(typeof stage.matches).toBe('function');
      expect(typeof stage.run).toBe('function');
    }
  });

  it('approval policy runs before the internal-session drop', () => {
    expect(stageIndex('approvalPolicy')).toBeLessThan(stageIndex('internalFilter'));
  });

  it('conformance tap runs before the internal-session drop', () => {
    expect(stageIndex('conformanceTap')).toBeLessThan(stageIndex('internalFilter'));
  });

  it('auto-checkpoint runs before the memoryWorker early return', () => {
    expect(stageIndex('autoCheckpoint')).toBeLessThan(stageIndex('internalFilter'));
  });

  it('tool identity enrichment runs before the conformance tap snapshot', () => {
    expect(stageIndex('enrichToolIdentity')).toBeLessThan(stageIndex('conformanceTap'));
  });

  it('the worker drop runs before trajectory accumulation', () => {
    expect(stageIndex('internalFilter')).toBeLessThan(stageIndex('trajectoryHandle'));
  });

  it('the passthrough broadcast is the final stage', () => {
    expect(stageIndex('finalBroadcast')).toBe(DISPATCH_STAGES.length - 1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (a) 内部会话 drop 语义：非终态 halt（无 trajectory / 无广播），终态仍出站
// ─────────────────────────────────────────────────────────────────────────────
describe('(a) internal-session drop semantics', () => {
  it.each([MAFW.partUpdated, MAFW.partDelta, MAFW.messageUpdated, MAFW.turnStarted])(
    'a memoryWorker non-terminal event (%s) halts before trajectoryHandle and finalBroadcast',
    (type) => {
      const world = makeWorld({ roles: { w1: 'extract' } });

      dispatch(world, type, { sessionID: 'w1', part: { type: 'text', text: 'worker token' }, delta: 'x' });

      // 一个客户端帧都不写（无 Mode A passthrough、无派生 trajectory.event）。
      expect(world.broadcasts).toEqual([]);
      // trajectory 累加器从未被触碰（worker 的 token 噪声不得进 Path T）。
      expect(world.trajectoryCalls).toEqual([]);
      // HALT 停掉**全部**下游：连 sessionActivity 的 last-active 水位都不该被刷新。
      expect(world.lastActive.size).toBe(0);
      expect(world.timeline).toEqual([]);
    },
  );

  it.each([MAFW.turnCompleted, MAFW.turnFailed, MAFW.turnAborted])(
    "a worker's %s (terminal) still reaches finalBroadcast",
    (type) => {
      const world = makeWorld({ roles: { w1: 'extract' } });

      dispatch(world, type, { sessionID: 'w1' });

      // 终态放行：恰好一帧 passthrough，带 internal 标记（UI 仍能看到管线状态）。
      expect(world.broadcasts.map((b) => b.data.type)).toEqual([type]);
      expect(world.broadcasts[0].data.internal).toBe(true);
      expect(world.broadcasts[0].data.sessionID).toBe('w1');
      // 但 worker 的 token 噪声仍不进 trajectory（stage 19 自带的 role 门）。
      expect(world.trajectoryCalls).toEqual([]);
    },
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// (b) 派生 vs passthrough 的 seq 次序（一个 turn.completed）
// ─────────────────────────────────────────────────────────────────────────────
describe('(b) derived-vs-passthrough broadcast order', () => {
  it('turn.completed broadcasts trajectory.event → trajectory.turn + usage.updated → passthrough', () => {
    const world = makeWorld();
    world.cfg.collector = {
      handleEvent: () => ({ eventType: 'turn', seq: 1, sessionID: 's1' }),
      onIdle: () => ({ turnID: 't1', tokens: { input: 3, output: 5 }, cost: 0.25, model: 'm', provider: 'p' }),
    };

    dispatch(world, MAFW.turnCompleted, { sessionID: 's1' });

    expect(world.broadcasts.map((b) => b.data.type)).toEqual([
      MAFW.trajectoryEvent,   // stage 19（Path T 派生）
      MAFW.trajectoryTurn,    // stage 23（回合聚合派生）
      MAFW.usageUpdated,      // stage 23（usage 合成派生）
      MAFW.turnCompleted,     // stage 24（passthrough）
    ]);
    // EventStore 只有一个 sink：全部经 mafw_event 信封，且 passthrough 仍带 sessionID。
    expect(world.broadcasts.every((b) => b.type === 'mafw_event')).toBe(true);
    expect(world.broadcasts[3].data.sessionID).toBe('s1');
    // 拓扑锚点（次序不是巧合，而是表位置）。
    expect(stageIndex('trajectoryHandle')).toBeLessThan(stageIndex('turnIdleAggregate'));
    expect(stageIndex('turnIdleAggregate')).toBeLessThan(stageIndex('finalBroadcast'));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (c) 终态 4 步微观次序：预算 → busy → run 收尾 → 队列续发
// ─────────────────────────────────────────────────────────────────────────────
describe('(c) terminal 4-step micro-order', () => {
  it.each([
    [MAFW.turnCompleted, 'completed'],
    [MAFW.turnFailed, 'failed'],
    [MAFW.turnAborted, 'aborted'],
  ])('%s clears budget → busy → run terminal → queue flush', (type, kind) => {
    const world = makeWorld({ busy: ['s1'], promptBudget: ['s1'] });
    world.cfg.runCoordinator = {
      onTurnStarted: () => undefined,
      onTerminal: (sessionID: string, outcome: string) => world.timeline.push(`run.onTerminal:${sessionID}:${outcome}`),
    };

    dispatch(world, type, { sessionID: 's1' });

    const trail = world.timeline.filter((entry) => /^(promptBudget|budgetGuards|busySessions|run\.onTerminal|queue\.flush)/.test(entry));
    expect(trail).toEqual([
      'promptBudget.delete',
      'budgetGuards.delete',
      'busySessions.delete',
      `run.onTerminal:s1:${kind}`,
      'queue.flush:s1',
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (d) approval 同步评估 + 抛错语义
// ─────────────────────────────────────────────────────────────────────────────
describe('(d) sync approval evaluation', () => {
  const approvalEvent = () =>
    envelopeEvent(MAFW.permissionAsked, { sessionID: 's1', requestId: 'r1', permission: 'bash', patterns: ['rm -rf *'] });

  it('evaluate runs synchronously before runEventPipeline returns (no deferral)', () => {
    const world = makeWorld();
    let pipelineReturned = false;
    const calls: Array<{ sessionID: string; toolName: string; pipelineReturned: boolean }> = [];
    const decision = { action: 'human' as const, verdict: 'normal' as const, reason: 'test policy' };
    world.cfg.policy = {
      probeScope: () => undefined,
      evaluate: (sessionID: string, candidate: any) => {
        calls.push({ sessionID, toolName: candidate.toolName, pipelineReturned });
        world.timeline.push('approval.evaluate');
        return decision;
      },
    };

    const evt = approvalEvent();
    const f = normalizeOpencodeEvent(evt);
    runEventPipeline(f, evt, world.ctx);
    pipelineReturned = true;

    // 评估在管线返回**之前**完成（同 tick，无 setImmediate/await 延后）。
    expect(calls).toEqual([{ sessionID: 's1', toolName: 'bash', pipelineReturned: false }]);
    // 结果已富化到载荷上，供三端分流（非 human = 直接渲染已决记录）。
    expect(f.properties.mafwPolicy).toEqual(decision);
    // 次序：approval（stage 10）在 passthrough 广播（stage 24）之前。
    expect(world.timeline.indexOf('approval.evaluate')).toBeLessThan(world.timeline.indexOf(`broadcast:${MAFW.permissionAsked}`));
    // 判决已落决策日志（供离线校准）。
    expect(appendApprovalRecordMock).toHaveBeenCalledWith(
      expect.objectContaining({ e: 'eval', requestId: 'r1', sessionID: 's1', tool: 'bash', action: 'human' }),
    );
  });

  it('a thrown evaluate is fail-open inside the hook: chain still completes (hook.ts semantics)', () => {
    // 说明：legacy 的 applyApprovalPolicy 自带 try/catch（approval/hook.ts:57-60），
    // evaluate 抛错 → 不富化（下游当 human）→ 链继续。这里钉的是**真实**语义。
    const world = makeWorld();
    world.cfg.policy = {
      probeScope: () => undefined,
      evaluate: () => { throw new Error('evaluate boom'); },
    };

    const evt = approvalEvent();
    const f = normalizeOpencodeEvent(evt);
    expect(() => runEventPipeline(f, evt, world.ctx)).not.toThrow();

    expect(f.properties.mafwPolicy).toBeUndefined();
    // 链未被中断：passthrough 仍然发生。
    expect(world.broadcasts.map((b) => b.data.type)).toEqual([MAFW.permissionAsked]);
  });

  it('the pipeline itself has no try/catch: a stage throw aborts the chain immediately', () => {
    // 钉「edge 抛错立刻冒泡、下游不再执行」——管线级不兜底（兜底在各段自己的
    // try/catch 里；sessionActivity 没有，所以它抛 = 链断）。
    const world = makeWorld();
    world.cfg.lastActiveThrows = true;

    expect(() => dispatch(world, MAFW.partUpdated, { sessionID: 's1', part: { type: 'text', text: 'x' } }))
      .toThrow('last-active boom');
    expect(world.broadcasts).toEqual([]);
    expect(world.trajectoryCalls).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (e) enrich 先于 tap 快照
// ─────────────────────────────────────────────────────────────────────────────
describe('(e) enrich-before-tap', () => {
  it('enrichToolIdentity mutates the event before the conformance tap snapshots it', () => {
    const world = makeWorld();
    const observed: Array<{ toolClass?: string; canonicalTool?: string }> = [];
    world.taps.set('s1', new Set([
      (snap: { part?: any }) => {
        world.timeline.push('tap');
        // 在回调里**立即**读取（不是延后看引用）：只有 enrich 已跑过才会有值。
        observed.push({ toolClass: snap.part?.toolClass, canonicalTool: snap.part?.canonicalTool });
      },
    ]));

    // toolClass/canonicalTool 用访问器记录写入时刻 → 得到真实的 mutation 次序。
    const part: any = { type: 'tool', tool: 'shell', state: { input: { command: 'ls' } } };
    let toolClass: string | undefined;
    let canonicalTool: string | undefined;
    Object.defineProperty(part, 'toolClass', {
      enumerable: true,
      configurable: true,
      get: () => toolClass,
      set: (value: string) => { toolClass = value; world.timeline.push(`enrich:toolClass=${value}`); },
    });
    Object.defineProperty(part, 'canonicalTool', {
      enumerable: true,
      configurable: true,
      get: () => canonicalTool,
      set: (value: string) => { canonicalTool = value; world.timeline.push(`enrich:canonicalTool=${value}`); },
    });

    dispatch(world, MAFW.partUpdated, { sessionID: 's1', part });

    // mutation 次序：两次 enrich 写入都发生在 tap 回调之前。
    const tapAt = world.timeline.indexOf('tap');
    expect(tapAt).toBeGreaterThan(-1);
    expect(world.timeline.indexOf('enrich:toolClass=shell')).toBeGreaterThan(-1);
    expect(world.timeline.indexOf('enrich:toolClass=shell')).toBeLessThan(tapAt);
    expect(world.timeline.indexOf('enrich:canonicalTool=bash')).toBeLessThan(tapAt);
    // tap 看到的是**富化后**的载荷（shell → toolClass=shell / canonicalTool=bash）。
    expect(observed).toEqual([{ toolClass: 'shell', canonicalTool: 'bash' }]);
    // 下游广播同样带着富化字段（conformance 工具可见性依赖它）。
    const broadcastPart = world.broadcasts[0].data.properties.part;
    expect(broadcastPart.toolClass).toBe('shell');
    expect(broadcastPart.canonicalTool).toBe('bash');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 矩阵交叉校验（D2-R2）：两个早期丢弃门的命中集 == 矩阵声明的丢弃集
// ─────────────────────────────────────────────────────────────────────────────
describe('matrix cross-check: drop gates == declared drop sets', () => {
  /** 候选全集：canonical 矩阵 keys + 两个丢弃集 + 一个插件命名空间 + 无 type。 */
  const universe = Array.from(new Set([
    ...Object.keys(EVENT_FLOW_MATRIX),
    ...RUNTIME_NATIVE_DROPPED,
    ...TOOL_PRIMITIVE_TYPES,
    'plugin:custom.event',
    '',
  ]));

  const facetsOf = (type: string) => normalizeOpencodeEvent({ directory: '/repo', payload: { type, properties: { sessionID: 's1' } } });
  const stage = (name: string) => {
    const found = DISPATCH_STAGES.find((s) => s.name === name);
    if (!found) throw new Error(`missing stage ${name}`);
    return found;
  };

  it('nativeDrop fires exactly for RUNTIME_NATIVE_DROPPED members (and halts)', () => {
    const world = makeWorld();
    const nativeDrop = stage('nativeDrop');
    const fired = universe.filter((type) => nativeDrop.matches(facetsOf(type), { type }, world.ctx));
    expect(fired.sort()).toEqual(Array.from(RUNTIME_NATIVE_DROPPED).sort());
    for (const type of RUNTIME_NATIVE_DROPPED) {
      expect(nativeDrop.run(facetsOf(type), { type }, world.ctx)).toBe('halt');
    }
    // 非成员放行门。
    expect(nativeDrop.matches(facetsOf(MAFW.turnCompleted), { type: MAFW.turnCompleted }, world.ctx)).toBe(false);
  });

  it('toolPrimitiveDrop fires exactly for TOOL_PRIMITIVE_TYPES members (and halts)', () => {
    const world = makeWorld();
    const toolPrimitiveDrop = stage('toolPrimitiveDrop');
    const fired = universe.filter((type) => toolPrimitiveDrop.matches(facetsOf(type), { type }, world.ctx));
    expect(fired.sort()).toEqual(Array.from(TOOL_PRIMITIVE_TYPES).sort());
    for (const type of TOOL_PRIMITIVE_TYPES) {
      expect(toolPrimitiveDrop.run(facetsOf(type), { type }, world.ctx)).toBe('halt');
    }
    expect(toolPrimitiveDrop.matches(facetsOf(MAFW.partUpdated), { type: MAFW.partUpdated }, world.ctx)).toBe(false);
  });

  it.each(Array.from(RUNTIME_NATIVE_DROPPED))('%s halts the pipeline before any broadcast', (type) => {
    const world = makeWorld();
    dispatch(world, type, { sessionID: 's1' });
    expect(world.broadcasts).toEqual([]);
    expect(world.timeline).toEqual([]);
  });

  it.each(Array.from(TOOL_PRIMITIVE_TYPES))('%s halts the pipeline before any broadcast', (type) => {
    const world = makeWorld();
    dispatch(world, type, { sessionID: 's1' });
    expect(world.broadcasts).toEqual([]);
    expect(world.timeline).toEqual([]);
  });

  it('dropped types never enter the canonical client matrix (drop ≠ canonical contract)', () => {
    for (const type of [...RUNTIME_NATIVE_DROPPED, ...TOOL_PRIMITIVE_TYPES]) {
      expect(EVENT_FLOW_MATRIX[type]).toBeUndefined();
    }
    // 丢弃 ≠ 未知：nativeDrop 的类型不触发 unknown 遥测（fail-open 诊断噪点）。
    for (const type of RUNTIME_NATIVE_DROPPED) {
      expect(isKnownEventType(type)).toBe(true);
    }
  });
});
