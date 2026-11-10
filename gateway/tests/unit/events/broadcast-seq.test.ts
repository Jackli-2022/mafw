import { enrichBroadcastFrame } from '../../../src/events/broadcast-frame';
import { EventStore } from '../../../src/events/event-store';
import { FLAT_EMITTERS } from '../../../src/runtime/flat-emit-registry';
import { eventBus } from '../../../src/event-bus';
import Database from 'better-sqlite3';
import { readFileSync as rf } from 'fs';
import { join as pjoin } from 'path';

describe('enrichBroadcastFrame（spec §5.2 v2 Q2：双层放置）', () => {
  it('扁平事件：顶层 seq + timestamp', () => {
    const out = enrichBroadcastFrame({ type: 'runtime_switched', runtime: 'pi' }, 42, '2026-10-22T00:00:00Z');
    expect(out).toEqual({ type: 'runtime_switched', runtime: 'pi', timestamp: '2026-10-22T00:00:00Z', seq: 42 });
  });
  it('信封事件：顶层 + data 内 seq（Review Focus #5）', () => {
    const out = enrichBroadcastFrame({ type: 'mafw_event', data: { type: 'turn.completed', properties: {} } }, 7, 'T');
    expect(out.seq).toBe(7);
    expect((out.data as any).seq).toBe(7);
  });
  it('seq null：无 seq 键（现状形状，C5）', () => {
    const out = enrichBroadcastFrame({ type: 'part.delta', data: { type: 'part.delta' } }, null, 'T');
    expect('seq' in out).toBe(false);
    expect('seq' in (out.data as any)).toBe(false);
  });
  it('data 非 object（字符串/null）：只放顶层', () => {
    const out1 = enrichBroadcastFrame({ type: 'x', data: null }, 1, 'T');
    expect(out1.seq).toBe(1);
    expect(out1.data).toBeNull();
    const out2 = enrichBroadcastFrame({ type: 'x', data: 'str' }, 2, 'T');
    expect((out2 as any).seq).toBe(2);
    expect((out2 as any).data).toBe('str');
  });
  it('data 为数组：保持数组原样（不注入 data.seq——数组 spread 会破坏成索引对象）', () => {
    const out = enrichBroadcastFrame({ type: 'plugin:x:y', data: [1, 2, 3] }, 9, 'T');
    expect(out.seq).toBe(9);
    expect(Array.isArray(out.data)).toBe(true);
    expect(out.data).toEqual([1, 2, 3]);
  });
  it('不改变原事件对象（浅拷贝，无副作用）', () => {
    const event = { type: 'x', data: { type: 'y' } };
    enrichBroadcastFrame(event, 3, 'T');
    expect(event).toEqual({ type: 'x', data: { type: 'y' } }); // 原对象无 seq
  });
});

// wiring 断言（index.ts 实际调用——否则纯函数可能存在但未接线）：
const idxSrc = rf(pjoin(__dirname, '../../../src/index.ts'), 'utf8');
describe('index.ts broadcast 接线（wiring）', () => {
  it('broadcast 走 enrichBroadcastFrame + eventStore.append', () => {
    expect(idxSrc).toContain('enrichBroadcastFrame(');
    expect(idxSrc).toMatch(/eventStore\?\.append\(/);
    expect(idxSrc).toMatch(/maybePrune\(/);
  });
  it('EventStore 初始化受 config.events.persist 门控（fail-open）', () => {
    expect(idxSrc).toMatch(/config\.events\.persist/);
  });
  it('append 先于 enrich：seq 来自单点 sink 的返回值（顺序反了就是 seq=null）', () => {
    // D2-R4：单一 sink 分配 seq → enrichBroadcastFrame 只读它。两行顺序是契约。
    expect(idxSrc).toMatch(
      /const seq = this\.eventStore\?\.append\(event\) \?\? null;\s*\n\s*const enriched = enrichBroadcastFrame\(event, seq,/,
    );
  });
});

/**
 * Ruling D2-R4（spec §5.4 降级）：**broadcast seq 已经统一**——`broadcast()` 是
 * EventStore 的唯一 sink，eventBus 的扁平发射（FLAT_EMITTERS）与 canonical 的
 * `mafw_event` 信封走同一个 append 计数器，因此两类事件共享一条单调 seq（客户端
 * Last-Event-ID / ?since 才能跨通道续传）。
 *
 * A 段（本文件）钉的是「统一确实存在」；**全量消费者迁移**（automations / startGoal /
 * advance 从 EventStore 回放消费）另立 spec —— 它需要幂等设计 + 不受 retention 裁剪的
 * 影子流（event_log 会被 prune，今天的消费者不是幂等的；见 D2-R4）。
 */
describe('D2-R4：eventBus 扁平发射与 mafw_event 共用 EventStore seq 空间', () => {
  it('FLAT_EMITTERS 发射经 broadcast() 单点 append：seq 连续且跨两类事件共享', () => {
    const store = new EventStore(new Database(':memory:'));
    const frames: Array<{ type: string; [k: string]: any }> = [];

    // index.ts 的 `private broadcast()` 是巨类私有方法（broadcast-frame.ts 注释：
    // 「index.ts 巨类难实例化」），这里复制它的**两行关键接线**：先 append 拿 seq，
    // 再 enrich。下面的 describe 用源码钉子保证 index.ts 真的是这两行。
    const broadcast = (event: { type: string; [k: string]: any }): void => {
      const seq = store.append(event);              // 单一 sink（无论扁平还是信封）
      frames.push(enrichBroadcastFrame(event, seq, 'T'));
    };

    // setupEventBus() 的发射侧：`for (const [name, emit] of FLAT_EMITTERS)
    //   eventBus.on(name, (data) => this.broadcast(emit(data)))`
    const subscribed = [...FLAT_EMITTERS].map(([name, emit]) => {
      const listener = (data: any) => broadcast(emit(data));
      eventBus.on(name, listener);
      return [name, listener] as const;
    });

    try {
      // ① eventBus 起源的扁平族（无 data 壳的顶层广播）
      eventBus.emit('memory_written', { memoryId: 'm1' });
      eventBus.emit('state_change', { goalId: 'g1', patch: { phase: 'x' } });
      // ② canonical 信封族（D2 链的最后一段 passthrough 形状）
      broadcast({
        type: 'mafw_event',
        data: { type: 'turn.completed', properties: {}, sessionID: 's1' },
      });
    } finally {
      for (const [name, listener] of subscribed) eventBus.removeListener(name, listener);
    }

    // 扁平事件保持扁平（desktop 剥壳 `raw?.data || raw` 会吞掉 type——flat-emit 契约）。
    expect(frames.map((f) => f.type)).toEqual(['memory_written', 'state_change', 'mafw_event']);
    expect('data' in frames[0]).toBe(false);
    expect('data' in frames[1]).toBe(false);

    // 同一条 seq 空间：1、2（扁平）→ 3（信封），连续无跳号。
    expect(frames.map((f) => f.seq)).toEqual([1, 2, 3]);
    // 信封数据的 data.seq 同步（双层放置，Review Focus #5）。
    expect((frames[2].data as any).seq).toBe(3);

    // 持久层是唯一真相：一次回放拿到的就是这条混合序列。
    const replay = store.replaySince(0, 10);
    expect(replay.rows.map((r) => r.seq)).toEqual([1, 2, 3]);
    expect(replay.rows.map((r) => r.type)).toEqual(['memory_written', 'state_change', 'mafw_event']);
    expect(replay.firstReplayedSeq).toBe(1);
  });

  it('setupEventBus 的发射侧 = FLAT_EMITTERS → this.broadcast（注册表接线，无 if 链）', () => {
    // 源码钉子：注册表被循环消费且落到 broadcast；表本身覆盖已知扁平族。
    expect(idxSrc).toMatch(/for \(const \[name, emit\] of FLAT_EMITTERS\)/);
    expect(idxSrc).toMatch(/eventBus\.on\(name, \(data: any\) => this\.broadcast\(emit\(data\)\)\)/);
    expect(FLAT_EMITTERS.size).toBeGreaterThan(0);
  });
});
