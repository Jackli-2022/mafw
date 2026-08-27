import { ApprovalBridge } from '../../../src/runtime/pi/pi-approval-bridge';

describe('ApprovalBridge', () => {
  let bridge: ApprovalBridge;

  beforeEach(() => {
    bridge = new ApprovalBridge();
  });

  afterEach(() => {
    bridge.dispose();
  });

  it('should resolve request when reply is called with true', async () => {
    const promise = bridge.request('req-1');
    const result = bridge.reply('req-1', true);
    expect(result).toBe(true);
    await expect(promise).resolves.toBe(true);
  });

  it('should resolve request when reply is called with false', async () => {
    const promise = bridge.request('req-2');
    bridge.reply('req-2', false);
    await expect(promise).resolves.toBe(false);
  });

  it('should return false when reply is called for unknown requestId', () => {
    const result = bridge.reply('unknown', true);
    expect(result).toBe(false);
  });

  it('should auto-reject on timeout', async () => {
    jest.useFakeTimers();
    const promise = bridge.request('req-3');
    jest.advanceTimersByTime(300_000);
    await expect(promise).resolves.toBe(false);
    jest.useRealTimers();
  });

  it('should reject all pending requests on dispose', async () => {
    const p1 = bridge.request('req-4');
    const p2 = bridge.request('req-5');
    bridge.dispose();
    await expect(p1).resolves.toBe(false);
    await expect(p2).resolves.toBe(false);
  });

  it('should handle multiple concurrent requests', async () => {
    const p1 = bridge.request('req-6');
    const p2 = bridge.request('req-7');
    bridge.reply('req-6', true);
    bridge.reply('req-7', false);
    await expect(p1).resolves.toBe(true);
    await expect(p2).resolves.toBe(false);
  });
});
