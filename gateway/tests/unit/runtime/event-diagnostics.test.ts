/**
 * 畸形事件诊断（SSE 链路）——runtime 插件发来的事件形状不对时，
 * 以前静默穿过 normalize 下发到桌面/TUI（行为诡异、无从定位）；
 * 现在入口判定（normalize.ts）+ 限频 warn（index.ts 接线），
 * 广播出口形状守卫（event-broadcast.ts，fail-open）。
 */
import { isMalformedEvent } from '../../../src/runtime/normalize';
import { opencodeBroadcast } from '../../../src/runtime/event-broadcast';

describe('isMalformedEvent', () => {
  it('empty type + no properties -> malformed', () => {
    expect(isMalformedEvent({ type: '', properties: {} })).toBe(true);
    expect(isMalformedEvent({ type: undefined, properties: undefined })).toBe(true);
    expect(isMalformedEvent(null as any)).toBe(true);
  });

  it('real event types are fine even with empty properties', () => {
    expect(isMalformedEvent({ type: 'session.idle', properties: {} })).toBe(false);
    expect(isMalformedEvent({ type: 'message.part.updated', properties: { part: {} } })).toBe(false);
  });

  it('legacy envelope shapes (payload.type) count as typed', () => {
    expect(isMalformedEvent({ payload: { type: 'session.idle' } } as any)).toBe(false);
  });
});

describe('opencodeBroadcast shape guard', () => {
  let errSpy: jest.SpyInstance;

  beforeEach(() => {
    errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => errSpy.mockRestore());

  it('well-formed data passes silently', () => {
    const env = opencodeBroadcast({ type: 'session.idle', sessionID: 's1' });
    expect(env.type).toBe('opencode_event');
    expect(env.data.type).toBe('session.idle');
    expect(errSpy).not.toHaveBeenCalled();
  });

  it('missing type -> error log with diagnostic (env still returned, fail-open)', () => {
    const env = opencodeBroadcast({ type: undefined as any, sessionID: 's1' });
    expect(env.type).toBe('opencode_event');
    expect(errSpy).toHaveBeenCalled();
    const msg = errSpy.mock.calls.map((c) => c.join(' ')).join(' ');
    expect(msg).toContain('type');
  });
});
