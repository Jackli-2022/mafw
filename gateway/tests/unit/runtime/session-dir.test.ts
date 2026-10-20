import { requireSessionDir, resolvePluginProjectDir } from '../../../src/runtime/session-dir';

describe('requireSessionDir', () => {
  test('opts.directory wins', () => {
    expect(requireSessionDir('/proj/a', '/proj/b')).toBe('/proj/a');
  });
  test('falls back to ctx.projectDir (defensive leg)', () => {
    expect(requireSessionDir(undefined, '/proj/b')).toBe('/proj/b');
  });
  test('both missing → throws fail-loud', () => {
    expect(() => requireSessionDir(undefined, undefined)).toThrow(/directory is required/);
    expect(() => requireSessionDir(null, null)).toThrow(/directory is required/);
  });
});

describe('resolvePluginProjectDir', () => {
  test('UI current project wins', () => {
    expect(resolvePluginProjectDir('/cur/proj', '/cfg/proj')).toBe('/cur/proj');
  });
  test('null/undefined current → config project root', () => {
    expect(resolvePluginProjectDir(null, '/cfg/proj')).toBe('/cfg/proj');
    expect(resolvePluginProjectDir(undefined, '/cfg/proj')).toBe('/cfg/proj');
  });
});
