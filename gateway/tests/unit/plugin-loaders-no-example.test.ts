import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { MediaPluginLoader } from '../../src/media/media-plugin-loader';
import { PluginLoader } from '../../src/usage/plugin-loader';

test('media loader creates dir without example.js.disabled', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-media-'));
  const dir = path.join(root, 'media-plugins'); // 不存在的子目录 → ensureDir 走创建分支
  const loader = new MediaPluginLoader(dir);
  await loader.init();
  try {
    const files = fs.readdirSync(dir);
    expect(files.some((f) => f === 'example.js.disabled')).toBe(false);
    expect(files.some((f) => f === 'README.md')).toBe(true);
  } finally {
    loader.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('usage loader creates dir without example.js.disabled', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-usage-'));
  const dir = path.join(root, 'usage-plugins'); // 不存在的子目录 → ensureDir 走创建分支
  const loader = new PluginLoader(dir, [], {});
  await loader.init();
  try {
    const files = fs.readdirSync(dir);
    expect(files.some((f) => f === 'example.js.disabled')).toBe(false);
    expect(files.some((f) => f === 'README.md')).toBe(true);
  } finally {
    loader.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
