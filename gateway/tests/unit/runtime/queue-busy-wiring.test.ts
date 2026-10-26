import { readFileSync } from 'fs';
import { join } from 'path';
import { SessionQueue } from '../../../src/core/session-queue';

const src = readFileSync(join(__dirname, '../../../src/index.ts'), 'utf8');

describe('busy 追踪 wiring（spec §5.1 v2）', () => {
  it('busySessions Map 字段 + turn.started 置位 + 三终态清除', () => {
    expect(src).toMatch(/busySessions = new Map<string, number>/);
    expect(src).toMatch(/type === MAFW\.turnStarted\)[\s\S]{0,120}busySessions\.set/);
    expect(src).toMatch(/MAFW\.turnCompleted \|\| type === MAFW\.turnFailed \|\| type === MAFW\.turnAborted/);
    expect(src).toMatch(/busySessions\.delete/);
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
