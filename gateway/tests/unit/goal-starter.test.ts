import { resolveGoalDir } from '../../src/core/goal/starter';

describe('resolveGoalDir', () => {
  it('优先 hint 且已注册', () => {
    expect(resolveGoalDir(
      [{ projectDir: 'C:/a', mafwDir: 'C:/a/.mafw' }, { projectDir: 'C:/b', mafwDir: 'C:/b/.mafw' }],
      'C:/b',
    )).toEqual({ projectDir: 'C:/b', mafwDir: 'C:/b/.mafw' });
  });
  it('hint 未注册 → 回退扫 request 文件所在项目', () => {
    expect(resolveGoalDir(
      [{ projectDir: 'C:/a', mafwDir: 'C:/a/.mafw' }],
      'C:/unregistered',
      (mafwDir) => mafwDir === 'C:/a/.mafw',
    )).toEqual({ projectDir: 'C:/a', mafwDir: 'C:/a/.mafw' });
  });
  it('无 hint 无 request → 首个项目；空列表 → null', () => {
    expect(resolveGoalDir([{ projectDir: 'C:/a', mafwDir: 'C:/a/.mafw' }])).toEqual({ projectDir: 'C:/a', mafwDir: 'C:/a/.mafw' });
    expect(resolveGoalDir([], 'x')).toBeNull();
  });
});
