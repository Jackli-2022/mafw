/**
 * D2 Task 1锛圧ED-first锛? Task 3锛圧eview Focus 琛屼负閽夋墡锛夛細
 * `handleRuntimeEvent` 鎶藉彇涓烘湁搴?stage 琛ㄥ悗鐨?*鎷撴墤 + 琛屼负瀹堝崼**銆?
 *
 * 琛ㄧ殑浣嶇疆灏辨槸鎵ц椤哄簭锛圧uling D2-R1锛氭病鏈?`order: number` 鍐椾綑瀛楁锛夛紝鍥犳
 * 鎷撴墤绾︽潫涓€寰嬬敤 `stageIndex(name)` 姣旇緝琛ㄨ揪鈥斺€斿悕瀛楁槸绋冲畾閿氱偣锛屾彃鍏?閲嶆帓浼氳
 * 杩欓噷鎶撲綇锛岃€屼笉鏄潬浜哄伐璇?277 琛?if 閾俱€?
 *
 * 閽夌殑鏄?legacy 閾鹃噷鐨?5 鏉?*鍙啓鍦ㄦ敞閲婇噷**鐨勬搴忓绾︼紙Ruling D2-R3锛夛細
 *   - approval 鍏堜簬 internal drop锛堝唴閮ㄤ細璇?fail-safe 蹇呴』鍦?memoryWorker 涓㈠純鍓嶇敓鏁堬級锛?
 *   - conformance tap 鍏堜簬 internal drop锛坱ap 瑕佺湅鍒拌浼氳瘽鍏ㄩ噺浜嬩欢锛夛紱
 *   - autoCheckpoint 鍏堜簬 memoryWorker 鏃╅€€锛堥棬鎺у湪 runAutoCheckpoint 鍐咃紝role 闂ㄥ厹搴曪級锛?
 *   - enrichToolIdentity 鍏堜簬 conformance tap锛坱ap 蹇収蹇呴』鐪嬪埌 toolClass锛夛紱
 *   - internalFilter 鍏堜簬 trajectoryHandle锛坵orker 鐨?token 鍣０涓嶅緱杩?trajectory锛夛紱
 *   - finalBroadcast 鎭掍负鏈€鍚庝竴娈碉紙娲剧敓骞挎挱鍏堜簬 passthrough锛夈€?
 *
 * Task 3 鐢?*鐪熷疄** `DISPATCH_STAGES` + `runEventPipeline`锛堜笉 mock 绠＄嚎鏈韩锛?
 * 褰曞埗鍨?fake `DispatchCtx`锛屾妸 Review Focus 鐨?5 涓け璐ユā寮忛拤鎴愬彲鎵ц鏂█锛?
 *   (a) 鍐呴儴浼氳瘽 drop 璇箟锛堥潪缁堟€?halt + 缁堟€佷粛鍑虹珯锛夛紱
 *   (b) 娲剧敓骞挎挱鍏堜簬 passthrough 鐨勬搴忥紙broadcast 鏄?EventStore 鍗曚竴 sink锛?
 *       璋冪敤搴忓嵆 seq 搴忥紱EventStore 渚ф樉寮忔柇瑷€鍦?events/broadcast-seq.test.ts锛夛紱
 *   (c) 缁堟€?4 姝ュ井瑙傛搴忥紱
 *   (d) approval 鍚屾璇勪及锛堟棤寤跺悗锛? 鎶涢敊璇箟锛坔ook 鍐?fail-open锛涚绾跨骇鏃?try/catch锛夛紱
 *   (e) enrich 鍏堜簬 tap 蹇収锛坱ap 鐪嬪埌鐨勬槸瀵屽寲鍚庣殑杞借嵎锛夈€?
 * 澶栧姞鐭╅樀浜ゅ弶鏍￠獙锛氫袱娈典涪寮冮棬鐨勫懡涓泦蹇呴』鎭扮瓑浜庣煩闃甸噷澹版槑鐨勪涪寮冮泦銆?
 */
import {
  DISPATCH_STAGES,
  runEventPipeline,
  stageIndex,
  type DispatchCtx,
  type DispatchStage,
} from '../../../src/runtime/event-dispatch';
import { normalizeRuntimeEvent, type EventFacets } from '../../../src/runtime/normalize';
import { EVENT_FLOW_MATRIX, RUNTIME_NATIVE_DROPPED } from '../../../src/runtime/event-flow-matrix';
import { TOOL_PRIMITIVE_TYPES } from '../../../src/runtime/tool-part-assembler';
import { isKnownEventType } from '../../../src/runtime/event-telemetry';
import { MAFW } from '../../../src/runtime/mafw-vocabulary';
import { TtlMap } from '../../../src/concurrency/ttl-map';
import { appendApprovalRecord } from '../../../src/core/approval/decision-log';

// 瀹℃壒璇勪及浼氳惤涓€琛?approval-decisions.jsonl锛坉ecision-log.ts 鐩村啓 ~/.mafw/logs锛夈€?
// 鍙?mock 杩欎釜**鍙跺瓙**鍓綔鐢紝绠＄嚎涓?hook 鏈韩淇濇寔鐪熷疄銆?
jest.mock('../../../src/core/approval/decision-log', () => ({
  appendApprovalRecord: jest.fn(),
}));
const appendApprovalRecordMock = appendApprovalRecord as unknown as jest.Mock;

// 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
// 褰曞埗鍨?fake DispatchCtx锛坋stablished wiring-test style锛氱湡瀹炴ā鍧?+ 褰曞埗 fake锛?
// 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

interface BroadcastRecord {
  type: string;
  data: { type: string; properties?: any; sessionID?: string; directory?: string; error?: string; internal?: boolean };
}

/** 甯?tag 鐨?Set/Map锛氭妸銆岃皝鍏堝垹銆嶅綍杩?timeline锛堢粓鎬?4 姝ュ井瑙傛搴忕敤锛夈€?*/
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
  /** sessionID 鈫?internal role锛坢emoryWorker 鍒ゅ畾锛夈€?*/
  roles?: Record<string, string>;
  /** turn 缁堟€佸墠宸插湪 busy / per-prompt 棰勭畻閲岀殑浼氳瘽锛堢粓鎬佹竻鐞嗘柇瑷€鐢級銆?*/
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
  /** 鍙彉鏃嬮挳锛坒ake 鎴愬憳璇诲畠锛屾祴璇曢噷鎸夐渶鏀瑰啓锛夈€?*/
  cfg: {
    collector: TrajectoryStub | null;
    policy: any;
    runCoordinator: any;
    /** sessionActivity 鐨?lastActiveBySession 鎶涢敊锛堥拤銆岀绾跨骇鏃?try/catch銆嶏級銆?*/
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
  } as unknown as DispatchCtx;

  return { ctx, timeline, broadcasts, trajectoryCalls, taps, lastActive, cfg };
}

/** 鐢熶骇褰㈢姸鐨勪俊灏佷簨浠讹紙GlobalEvent锛歵ype/properties 鍦?payload 鍐咃級銆?*/
function envelopeEvent(type: string, properties: any = {}, extra: any = {}) {
  return { directory: '/repo', ...extra, payload: { type, properties } };
}

/** 璧扮湡瀹?normalize + 鐪熷疄绠＄嚎锛岃繑鍥?facets锛坧roperties 涓?raw 鍏变韩寮曠敤锛夈€?*/
function dispatch(world: World, type: string, properties: any = {}, extra: any = {}): EventFacets {
  const evt = envelopeEvent(type, properties, extra);
  const f = normalizeRuntimeEvent(evt);
  runEventPipeline(f, evt, world.ctx);
  return f;
}

describe('D2 dispatch stage table', () => {
  it('is a non-empty ordered array with unique stage names', () => {
    expect(Array.isArray(DISPATCH_STAGES)).toBe(true);
    expect(DISPATCH_STAGES.length).toBe(23);
    const names = DISPATCH_STAGES.map((s) => s.name);
    expect(names.every((name) => typeof name === 'string' && name.length > 0)).toBe(true);
    expect(new Set(names).size).toBe(names.length);
    // E3-2: Mode B（per-session SSE）已删，转发段不再在链上。
    expect(names).not.toContain('modeBDelta');
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

  it('the two early drop gates run in legacy order (native envelope before tool primitives)', () => {
    expect(stageIndex('nativeDrop')).toBeLessThan(stageIndex('toolPrimitiveDrop'));
    expect(stageIndex('toolPrimitiveDrop')).toBeLessThan(stageIndex('malformedWarn'));
  });

  /**
   * 銆屽彧鏈変笁娈靛彲浠?HALT銆嶇殑缁撴瀯鍖栭拤娉曪紙D2 Task 4 纭寲锛夈€?
   *
   * 涓轰粈涔堜笉瀵煎嚭涓€涓?`HALTING_STAGES` 甯搁噺锛氶偅浼氬紩鍏?*绗簩涓簨瀹炴簮**鈥斺€旀湁浜哄線
   * 琛ㄩ噷鍔犱竴娈?`run: () => 'halt'` 鑰屽繕浜嗗悓姝ュ父閲忥紝涓や釜鍚嶅崟灏卞悇璇村悇璇濄€傝繖閲岀洿鎺?
   * 浠庢瘡娈?`run` 鐨?*鍑芥暟浣撴簮鏂囨湰**閲屾壘 halt 淇″彿锛氬畠鏄湡瀹炴墽琛屼綋鐨勯暅鍍忥紝鍔犵鍥涙
   * 鎴栬€呭幓鎺夋煇娈电殑 `'halt'` 閮戒細鍚屾椂鍙嶆槧鍒拌〃涓娿€?
   *
   * 宸茬煡杈圭晫锛氳嫢鏌愭鎶?halt 濮旀墭缁欎竴涓?helper锛坄run: () => maybeHalt(...)`锛夛紝鏈?
   * 鏂█浼氭紡鍒も€斺€旇繖绉嶅啓娉曞湪 D2 琛ㄩ噷涓嶅瓨鍦紝涓旓紙a锛変笌鐭╅樀浜ゅ弶鏍￠獙鍦ㄨ涓哄眰鍏滀綇
   * 涓夋 halt 鐨勫疄闄呮晥鏋滐紱鏂板 helper 褰㈡€侀渶鍚屾鏀硅繖閲屻€?
   */
  it('exactly three stages can halt: nativeDrop, toolPrimitiveDrop, internalFilter', () => {
    const halting = DISPATCH_STAGES
      .filter((stage) => /['"]halt['"]/.test(stage.run.toString()))
      .map((stage) => stage.name);
    expect(halting).toEqual(['nativeDrop', 'toolPrimitiveDrop', 'internalFilter']);
  });
});

// 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
// (a) 鍐呴儴浼氳瘽 drop 璇箟锛氶潪缁堟€?halt锛堟棤 trajectory / 鏃犲箍鎾級锛岀粓鎬佷粛鍑虹珯
// 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
describe('(a) internal-session drop semantics', () => {
  it.each([MAFW.partUpdated, MAFW.partDelta, MAFW.messageUpdated, MAFW.turnStarted])(
    'a memoryWorker non-terminal event (%s) halts before trajectoryHandle and finalBroadcast',
    (type) => {
      const world = makeWorld({ roles: { w1: 'extract' } });

      dispatch(world, type, { sessionID: 'w1', part: { type: 'text', text: 'worker token' }, delta: 'x' });

      // 涓€涓鎴风甯ч兘涓嶅啓锛堟棤 Mode A passthrough銆佹棤娲剧敓 trajectory.event锛夈€?
      expect(world.broadcasts).toEqual([]);
      // trajectory 绱姞鍣ㄤ粠鏈瑙︾锛坵orker 鐨?token 鍣０涓嶅緱杩?Path T锛夈€?
      expect(world.trajectoryCalls).toEqual([]);
      // HALT 鍋滄帀**鍏ㄩ儴**涓嬫父锛氳繛 sessionActivity 鐨?last-active 姘翠綅閮戒笉璇ヨ鍒锋柊銆?
      expect(world.lastActive.size).toBe(0);
      expect(world.timeline).toEqual([]);
    },
  );

  it.each([MAFW.turnCompleted, MAFW.turnFailed, MAFW.turnAborted])(
    "a worker's %s (terminal) still reaches finalBroadcast",
    (type) => {
      const world = makeWorld({ roles: { w1: 'extract' } });

      dispatch(world, type, { sessionID: 'w1' });

      // 缁堟€佹斁琛岋細鎭板ソ涓€甯?passthrough锛屽甫 internal 鏍囪锛圲I 浠嶈兘鐪嬪埌绠＄嚎鐘舵€侊級銆?
      expect(world.broadcasts.map((b) => b.data.type)).toEqual([type]);
      expect(world.broadcasts[0].data.internal).toBe(true);
      expect(world.broadcasts[0].data.sessionID).toBe('w1');
      // 浣?worker 鐨?token 鍣０浠嶄笉杩?trajectory锛坰tage 19 鑷甫鐨?role 闂級銆?
      expect(world.trajectoryCalls).toEqual([]);
    },
  );
});

// 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
// (b) 娲剧敓 vs passthrough 鐨勫箍鎾搴忥紙涓€涓?turn.completed锛?
//     seq 娆″簭 = 骞挎挱璋冪敤娆″簭锛歚broadcast()` 鏄?EventStore 鐨?*鍗曚竴 sink**
//     锛坕ndex.ts:3716 鍚屾 append 鍒嗛厤 seq锛夛紝鎵€浠ヨ繖閲岀殑璋冪敤搴忓氨鏄寔涔呭眰 seq 搴忋€?
//     EventStore 渚х殑鏄惧紡 seq 鏂█鍦?tests/unit/events/broadcast-seq.test.ts
//     锛圖2-R4锛涙湰鏂囦欢鍙拤绠＄嚎鎷撴墤锛屼笉閲嶅閫?EventStore 澶瑰叿锛夈€?
// 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
describe('(b) derived-vs-passthrough broadcast order', () => {
  it('turn.completed broadcasts trajectory.event 鈫?trajectory.turn + usage.updated 鈫?passthrough', () => {
    const world = makeWorld();
    world.cfg.collector = {
      handleEvent: () => ({ eventType: 'turn', seq: 1, sessionID: 's1' }),
      onIdle: () => ({ turnID: 't1', tokens: { input: 3, output: 5 }, cost: 0.25, model: 'm', provider: 'p' }),
    };

    dispatch(world, MAFW.turnCompleted, { sessionID: 's1' });

    expect(world.broadcasts.map((b) => b.data.type)).toEqual([
      MAFW.trajectoryEvent,   // stage 19锛圥ath T 娲剧敓锛?
      MAFW.trajectoryTurn,    // stage 23锛堝洖鍚堣仛鍚堟淳鐢燂級
      MAFW.usageUpdated,      // stage 23锛坲sage 鍚堟垚娲剧敓锛?
      MAFW.turnCompleted,     // stage 23锛坧assthrough锛?
    ]);
    // EventStore 鍙湁涓€涓?sink锛氬叏閮ㄧ粡 mafw_event 淇″皝锛堣皟鐢ㄥ簭 == seq 搴忥級锛?
    // 涓?passthrough 浠嶅甫 sessionID銆?
    expect(world.broadcasts.every((b) => b.type === 'mafw_event')).toBe(true);
    expect(world.broadcasts[3].data.sessionID).toBe('s1');
    // 鎷撴墤閿氱偣锛堟搴忎笉鏄阀鍚堬紝鑰屾槸琛ㄤ綅缃級銆?
    expect(stageIndex('trajectoryHandle')).toBeLessThan(stageIndex('turnIdleAggregate'));
    expect(stageIndex('turnIdleAggregate')).toBeLessThan(stageIndex('finalBroadcast'));
  });
});

// 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
// (c) 缁堟€?4 姝ュ井瑙傛搴忥細棰勭畻 鈫?busy 鈫?run 鏀跺熬 鈫?闃熷垪缁彂
// 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
describe('(c) terminal 4-step micro-order', () => {
  it.each([
    [MAFW.turnCompleted, 'completed'],
    [MAFW.turnFailed, 'failed'],
    [MAFW.turnAborted, 'aborted'],
  ])('%s clears budget 鈫?busy 鈫?run terminal 鈫?queue flush', (type, kind) => {
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

// 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
// (d) approval 鍚屾璇勪及 + 鎶涢敊璇箟
// 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
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
    const f = normalizeRuntimeEvent(evt);
    runEventPipeline(f, evt, world.ctx);
    pipelineReturned = true;

    // 璇勪及鍦ㄧ绾胯繑鍥?*涔嬪墠**瀹屾垚锛堝悓 tick锛屾棤 setImmediate/await 寤跺悗锛夈€?
    expect(calls).toEqual([{ sessionID: 's1', toolName: 'bash', pipelineReturned: false }]);
    // 缁撴灉宸插瘜鍖栧埌杞借嵎涓婏紝渚涗笁绔垎娴侊紙闈?human = 鐩存帴娓叉煋宸插喅璁板綍锛夈€?
    expect(f.properties.mafwPolicy).toEqual(decision);
    // 娆″簭锛歛pproval锛坰tage 10锛夊湪 passthrough 骞挎挱锛坰tage 24锛変箣鍓嶃€?
    expect(world.timeline.indexOf('approval.evaluate')).toBeLessThan(world.timeline.indexOf(`broadcast:${MAFW.permissionAsked}`));
    // 鍒ゅ喅宸茶惤鍐崇瓥鏃ュ織锛堜緵绂荤嚎鏍″噯锛夈€?
    expect(appendApprovalRecordMock).toHaveBeenCalledWith(
      expect.objectContaining({ e: 'eval', requestId: 'r1', sessionID: 's1', tool: 'bash', action: 'human' }),
    );
  });

  it('a thrown evaluate is fail-open inside the hook: chain still completes (hook.ts semantics)', () => {
    // 璇存槑锛歭egacy 鐨?applyApprovalPolicy 鑷甫 try/catch锛坅pproval/hook.ts:57-60锛夛紝
    // evaluate 鎶涢敊 鈫?涓嶅瘜鍖栵紙涓嬫父褰?human锛夆啋 閾剧户缁€傝繖閲岄拤鐨勬槸**鐪熷疄**璇箟銆?
    const world = makeWorld();
    world.cfg.policy = {
      probeScope: () => undefined,
      evaluate: () => { throw new Error('evaluate boom'); },
    };

    const evt = approvalEvent();
    const f = normalizeRuntimeEvent(evt);
    expect(() => runEventPipeline(f, evt, world.ctx)).not.toThrow();

    expect(f.properties.mafwPolicy).toBeUndefined();
    // 閾炬湭琚腑鏂細passthrough 浠嶇劧鍙戠敓銆?
    expect(world.broadcasts.map((b) => b.data.type)).toEqual([MAFW.permissionAsked]);
  });

  it('the pipeline itself has no try/catch: a stage throw aborts the chain immediately', () => {
    // 閽夈€宔dge 鎶涢敊绔嬪埢鍐掓场銆佷笅娓镐笉鍐嶆墽琛屻€嶁€斺€旂绾跨骇涓嶅厹搴曪紙鍏滃簳鍦ㄥ悇娈佃嚜宸辩殑
    // try/catch 閲岋紱sessionActivity 娌℃湁锛屾墍浠ュ畠鎶?= 閾炬柇锛夈€?
    const world = makeWorld();
    world.cfg.lastActiveThrows = true;

    expect(() => dispatch(world, MAFW.partUpdated, { sessionID: 's1', part: { type: 'text', text: 'x' } }))
      .toThrow('last-active boom');
    expect(world.broadcasts).toEqual([]);
    expect(world.trajectoryCalls).toEqual([]);
  });

  it('no pipeline-level catch: a sentinel stage throw escapes runEventPipeline', () => {
    // 涓婇潰閭ｆ潯渚濊禆銆宻essionActivity 鎭板ソ娌℃湁娈靛唴 try/catch銆嶁€斺€旈偅鏄唬鐞嗚瘉鎹€?
    // 鐪熸瑕侀拤鐨勬槸**绠＄嚎鏈韩**涓嶅姞 try/catch锛氫复鏃舵妸涓€娈靛繀鎶涚殑鍝ㄥ叺鍘嬭繘琛ㄥ熬
    // 锛坱ry/finally 寮瑰嚭锛岃〃鏈韩涓嶈姹℃煋锛夛紝绠＄嚎蹇呴』鎶婂畠鍘熸牱鎶涘嚭鏉ワ紱浠讳綍
    // 銆宑atch 鍚庣户缁?鍚炴帀銆嶇殑瀹炵幇閮戒細璁╄繖鏉″厛绾€?
    const world = makeWorld();
    const sentinel: DispatchStage = {
      name: '__sentinelThrow',
      matches: () => true,
      run: () => {
        world.timeline.push('sentinel');
        throw new Error('sentinel boom');
      },
    };
    DISPATCH_STAGES.push(sentinel);
    try {
      expect(() => dispatch(world, MAFW.partUpdated, { sessionID: 's1', part: { type: 'text', text: 'x' } }))
        .toThrow('sentinel boom');
      // 鍝ㄥ叺纭疄鎵ц浜嗭紙涓嶆槸鍒鍏堟姏鐨勫悓鍚嶉敊璇級銆?
      expect(world.timeline).toContain('sentinel');
    } finally {
      DISPATCH_STAGES.pop();
    }
    // 寮瑰嚭鍚庤〃鎭㈠鍘熺姸锛屽悗缁敤渚嬩笉鍙楀奖鍝嶃€?
    expect(DISPATCH_STAGES[DISPATCH_STAGES.length - 1].name).toBe('finalBroadcast');
  });
});

// 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
// (e) enrich 鍏堜簬 tap 蹇収
// 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
describe('(e) enrich-before-tap', () => {
  it('enrichToolIdentity mutates the event before the conformance tap snapshots it', () => {
    const world = makeWorld();
    const observed: Array<{ toolClass?: string; canonicalTool?: string }> = [];
    world.taps.set('s1', new Set([
      (snap: { part?: any }) => {
        world.timeline.push('tap');
        // 鍦ㄥ洖璋冮噷**绔嬪嵆**璇诲彇锛堜笉鏄欢鍚庣湅寮曠敤锛夛細鍙湁 enrich 宸茶窇杩囨墠浼氭湁鍊笺€?
        observed.push({ toolClass: snap.part?.toolClass, canonicalTool: snap.part?.canonicalTool });
      },
    ]));

    // toolClass/canonicalTool 鐢ㄨ闂櫒璁板綍鍐欏叆鏃跺埢 鈫?寰楀埌鐪熷疄鐨?mutation 娆″簭銆?
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

    // mutation 娆″簭锛氫袱娆?enrich 鍐欏叆閮藉彂鐢熷湪 tap 鍥炶皟涔嬪墠銆?
    const tapAt = world.timeline.indexOf('tap');
    expect(tapAt).toBeGreaterThan(-1);
    expect(world.timeline.indexOf('enrich:toolClass=shell')).toBeGreaterThan(-1);
    expect(world.timeline.indexOf('enrich:toolClass=shell')).toBeLessThan(tapAt);
    expect(world.timeline.indexOf('enrich:canonicalTool=bash')).toBeGreaterThan(-1);
    expect(world.timeline.indexOf('enrich:canonicalTool=bash')).toBeLessThan(tapAt);
    // tap 鐪嬪埌鐨勬槸**瀵屽寲鍚?*鐨勮浇鑽凤紙shell 鈫?toolClass=shell / canonicalTool=bash锛夈€?
    expect(observed).toEqual([{ toolClass: 'shell', canonicalTool: 'bash' }]);
    // 涓嬫父骞挎挱鍚屾牱甯︾潃瀵屽寲瀛楁锛坈onformance 宸ュ叿鍙鎬т緷璧栧畠锛夈€?
    const broadcastPart = world.broadcasts[0].data.properties.part;
    expect(broadcastPart.toolClass).toBe('shell');
    expect(broadcastPart.canonicalTool).toBe('bash');
  });
});

// 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
// 鐭╅樀浜ゅ弶鏍￠獙锛圖2-R2锛夛細涓や釜鏃╂湡涓㈠純闂ㄧ殑鍛戒腑闆?== 鐭╅樀澹版槑鐨勪涪寮冮泦
// 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
describe('matrix cross-check: drop gates == declared drop sets', () => {
  /** 鍊欓€夊叏闆嗭細canonical 鐭╅樀 keys + 涓や釜涓㈠純闆?+ 涓€涓彃浠跺懡鍚嶇┖闂?+ 鏃?type銆?*/
  const universe = Array.from(new Set([
    ...Object.keys(EVENT_FLOW_MATRIX),
    ...RUNTIME_NATIVE_DROPPED,
    ...TOOL_PRIMITIVE_TYPES,
    'plugin:custom.event',
    '',
  ]));

  const facetsOf = (type: string) => normalizeRuntimeEvent({ directory: '/repo', payload: { type, properties: { sessionID: 's1' } } });
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
    // 闈炴垚鍛樻斁琛岄棬銆?
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

  it('dropped types never enter the canonical client matrix (drop 鈮?canonical contract)', () => {
    for (const type of [...RUNTIME_NATIVE_DROPPED, ...TOOL_PRIMITIVE_TYPES]) {
      expect(EVENT_FLOW_MATRIX[type]).toBeUndefined();
    }
    // 涓㈠純 鈮?鏈煡锛歯ativeDrop 鐨勭被鍨嬩笉瑙﹀彂 unknown 閬ユ祴锛坒ail-open 璇婃柇鍣偣锛夈€?
    for (const type of RUNTIME_NATIVE_DROPPED) {
      expect(isKnownEventType(type)).toBe(true);
    }
  });
});
