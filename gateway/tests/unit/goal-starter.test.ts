import { resolveGoalDir } from '../../src/core/goal/starter';

describe('resolveGoalDir', () => {
  it('优先 hint 且已注册', () => {
    expect(resolveGoalDir(
      [{ projectDir: 'C:/a', mafwDir: 'C:/a/.mafw' }, { projectDir: 'C:/b', mafwDir: 'C:/b/.mafw' }],
      'C:/b',
    )).toEqual({ projectDir: 'C:/b', mafwDir: 'C:/b/.mafw' });
  });
  it('hint 未注册 → 仅在 request 唯一命中时返回', () => {
    expect(resolveGoalDir(
      [{ projectDir: 'C:/a', mafwDir: 'C:/a/.mafw' }],
      'C:/unregistered',
      (mafwDir) => mafwDir === 'C:/a/.mafw',
    )).toEqual({ projectDir: 'C:/a', mafwDir: 'C:/a/.mafw' });
  });
  it('无 hint 且无 request → null，不回落首个项目', () => {
    expect(resolveGoalDir([{ projectDir: 'C:/a', mafwDir: 'C:/a/.mafw' }])).toBeNull();
    expect(resolveGoalDir([], 'x')).toBeNull();
  });
  it('多个 request 命中 → null，要求调用方消歧', () => {
    expect(resolveGoalDir(
      [{ projectDir: 'C:/a', mafwDir: 'C:/a/.mafw' }, { projectDir: 'C:/b', mafwDir: 'C:/b/.mafw' }],
      undefined,
      () => true,
    )).toBeNull();
  });
});
