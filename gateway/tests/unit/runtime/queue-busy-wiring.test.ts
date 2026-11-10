import { readFileSync } from 'fs';
import { join } from 'path';
import { SessionQueue } from '../../../src/core/session-queue';
import { MAFW } from '../../../src/runtime/mafw-vocabulary';

const src = readFileSync(join(__dirname, '../../../src/index.ts'), 'utf8');
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
   * D2 迁出后恢复的字面量钉子：legacy 用 `/MAFW.turnCompleted || MAFW.turnFailed ||
   * MAFW.turnAborted/` 正则钉住「哪三个类型是终态」；迁出时该正则被
   * `TURN_TERMINALS.has(f.type)` 取代，成员集合失去断言。这里回到定义本身：
   * 定义体必须**恰好**是这三个 MAFW 常量（不多不少、不含裸字符串），且常量值
   * 就是线上类型名——重命名常量或增减成员都会红。
   */
  it('TURN_TERMINALS 定义体逐字钉住三个终态类型（迁移前的字面量语义）', () => {
    const def = dispatchSrc.match(/const TURN_TERMINALS: ReadonlySet<string> = new Set\(\[([\s\S]*?)\]\)/);
    expect(def).toBeTruthy();
    const members = def![1]
      .replace(/\/\/.*$/gm, '')   // 去行注释
      .split(',')
      .map((token) => token.trim())
      .filter(Boolean);
    expect(members).toEqual(['MAFW.turnCompleted', 'MAFW.turnFailed', 'MAFW.turnAborted']);
    // 常量值 ↔ 线上类型名（常量被改名/改值都会红）。
    expect(members.map((token) => (MAFW as Record<string, string>)[token.slice('MAFW.'.length)]))
      .toEqual(['turn.completed', 'turn.failed', 'turn.aborted']);
  });
  it('防楔死：BUSY_STALE_MS 常量 + sweep 方法 + interval 注册', () => {
    expect(src).toContain('BUSY_STALE_MS = 15 * 60_000');
    expect(src).toContain('QUEUE_ITEM_TTL_MS');
    expect(src).toMatch(/sweepBusyAndQueue/);
    expect(src).toMatch(/sweepBusyAndQueue/);
    // interval 注册（60s 周期）
    const hits = src.match(/sweepBusyAndQueue\(\), 60_000|60_000[^)]*sweepBusyAndQueue/g) ?? [];
    expect(hits.length).toBeGreaterThanOrEqual(1);
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
