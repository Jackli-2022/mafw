import { describe, expect, it } from '@jest/globals';
import { sessionDirectoryOf } from '../../../src/core/file-history/session-directory';

describe('sessionDirectoryOf', () => {
  it('opencode v2：location.directory', () => {
    expect(sessionDirectoryOf({ id: 's1', location: { directory: 'C:\\proj' } })).toBe('C:\\proj');
  });

  it('legacy：顶层 directory', () => {
    expect(sessionDirectoryOf({ id: 's1', directory: '/proj' })).toBe('/proj');
  });

  it('缺失/非字符串 → null', () => {
    expect(sessionDirectoryOf(null)).toBeNull();
    expect(sessionDirectoryOf({})).toBeNull();
    expect(sessionDirectoryOf({ location: { directory: '' } })).toBeNull();
    expect(sessionDirectoryOf({ directory: 123 })).toBeNull();
  });
});
