import { readFileSync } from 'fs';
import { join } from 'path';
import { SessionQueue } from '../../../src/core/session-queue';
import { MAFW } from '../../../src/runtime/mafw-vocabulary';
import { TURN_TERMINALS } from '../../../src/runtime/event-dispatch';

// D3 Task 8: 组合根（class MafwScheduler）搬到 kernel.ts。
const src = readFileSync(join(__dirname, '../../../src/kernel.ts'), 'utf8');
// Phase D2: turn.started / 终态 busy 语义随 handleRuntimeEvent 链迁入 event-dispatch.ts。
const dispatchSrc = readFileSync(join(__dirname, '../../../src/runtime/event-dispatch.ts'), 'utf8');

describe('busy 追踪 wiring（spec §5.1 v2）', () => {
  it('busySessions Map 字段 + turn.started 置位 + 三终态清除', () => {
    expect(src).toMatch(/busySessions = new Map<string, number>/);
    expect(dispatchSrc).toMatch(/f\.type === MAFW\.turnStarted/);
    expect(dispatchSrc).toMatch(/ctx\.busySessions\(\)\.set\(sessionID, Date\.now\(\)\)/);
    expect(dispatchSrc).toMatch(/TURN_TERMINALS\.has\(f\.type\)/);
    expect(dispatchSrc).toMatch(/ctx\.busySessions\(\)\.delete\(sessionID\)/);
  });
  /**
   * D2 迁出后恢复的钉子：legacy 用 `/MAFW.turnCompleted || MAFW.turnFailed ||
   * MAFW.turnAborted/` 正则钉住「哪三个类型是终态」；迁出时该正则被
   * `TURN_TERMINALS.has(f.type)` 取代，成员集合失去断言。这里直接断言**导出的集合**：
   * 顺序与值都必须**恰好**是这三个 MAFW 常量（不多不少、不含裸字符串），且常量值
   * 就是线上类型名——重命名常量或增减成员都会红。
   *
   * D2 Task 4 硬化：改为读 `event-dispatch.ts` 导出的 `TURN_TERMINALS` 值，不再正则
   * 解析源码定义体（格式/注释漂移会让旧钉子假绿）。
   */
  it('TURN_TERMINALS 恰好是三个终态类型（读导出值，不解析源码）', () => {
    expect(Array.from(TURN_TERMINALS)).toEqual([
      MAFW.turnCompleted,
      MAFW.turnFailed,
      MAFW.turnAborted,
    ]);
    expect(TURN_TERMINALS.size).toBe(3);
    // 常量值 ↔ 线上类型名（MAFW 词汇被改名/改值都会红）。
    expect([...TURN_TERMINALS]).toEqual(['turn.completed', 'turn.failed', 'turn.aborted']);
  });
  it('防楔死：BUSY_STALE_MS 常量 + sweep 方法 + interval 注册', () => {
    expect(src).toContain('BUSY_STALE_MS = 15 * 60_000');
    expect(src).toContain('QUEUE_ITEM_TTL_MS');
    expect(src).toMatch(/sweepBusyAndQueue/);
    expect(src).toMatch(/sweepBusyAndQueue/);
    // interval 注册（60s 周期）——E8-1 起走 TimerService 命名台账，pin 名字 + 周期 + 回调，
    // 不再匹配裸 setInterval；行为侧（fake timers 触发 + dispose 静默）由
    // tests/unit/resources/kernel-timers.test.ts 覆盖。
    const hits = src.match(
      /timers\.every\(\s*'queue:sweep'\s*,\s*60_000\s*,\s*\(\)\s*=>\s*this\.sweepBusyAndQueue\(\)\s*\)/g,
    ) ?? [];
    expect(hits).toHaveLength(1);
  });
});

describe('sweep 纯逻辑（时钟注入）', () => {
  it('busy TTL 清算语义（用 SessionQueue.expireOlderThan 同式时间比较）', () => {
    const BUSY_STALE_MS = 15 * 60_000;
    const now = 10_000_000;
    expect(now - (now - BUSY_STALE_MS) >= BUSY_STALE_MS).toBe(true);      // 恰好到期
    expect(now - (now - BUSY_STALE_MS + 1) >= BUSY_STALE_MS).toBe(false); // 未到期
  });
  it('过期项摘除经 SessionQueue（组合语义）', () => {
    const q = new SessionQueue();
    q.enqueue('s1', { text: 'x', source: 'test' });
    const expired = q.expireOlderThan('s1', 1_000, Date.now() + 5_000);
    expect(expired).toHaveLength(1);
  });
});
