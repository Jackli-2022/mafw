/**
 * E8-1: kernel 剩余长驻 interval 收进 `TimerService`（E4-1 命名台账）。
 *
 * 迁移点（名字是 stats 聚合契约，不得重命名）：
 *   - `pod:event-prune`（24h） / `pod:event-wake`（60s）
 *   - `heartbeat:sweep`（30m） / `queue:sweep`（60s） / `session:sweep`（60s）
 *   - `serve:watchdog`（30s，沿用既有 cadence）
 *
 * 钉住四件事：名字精确且各一条；重复 start 不产生第二条（幂等）；
 * dispose 后回调不再触发；watchdog 的 stop 走同一台账。
 */
import { MafwScheduler } from '../../../src/index';
import { TimerService } from '../../../src/core/timer-service';

interface KernelTimerProbe {
  timers: TimerService;
  running: boolean;
  serveRecovering: boolean;
  podEventService?: { prune: () => { events: number; files: number } };
  podEventWake?: { scan: () => void };
  heartbeat?: { sweep: () => void };
  sessionRegistry: { sweep: () => number };
  sweepBusyAndQueue(): void;
  isServeHealthy(): Promise<boolean>;
  startPodEventTimers(): void;
  startHousekeepingTimers(): void;
  startServeWatchdog(): void;
  stopServeWatchdog(): void;
}

function probeKernel(): KernelTimerProbe {
  return new MafwScheduler('.') as unknown as KernelTimerProbe;
}

/** 全部依赖换成 spy；不触碰真实 pod/SQLite/serve。 */
function harness() {
  const kernel = probeKernel();
  const prune = jest.fn(() => ({ events: 0, files: 0 }));
  const scan = jest.fn();
  const heartbeat = jest.fn();
  const sessionSweep = jest.fn(() => 0);
  const queueSweep = jest.fn();
  const isHealthy = jest.fn(async () => true);

  kernel.podEventService = { prune };
  kernel.podEventWake = { scan };
  kernel.heartbeat = { sweep: heartbeat };
  kernel.sessionRegistry = { sweep: sessionSweep };
  kernel.sweepBusyAndQueue = queueSweep;
  kernel.isServeHealthy = isHealthy;
  kernel.running = false;

  const startAll = () => {
    kernel.startPodEventTimers();
    kernel.startHousekeepingTimers();
    kernel.startServeWatchdog();
  };

  return { kernel, prune, scan, heartbeat, sessionSweep, queueSweep, isHealthy, startAll };
}

describe('kernel long-lived timers (E8-1)', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('registers every remaining interval by exact name, exactly once', () => {
    const { kernel, startAll } = harness();
    startAll();

    expect(kernel.timers.stats()).toEqual({
      active: 6,
      byName: {
        'pod:event-prune': 1,
        'pod:event-wake': 1,
        'heartbeat:sweep': 1,
        'queue:sweep': 1,
        'session:sweep': 1,
        'serve:watchdog': 1,
      },
    });
  });

  it('repeated starts are idempotent (no duplicate registration, no throw)', () => {
    const { kernel, prune, startAll } = harness();
    startAll();
    const first = kernel.timers.stats();

    expect(() => startAll()).not.toThrow();
    expect(kernel.timers.stats()).toEqual(first);
    // Startup prune runs once, not once per start.
    expect(prune).toHaveBeenCalledTimes(1);
  });

  it('drives the original cadences while the kernel is alive', () => {
    const { kernel, prune, scan, heartbeat, sessionSweep, queueSweep, startAll } = harness();
    startAll();

    // 启动即时 prune
    expect(prune).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(60_000);
    expect(scan).toHaveBeenCalledTimes(1);
    expect(queueSweep).toHaveBeenCalledTimes(1);
    expect(sessionSweep).toHaveBeenCalledTimes(1);
    expect(heartbeat).not.toHaveBeenCalled();

    jest.advanceTimersByTime(29 * 60_000);
    expect(heartbeat).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(24 * 60 * 60_000);
    expect(prune).toHaveBeenCalledTimes(2);
  });

  it('disposeAll (stop path) silences every callback', () => {
    const { kernel, prune, scan, heartbeat, sessionSweep, queueSweep, startAll } = harness();
    startAll();

    kernel.timers.disposeAll();
    expect(kernel.timers.stats()).toEqual({ active: 0, byName: {} });

    jest.advanceTimersByTime(25 * 60 * 60_000);

    expect(prune).toHaveBeenCalledTimes(1);
    expect(scan).not.toHaveBeenCalled();
    expect(queueSweep).not.toHaveBeenCalled();
    expect(sessionSweep).not.toHaveBeenCalled();
    expect(heartbeat).not.toHaveBeenCalled();
  });

  it('serve:watchdog polls health while registered and stops after stopServeWatchdog', async () => {
    const { kernel, isHealthy, startAll } = harness();
    kernel.running = true;
    startAll();

    jest.advanceTimersByTime(30_000);
    await Promise.resolve();
    expect(isHealthy).toHaveBeenCalledTimes(1);

    kernel.stopServeWatchdog();
    expect(kernel.timers.stats().byName['serve:watchdog']).toBeUndefined();

    jest.advanceTimersByTime(90_000);
    await Promise.resolve();
    expect(isHealthy).toHaveBeenCalledTimes(1);
  });
});
