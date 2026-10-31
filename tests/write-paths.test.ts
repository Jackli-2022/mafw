import { writeToolPaths } from '../src/utils/write-paths';

describe('plugin writeToolPaths（工具输入 → 目标文件）', () => {
  test('write/edit 的 path / filePath / file_path', () => {
    expect(writeToolPaths('write', { path: 'a.txt' })).toEqual(['a.txt']);
    expect(writeToolPaths('edit', { filePath: 'b.txt' })).toEqual(['b.txt']);
    expect(writeToolPaths('Edit', { file_path: 'c.txt' })).toEqual(['c.txt']);
  });

  test('apply_patch V4A Update/Add/Delete', () => {
    const patch = [
      '*** Begin Patch',
      '*** Update File: src/a.ts',
      '@@',
      '-old',
      '+new',
      '*** Add File: src/b.ts',
      '*** Delete File: old/c.ts',
      '*** End Patch',
    ].join('\n');
    expect(writeToolPaths('apply_patch', { patchText: patch })).toEqual(['src/a.ts', 'src/b.ts', 'old/c.ts']);
  });

  test('非写类 / 无路径 → 空', () => {
    expect(writeToolPaths('read', { path: 'a.txt' })).toEqual([]);
    expect(writeToolPaths('write', {})).toEqual([]);
  });
});
