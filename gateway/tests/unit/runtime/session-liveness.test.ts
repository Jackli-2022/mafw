import { isLiveSessionInfo } from '../../../src/runtime/session-liveness';

describe('isLiveSessionInfo', () => {
  it('accepts a real session record', () => {
    expect(isLiveSessionInfo({ id: 'ses_1', directory: '/p' })).toBe(true);
  });

  it('rejects the opencode SDK error envelope (throwOnError=false)', () => {
    // client.session.get on a 404 returns { error, request, response } with no
    // `data`; a bare truthiness check would treat every unknown id as alive.
    expect(isLiveSessionInfo({
      error: { name: 'NotFoundError', data: { message: 'Session not found' } },
      request: {},
      response: {},
    })).toBe(false);
  });

  it('rejects missing results and records without an id', () => {
    expect(isLiveSessionInfo(undefined)).toBe(false);
    expect(isLiveSessionInfo(null)).toBe(false);
    expect(isLiveSessionInfo({})).toBe(false);
    expect(isLiveSessionInfo('ses_1')).toBe(false);
  });
});
