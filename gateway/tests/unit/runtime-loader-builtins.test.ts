import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { RuntimePluginLoader } from '../../src/runtime/loader';

test('runtime loader: getBuiltinNames and no example generation', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-rt-'));
  const dir = path.join(root, 'runtime-plugins'); // 不存在的子目录 → ensureDir 走创建分支
  const loader = new RuntimePluginLoader(dir);
  loader.registerBuiltin('pi', (async () => ({ name: 'pi' }) as any), {} as any, false);
  await loader.init();
  try {
    expect(loader.getBuiltinNames()).toEqual(['pi']);
    const files = fs.readdirSync(dir);
    expect(files.some((f) => f === 'example.js.disabled')).toBe(false);
    expect(files.some((f) => f === 'README.md')).toBe(true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(root, { recursive: true, force: true });
  }
});
