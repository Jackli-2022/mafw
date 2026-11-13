/**
 * E8-1: boot 的 discovery heartbeat 从裸 `setInterval` 迁入 kernel `TimerService`。
 *
 * 契约：名字 `discovery:heartbeat`（10s），统计进 `/api/kernel/stats`；
 * `releaseInstanceOwnership` 只清本 handle（幂等），释放后不再心跳。
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { publishInstanceDiscovery, releaseInstanceOwnership } from '../../../src/boot';
import { TimerService } from '../../../src/core/timer-service';

describe('discovery heartbeat timer (E8-1)', () => {
  const previousRuntimeDir = process.env.MAFW_RUNTIME_DIR;
  let runtimeDir: string;

  beforeEach(() => {
    jest.useFakeTimers();
    runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-discovery-timer-'));
    process.env.MAFW_RUNTIME_DIR = runtimeDir;
  });

  afterEach(() => {
    jest.useRealTimers();
    if (previousRuntimeDir === undefined) delete process.env.MAFW_RUNTIME_DIR;
    else process.env.MAFW_RUNTIME_DIR = previousRuntimeDir;
    fs.rmSync(runtimeDir, { recursive: true, force: true });
  });

  function fakeKernel(timers: TimerService) {
    return {
      releaseMetadata: {
        gatewayVersion: '1.0.0',
        experienceVersion: '2.0.0',
        minimumClientExperienceVersion: '1.0.0',
        schemaEpoch: 1,
      },
      runtimeIdentity: { instanceId: 'inst_test', channel: 'prod', distribution: 'dev' },
      apiPort: 3999,
      timers,
      instanceDiscovery: null as { heartbeat: () => Promise<void>; release: () => Promise<void> } | null,
      instanceLock: null,
    };
  }

  it('registers discovery:heartbeat (10s) and clears it on ownership release', async () => {
    const timers = new TimerService();
    const kernel = fakeKernel(timers);

    await publishInstanceDiscovery(kernel as never);
    expect(timers.stats()).toEqual({ active: 1, byName: { 'discovery:heartbeat': 1 } });

    const heartbeat = jest.spyOn(kernel.instanceDiscovery!, 'heartbeat');
    jest.advanceTimersByTime(10_000);
    await Promise.resolve();
    expect(heartbeat).toHaveBeenCalledTimes(1);

    await releaseInstanceOwnership(kernel as never);
    expect(timers.stats()).toEqual({ active: 0, byName: {} });

    jest.advanceTimersByTime(60_000);
    await Promise.resolve();
    expect(heartbeat).toHaveBeenCalledTimes(1);
  });
});
