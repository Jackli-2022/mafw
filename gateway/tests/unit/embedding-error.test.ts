import { describeEmbedError } from '../../src/memory/vector-store';

describe('describeEmbedError', () => {
  test('appends the cause code (ECONNRESET shows up as bare "fetch failed" otherwise)', () => {
    const err = new TypeError('fetch failed');
    (err as any).cause = { code: 'ECONNRESET' };
    expect(describeEmbedError(err)).toBe('fetch failed [ECONNRESET]');
  });

  test('uses a top-level code when there is no cause', () => {
    const err: any = new Error('socket hang up');
    err.code = 'ECONNREFUSED';
    expect(describeEmbedError(err)).toBe('socket hang up [ECONNREFUSED]');
  });

  test('does not duplicate a code already present in the message', () => {
    const err: any = new Error('connect ECONNREFUSED 127.0.0.1:2432');
    err.code = 'ECONNREFUSED';
    expect(describeEmbedError(err)).toBe('connect ECONNREFUSED 127.0.0.1:2432');
  });

  test('falls back to the message, then to String()', () => {
    expect(describeEmbedError(new Error('boom'))).toBe('boom');
    expect(describeEmbedError('plain string')).toBe('plain string');
    expect(describeEmbedError(null)).toBe('null');
  });
});
