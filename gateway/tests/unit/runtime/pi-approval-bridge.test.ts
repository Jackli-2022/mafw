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

  it('reply stores decision + message for always/reject', () => {
    const p1 = bridge.request('req-8');
    expect(bridge.reply('req-8', 'always')).toBe(true);
    expect(bridge.lastDecision('req-8')).toEqual({ decision: 'always', message: undefined });

    const p2 = bridge.request('req-9');
    bridge.reply('req-9', 'reject', 'too risky');
    expect(bridge.lastDecision('req-9')).toEqual({ decision: 'reject', message: 'too risky' });
    expect(p1).resolves.toBe(true);
    expect(p2).resolves.toBe(false);
  });

  it('bool-style reply normalizes to once/reject decisions', () => {
    const p1 = bridge.request('req-10');
    bridge.reply('req-10', true as any);
    expect(bridge.lastDecision('req-10')?.decision).toBe('once');

    const p2 = bridge.request('req-11');
    bridge.reply('req-11', false as any);
    expect(bridge.lastDecision('req-11')?.decision).toBe('reject');
    expect(p1).resolves.toBe(true);
    expect(p2).resolves.toBe(false);
  });

  it('lastDecision returns null for unknown id', () => {
    expect(bridge.lastDecision('nobody')).toBeNull();
  });

  describe('listPending (permissionList backing)', () => {
    it('returns pending requests with metadata; replied ones drop out', () => {
      bridge.request('p1', { sessionID: 's1', permission: 'bash', patterns: [], metadata: { args: { cmd: 'ls' } } });
      bridge.request('p2', { sessionID: 's2', permission: 'edit' });
      bridge.reply('p2', true);
      const items = bridge.listPending();
      expect(items).toHaveLength(1);
      expect(items[0]).toEqual({
        id: 'p1', sessionID: 's1', permission: 'bash',
        patterns: [], metadata: { args: { cmd: 'ls' } },
      });
    });

    it('no metadata → shape intact with undefined fields', () => {
      bridge.request('p3');
      const items = bridge.listPending();
      expect(items).toHaveLength(1);
      expect(items[0].id).toBe('p3');
      expect(items[0].sessionID).toBeUndefined();
      expect(items[0].permission).toBeUndefined();
    });
  });
});
