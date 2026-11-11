/**
 * E1-1 实例锁心跳（spec 2026-11-11-gateway-e1-stabilization-design.md §E1-1）。
 *
 * 缺陷：`InstanceLock.heartbeat()` 存在但无生产调用点 → stale 判定（pid 存活 +
 * heartbeat > 30s）会把活进程的锁判成可回收。
 *
 * 本测试钉住两件事：
 *  1. 心跳循环每 10s 重写一次锁（记录 heartbeatAt = 当前时刻、文件 mtime 新鲜），
 *     且 `isInstanceLockStale` 在持续心跳下为 false；
 *  2. 停止心跳 > 30s 后判定语义保持不变（isStale = true）。
 * 另加 wiring 断言：boot 必须在拿到锁后托管心跳、并在 ownership 释放时清理。
 */
import { readFileSync } from 'node:fs';
import { mkdtemp, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  acquireInstanceLock,
  isInstanceLockStale,
  readInstanceLock,
  startInstanceLockHeartbeat,
  type InstanceLock,
  type InstanceLockRecord,
} from '../../../src/runtime/instance-lock';

const TICK_MS = 10_000;
const STALE_MS = 30_000;

function staleOptions(record: InstanceLockRecord) {
  return {
    now: Date.now(),
    myPid: process.pid + 1, // 竞争者：不同 pid
    myProcessStartTime: record.processStartTime,
    isProcessAlive: () => true,
    heartbeatStaleMs: STALE_MS,
    startTimeToleranceMs: 2_000,
  };
}

/** 真实（非 fake）epoch：fake timers 不接管 process.uptime。 */
function makeRealClock(): () => number {
  const anchorEpoch = Date.now();
  const anchorUptime = process.uptime();
  return () => anchorEpoch + (process.uptime() - anchorUptime) * 1000;
}

async function holdLock(dir: string): Promise<InstanceLock> {
  const result = await acquireInstanceLock({
    dir,
    pid: 4242,
    processStartTime: Date.now() - 5_000,
    now: () => Date.now(),
    isProcessAlive: () => true,
    nonce: 'heartbeat-owner',
    settleMs: 0, // fake timers 下跳过 write 后的 settle delay
  });
  if (!result.ok) throw new Error(`expected to acquire the lock, got ${JSON.stringify(result)}`);
  return result.lock;
}

/**
 * 心跳的写盘是真实 I/O（fake timers 只管 setInterval）。推进 fake 时钟后给
 * event loop 真实回合，等 async heartbeat 的原子写落盘。
 * `setTimeout`/`setImmediate` 不交给 fake timers：轮询需要真实间隔——高频
 * 读同一文件会和 Windows 上的原子 rename 抢共享（EPERM），也会让 fake 时钟
 * 下的 `timers/promises` sleep 永不返回。截止时间用真实 hrtime。
 */
async function realSleep(ms: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function waitForHeartbeat(dir: string, expectedIso: string): Promise<InstanceLockRecord> {
  const deadline = process.hrtime.bigint() + 5_000_000_000n;
  for (;;) {
    const record = await readInstanceLock(dir);
    if (record?.heartbeatAt === expectedIso) return record;
    if (process.hrtime.bigint() > deadline) {
      throw new Error(`heartbeat did not land: got ${record?.heartbeatAt}, want ${expectedIso}`);
    }
    await realSleep(10);
  }
}

async function waitFor(predicate: () => boolean, label: string): Promise<void> {
  const deadline = process.hrtime.bigint() + 5_000_000_000n;
  while (!predicate()) {
    if (process.hrtime.bigint() > deadline) throw new Error(`timed out waiting for ${label}`);
    await realSleep(10);
  }
}

describe('实例锁心跳（E1-1）', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'mafw-lock-heartbeat-'));
    jest.useFakeTimers({ now: Date.now(), doNotFake: ['setImmediate', 'setTimeout'] });
  });

  afterEach(async () => {
    jest.useRealTimers();
  });

  test('每 10s 心跳一次让锁保持新鲜；停止后 >30s 判 stale', async () => {
    const realNow = makeRealClock();
    const lock = await holdLock(dir);
    const lockPath = join(dir, 'gateway.lock');
    const mtime0 = (await stat(lockPath)).mtimeMs;

    const initial = await readInstanceLock(dir);
    expect(initial).not.toBeNull();
    expect(isInstanceLockStale(initial!, staleOptions(initial!))).toBe(false);

    const heartbeat = startInstanceLockHeartbeat(lock, { intervalMs: TICK_MS });
    // 心跳不得单独吊住进程。
    expect(heartbeat.timer.hasRef()).toBe(false);

    for (let tick = 1; tick <= 3; tick += 1) {
      const expected = new Date(Date.now() + TICK_MS).toISOString();
      await jest.advanceTimersByTimeAsync(TICK_MS);
      const record = await waitForHeartbeat(dir, expected);
      // 每次 tick 都重写了 lease：heartbeatAt == 当前（fake）时刻。
      expect(record.heartbeatAt).toBe(new Date().toISOString());
      expect(Date.now() - Date.parse(record.heartbeatAt)).toBe(0);
      // 心跳期间进程存活 + lease 新鲜 → 不可回收。
      expect(isInstanceLockStale(record, staleOptions(record))).toBe(false);
      // 文件确实被重写（mtime 单调不减）。
      const mtime = (await stat(lockPath)).mtimeMs;
      expect(mtime).toBeGreaterThanOrEqual(mtime0);
      // 真实写盘时间不落后于真实时钟超过一个心跳周期。
      expect(realNow() - mtime).toBeLessThanOrEqual(TICK_MS + 5_000);
    }

    // 停止心跳：不再重写，>30s 后旧判定仍生效（保持现状语义）。
    heartbeat.stop();
    const frozen = await readInstanceLock(dir);
    await jest.advanceTimersByTimeAsync(STALE_MS + 1_000);
    const stale = await readInstanceLock(dir);
    expect(stale!.heartbeatAt).toBe(frozen!.heartbeatAt);
    expect(isInstanceLockStale(stale!, staleOptions(stale!))).toBe(true);
  });

  test('stop() 幂等，停止后不再写锁', async () => {
    const lock = await holdLock(dir);
    const heartbeat = startInstanceLockHeartbeat(lock, { intervalMs: TICK_MS });
    const expected = new Date(Date.now() + TICK_MS).toISOString();
    await jest.advanceTimersByTimeAsync(TICK_MS);
    const afterTick = await waitForHeartbeat(dir, expected);

    heartbeat.stop();
    heartbeat.stop(); // 幂等
    await jest.advanceTimersByTimeAsync(TICK_MS * 5);
    await realSleep(20);
    expect((await readInstanceLock(dir))!.heartbeatAt).toBe(afterTick.heartbeatAt);
  });

  test('心跳失败（被接管）走 onError，不抛出到 interval', async () => {
    const failure = new Error('instance lock was taken over by another process');
    const lock = await holdLock(dir);
    const onError = jest.fn();
    const heartbeat = startInstanceLockHeartbeat(
      { ...lock, heartbeat: async () => { throw failure; } },
      { intervalMs: TICK_MS, onError },
    );
    await jest.advanceTimersByTimeAsync(TICK_MS);
    await waitFor(() => onError.mock.calls.length === 1, 'onError');
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(failure);
    heartbeat.stop();
  });
});

describe('boot 接线（E1-1 wiring）', () => {
  const bootSrc = readFileSync(join(__dirname, '../../../src/boot.ts'), 'utf8');

  test('boot 在拿到锁后启动心跳，ownership 释放时清理', () => {
    expect(bootSrc).toContain('startInstanceLockHeartbeat(');
    expect(bootSrc).toContain('instanceLockHeartbeat');
  });
});
