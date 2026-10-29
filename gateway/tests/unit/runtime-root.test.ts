import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ensureRuntimeRoot, resolveRuntimeRoot } from '../../src/runtime/runtime-root';

describe('runtime root', () => {
  it('默认解析到 ~/.mafw/runtime-root', () => {
    expect(resolveRuntimeRoot()).toBe(path.join(os.homedir(), '.mafw', 'runtime-root'));
  });

  it('在给定数据根下解析 runtime-root', () => {
    expect(resolveRuntimeRoot('/data/mafw')).toBe(path.join('/data/mafw', 'runtime-root'));
  });

  it('创建缺失目录并返回绝对路径', () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-runtime-root-'));
    try {
      const root = path.join(base, 'nested', 'runtime-root');
      expect(fs.existsSync(root)).toBe(false);
      const resolved = ensureRuntimeRoot(root);
      expect(resolved).toBe(root);
      expect(path.isAbsolute(resolved)).toBe(true);
      expect(fs.statSync(resolved).isDirectory()).toBe(true);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

  it('拒绝相对路径', () => {
    expect(() => ensureRuntimeRoot('relative/runtime-root')).toThrow(/absolute/i);
  });

  it('拒绝已存在的同名文件', () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-runtime-root-'));
    try {
      const file = path.join(base, 'runtime-root');
      fs.writeFileSync(file, 'not a directory');
      expect(() => ensureRuntimeRoot(file)).toThrow(/not a directory|ENOTDIR|EEXIST/i);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });
});
