import {
  allowsCapabilityCoexistence,
  isCapabilityCompatible,
  parseCapabilityVersion,
} from '../../../src/kernel-v2/capability-version';

describe('capability versioning', () => {
  test('parses major.minor and major-only versions', () => {
    expect(parseCapabilityVersion('1.2')).toEqual({ major: 1, minor: 2 });
    expect(parseCapabilityVersion('1')).toEqual({ major: 1, minor: 0 });
  });

  test('rejects malformed or zero-major versions', () => {
    expect(parseCapabilityVersion('1.x')).toBeNull();
    expect(parseCapabilityVersion('0.1')).toBeNull();
    expect(parseCapabilityVersion('1.2.3')).toBeNull();
    expect(parseCapabilityVersion('')).toBeNull();
  });

  test('same major is compatible; different major is not', () => {
    expect(isCapabilityCompatible({ major: 1, minor: 0 }, { major: 1, minor: 9 })).toBe(true);
    expect(isCapabilityCompatible({ major: 2, minor: 0 }, { major: 1, minor: 9 })).toBe(false);
  });

  test('coexistence requires an explicit provider set', () => {
    expect(
      allowsCapabilityCoexistence({ major: 1, minor: 0 }, { major: 1, minor: 1 }, false),
    ).toBe(false);
    expect(
      allowsCapabilityCoexistence({ major: 1, minor: 0 }, { major: 1, minor: 1 }, true),
    ).toBe(true);
    expect(
      allowsCapabilityCoexistence({ major: 1, minor: 0 }, { major: 2, minor: 0 }, true),
    ).toBe(true);
  });
});
