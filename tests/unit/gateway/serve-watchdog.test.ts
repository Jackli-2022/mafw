import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { MafwScheduler } from '../../../gateway/src/index';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-watchdog-'));
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('startServeWatchdog', () => {
  test('clears serveInstance and recovers after configured consecutive failures', async () => {
    const scheduler = new MafwScheduler(tmpDir) as any;
    scheduler.running = true;
    scheduler.serveRecovering = false;
    scheduler.serveOwned = true;
    scheduler.serveInstance = { url: 'http://127.0.0.1:4096', close: jest.fn() };
    scheduler.serveWatchdogFailures = 3;
    scheduler.serveWatchdogIntervalMs = 1000;
    scheduler.isServeHealthy = jest.fn().mockResolvedValue(false);
    scheduler.recoverServe = jest.fn().mockResolvedValue(undefined);

    scheduler.startServeWatchdog();
    expect(scheduler.serveWatchdogTimer).toBeTruthy();

    // First two failures do not trigger recovery yet.
    await jest.advanceTimersByTimeAsync(1000);
    expect(scheduler.isServeHealthy).toHaveBeenCalledTimes(1);
    expect(scheduler.recoverServe).not.toHaveBeenCalled();
    expect(scheduler.serveInstance).toBeTruthy();

    await jest.advanceTimersByTimeAsync(1000);
    expect(scheduler.isServeHealthy).toHaveBeenCalledTimes(2);
    expect(scheduler.recoverServe).not.toHaveBeenCalled();

    // Third failure clears the stale handle and calls recoverServe.
    await jest.advanceTimersByTimeAsync(1000);
    expect(scheduler.isServeHealthy).toHaveBeenCalledTimes(3);
    expect(scheduler.recoverServe).toHaveBeenCalledTimes(1);
    expect(scheduler.serveInstance).toBeUndefined();

    clearInterval(scheduler.serveWatchdogTimer);
  });

  test('resets failure counter when serve becomes healthy', async () => {
    const scheduler = new MafwScheduler(tmpDir) as any;
    scheduler.running = true;
    scheduler.serveRecovering = false;
    scheduler.serveInstance = { url: 'http://127.0.0.1:4096', close: jest.fn() };
    scheduler.serveWatchdogFailures = 3;
    scheduler.serveWatchdogIntervalMs = 1000;
    scheduler.recoverServe = jest.fn().mockResolvedValue(undefined);

    let healthy = false;
    scheduler.isServeHealthy = jest.fn().mockImplementation(() => Promise.resolve(healthy));

    scheduler.startServeWatchdog();

    await jest.advanceTimersByTimeAsync(1000); // failure 1
    await jest.advanceTimersByTimeAsync(1000); // failure 2
    healthy = true;
    await jest.advanceTimersByTimeAsync(1000); // healthy -> resets failures
    healthy = false;
    await jest.advanceTimersByTimeAsync(1000); // failure 1 again
    await jest.advanceTimersByTimeAsync(1000); // failure 2 again

    // Only 2 failures after reset -> no recovery yet.
    expect(scheduler.recoverServe).not.toHaveBeenCalled();

    clearInterval(scheduler.serveWatchdogTimer);
  });

  test('does not start a second watchdog timer', async () => {
    const scheduler = new MafwScheduler(tmpDir) as any;
    scheduler.running = true;
    scheduler.serveRecovering = false;
    scheduler.isServeHealthy = jest.fn().mockResolvedValue(true);

    scheduler.startServeWatchdog();
    const first = scheduler.serveWatchdogTimer;
    scheduler.startServeWatchdog();
    expect(scheduler.serveWatchdogTimer).toBe(first);

    clearInterval(scheduler.serveWatchdogTimer);
  });
});
