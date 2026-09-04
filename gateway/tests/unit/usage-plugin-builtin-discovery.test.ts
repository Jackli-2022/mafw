import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PluginLoader } from '../../src/usage/plugin-loader';

describe('PluginLoader builtin discovery', () => {
  it('discovers builtin names from builtin dir without constructor manifest', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-usage-bl-'));
    const builtinDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-usage-bl-b-'));
    try {
      fs.writeFileSync(
        path.join(builtinDir, 'deepseek.js'),
        "module.exports = { name: 'deepseek', type: 'api', async fetch() { return null; } };",
      );
      // Production wiring passes [] as builtinNames (index.ts) — discovery must
      // still make isBuiltinName reflect plugins found in builtinPluginsDir.
      const loader = new PluginLoader(dir, [], { builtinPluginsDir: builtinDir });
      await loader.init();
      try {
        expect(loader.isBuiltinName('deepseek')).toBe(true);
        expect(loader.isBuiltinName('nope')).toBe(false);
      } finally {
        loader.stop();
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
      fs.rmSync(builtinDir, { recursive: true, force: true });
    }
  });

  it('keeps declared names and refreshes discovery on rescan', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-usage-bl2-'));
    const builtinDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-usage-bl2-b-'));
    try {
      const loader = new PluginLoader(dir, ['declared-one'], { builtinPluginsDir: builtinDir });
      await loader.init();
      expect(loader.isBuiltinName('declared-one')).toBe(true);
      expect(loader.isBuiltinName('kimi')).toBe(false);

      fs.writeFileSync(
        path.join(builtinDir, 'kimi.js'),
        "module.exports = { name: 'kimi', type: 'api', async fetch() { return null; } };",
      );
      await loader.reload();
      try {
        expect(loader.isBuiltinName('declared-one')).toBe(true);
        expect(loader.isBuiltinName('kimi')).toBe(true);
      } finally {
        loader.stop();
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
      fs.rmSync(builtinDir, { recursive: true, force: true });
    }
  });
});
