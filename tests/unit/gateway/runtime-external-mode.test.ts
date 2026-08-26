import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { MafwScheduler } from '../../../gateway/src/index';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-external-'));
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('external runtime mode', () => {
  test('watchdog does NOT call recoverServe when runtime is external', async () => {
    const scheduler = new MafwScheduler(tmpDir) as any;
    scheduler.running = true;
    scheduler.serveRecovering = false;
    scheduler.serveOwned = false;
    scheduler.serveInstance = { url: 'http://127.0.0.1:9999', close: jest.fn() };
    scheduler.serveWatchdogFailures = 3;
    scheduler.serveWatchdogIntervalMs = 1000;
    scheduler.isServeHealthy = jest.fn().mockResolvedValue(false);
    scheduler.recoverServe = jest.fn().mockResolvedValue(undefined);
    scheduler.subscribeToEvents = jest.fn().mockResolvedValue(undefined);

    const externalRuntime = {
      external: true,
      getBaseUrl: () => 'http://127.0.0.1:9999',
    };
    scheduler.opencodeClient = externalRuntime;

    scheduler.startServeWatchdog();

    await jest.advanceTimersByTimeAsync(1000);
    await jest.advanceTimersByTimeAsync(1000);
    await jest.advanceTimersByTimeAsync(1000);

    expect(scheduler.recoverServe).not.toHaveBeenCalled();
    expect(scheduler.subscribeToEvents).toHaveBeenCalled();

    clearInterval(scheduler.serveWatchdogTimer);
  });

  test('watchdog DOES call recoverServe when runtime is NOT external', async () => {
    const scheduler = new MafwScheduler(tmpDir) as any;
    scheduler.running = true;
    scheduler.serveRecovering = false;
    scheduler.serveOwned = true;
    scheduler.serveInstance = { url: 'http://127.0.0.1:4096', close: jest.fn() };
    scheduler.serveWatchdogFailures = 3;
    scheduler.serveWatchdogIntervalMs = 1000;
    scheduler.isServeHealthy = jest.fn().mockResolvedValue(false);
    scheduler.recoverServe = jest.fn().mockResolvedValue(undefined);
    scheduler.subscribeToEvents = jest.fn().mockResolvedValue(undefined);

    const internalRuntime = {
      external: false,
      getBaseUrl: () => 'http://127.0.0.1:4096',
    };
    scheduler.opencodeClient = internalRuntime;

    scheduler.startServeWatchdog();

    await jest.advanceTimersByTimeAsync(1000);
    await jest.advanceTimersByTimeAsync(1000);
    await jest.advanceTimersByTimeAsync(1000);

    expect(scheduler.recoverServe).toHaveBeenCalledTimes(1);
    expect(scheduler.serveInstance).toBeUndefined();

    clearInterval(scheduler.serveWatchdogTimer);
  });

  test('external watchdog logs and reconnects events on failure, never kills process', async () => {
    const scheduler = new MafwScheduler(tmpDir) as any;
    scheduler.running = true;
    scheduler.serveRecovering = false;
    scheduler.serveOwned = false;
    scheduler.serveInstance = { url: 'http://127.0.0.1:9999', close: jest.fn() };
    scheduler.serveWatchdogFailures = 3;
    scheduler.serveWatchdogIntervalMs = 1000;
    scheduler.isServeHealthy = jest.fn().mockResolvedValue(false);
    scheduler.recoverServe = jest.fn().mockResolvedValue(undefined);
    scheduler.subscribeToEvents = jest.fn().mockResolvedValue(undefined);

    const externalRuntime = {
      external: true,
      getBaseUrl: () => 'http://127.0.0.1:9999',
    };
    scheduler.opencodeClient = externalRuntime;

    scheduler.startServeWatchdog();

    await jest.advanceTimersByTimeAsync(1000);
    await jest.advanceTimersByTimeAsync(1000);
    await jest.advanceTimersByTimeAsync(1000);

    expect(scheduler.serveInstance).toBeTruthy();
    expect(scheduler.recoverServe).not.toHaveBeenCalled();
    expect(scheduler.subscribeToEvents).toHaveBeenCalled();

    clearInterval(scheduler.serveWatchdogTimer);
  });
});
