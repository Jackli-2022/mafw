/**
 * E1-12 Registry TTL patch 语义（spec §E1-12 / C7）。
 *
 * 缺陷：`register()` 对已有 active 记录用 `ttlMs ?? null` 覆盖 —— 调用方省略
 * ttlMs（undefined）会把已有 TTL 清成"永不过期"。
 *
 * 三态契约：
 *  - `undefined` = 保持现有 TTL（重注册 = 续租）
 *  - `null`      = 显式永久
 *  - 数字        = 覆盖（沿用既有 0/负数 = 永久）
 */
import { SessionRegistry } from '../../../src/session/registry';
import type { SessionScope } from '../../../src/session/scope';

const SCOPE: SessionScope = { kind: 'worker', projectId: 'p1' };

function makeRegistry(clock: { now: number }) {
  return new SessionRegistry({ now: () => clock.now });
}

describe('SessionRegistry.register TTL patch（E1-12）', () => {
  test('ttlMs=undefined 保留原 TTL（不会被清成永久）', () => {
    const clock = { now: 1_000_000 };
    const registry = makeRegistry(clock);

    const first = registry.register({ sessionID: 's1', scope: SCOPE, ttlMs: 60_000 });
    expect(first.ttlMs).toBe(60_000);
    expect(first.expiresAt).toBe(1_060_000);

    // 同一时刻重注册且省略 TTL：记录仍是 60s TTL，到期时间不变。
    const patched = registry.register({ sessionID: 's1', scope: SCOPE });
    expect(patched.ttlMs).toBe(60_000);
    expect(patched.expiresAt).toBe(1_060_000);

    // 过期语义保持：59s 内 active，60s 后 ended / sweep 回收。
    clock.now = 1_059_999;
    expect(registry.lookup('s1')!.status).toBe('active');
    clock.now = 1_060_000;
    expect(registry.lookup('s1')!.status).toBe('ended');
    expect(registry.sweep()).toBe(1);
  });

  test('undefined 续租从重注册时刻重新计时（TTL 时长不变）', () => {
    const clock = { now: 2_000_000 };
    const registry = makeRegistry(clock);
    registry.register({ sessionID: 's2', scope: SCOPE, ttlMs: 60_000 });

    clock.now = 2_030_000;
    const renewed = registry.register({ sessionID: 's2', scope: SCOPE });
    expect(renewed.ttlMs).toBe(60_000);
    expect(renewed.expiresAt).toBe(2_090_000);
  });

  test('ttlMs=null 显式永久（expiresAt null）', () => {
    const clock = { now: 3_000_000 };
    const registry = makeRegistry(clock);
    registry.register({ sessionID: 's3', scope: SCOPE, ttlMs: 60_000 });

    const permanent = registry.register({ sessionID: 's3', scope: SCOPE, ttlMs: null });
    expect(permanent.ttlMs).toBeNull();
    expect(permanent.expiresAt).toBeNull();

    clock.now = 3_000_000 + 365 * 24 * 60 * 60 * 1000;
    expect(registry.lookup('s3')!.status).toBe('active');
    expect(registry.sweep()).toBe(0);
  });

  test('数字覆盖：缩短 TTL 生效；0 仍为永久（既有语义）', () => {
    const clock = { now: 4_000_000 };
    const registry = makeRegistry(clock);
    registry.register({ sessionID: 's4', scope: SCOPE, ttlMs: 60_000 });

    const shortened = registry.register({ sessionID: 's4', scope: SCOPE, ttlMs: 5_000 });
    expect(shortened.ttlMs).toBe(5_000);
    expect(shortened.expiresAt).toBe(4_005_000);

    const forever = registry.register({ sessionID: 's4', scope: SCOPE, ttlMs: 0 });
    expect(forever.expiresAt).toBeNull();
    clock.now = 9_000_000;
    expect(registry.lookup('s4')!.status).toBe('active');
  });

  test('首次注册：undefined / null 均永久（不回归）', () => {
    const clock = { now: 5_000_000 };
    const registry = makeRegistry(clock);
    expect(registry.register({ sessionID: 'a', scope: SCOPE }).expiresAt).toBeNull();
    expect(registry.register({ sessionID: 'b', scope: SCOPE, ttlMs: null }).expiresAt).toBeNull();
  });
});
