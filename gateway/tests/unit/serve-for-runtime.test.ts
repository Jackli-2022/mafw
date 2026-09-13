import { ensureServeForBuiltinRuntime } from '../../src/runtime/serve-for-runtime';

function makeSupervisor(overrides: Record<string, any> = {}) {
  return {
    owned: false,
    ensureStarted: jest.fn().mockResolvedValue('http://127.0.0.1:4096'),
    restart: jest.fn(),
    health: jest.fn().mockResolvedValue(true),
    close: jest.fn(),
    ...overrides,
  };
}

describe('ensureServeForBuiltinRuntime', () => {
  test('ensures serve and starts the watchdog', async () => {
    const supervisor = makeSupervisor();
    const startWatchdog = jest.fn();
    const log = { info: jest.fn(), warn: jest.fn() };
    await ensureServeForBuiltinRuntime(supervisor as any, { startWatchdog }, log);
    expect(supervisor.ensureStarted).toHaveBeenCalledTimes(1);
    expect(startWatchdog).toHaveBeenCalledTimes(1);
    expect(log.warn).not.toHaveBeenCalled();
  });

  test('supervisor failure is non-fatal: warns, skips watchdog, does not throw', async () => {
    const supervisor = makeSupervisor({ ensureStarted: jest.fn().mockRejectedValue(new Error('external mode refused')) });
    const startWatchdog = jest.fn();
    const log = { info: jest.fn(), warn: jest.fn() };
    await expect(ensureServeForBuiltinRuntime(supervisor as any, { startWatchdog }, log)).resolves.toBeUndefined();
    expect(startWatchdog).not.toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('external mode refused'));
  });
});
