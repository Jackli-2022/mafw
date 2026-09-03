import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PluginLoader, validateConfigSchema } from '../../src/usage/plugin-loader';

const CLEANUP: string[] = [];
const LOADERS: PluginLoader[] = [];
function tmpDir(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-usage-schema-'));
  CLEANUP.push(d);
  return d;
}
afterAll(() => {
  for (const l of LOADERS) l.stop();
  for (const d of CLEANUP) fs.rmSync(d, { recursive: true, force: true });
});

describe('validateConfigSchema', () => {
  it('passes a valid schema', () => {
    const s = [
      { key: 'endpoint', label: 'URL', type: 'string' },
      { key: 'retries', label: '重试', type: 'number', default: 1 },
    ];
    expect(validateConfigSchema(s)).toHaveLength(2);
  });

  it('rejects non-array/empty/bad fields', () => {
    expect(validateConfigSchema(undefined)).toBeUndefined();
    expect(validateConfigSchema([])).toBeUndefined();
    expect(validateConfigSchema([{ key: 'a b', label: 'x', type: 'string' }])).toBeUndefined();
    expect(validateConfigSchema([{ key: 'a', label: 'x', type: 'select' }])).toBeUndefined();
    expect(validateConfigSchema([{ key: 'a', label: 3, type: 'string' }])).toBeUndefined();
    expect(validateConfigSchema('nope')).toBeUndefined();
  });
});

describe('PluginLoader configSchema passthrough', () => {
  it('exposes configSchema in state', async () => {
    const dir = tmpDir();
    fs.writeFileSync(
      path.join(dir, 'p.js'),
      `module.exports = { name: 'p', fetch: async () => null, configSchema: [{ key: 'endpoint', label: 'URL', type: 'string' }] };`,
    );
    fs.writeFileSync(
      path.join(dir, 'bad.js'),
      `module.exports = { name: 'bad', fetch: async () => null, configSchema: 'nope' };`,
    );
    const loader = new PluginLoader(dir, []);
    LOADERS.push(loader);
    await loader.init();
    const state = loader.getState();
    expect(state.find(s => s.name === 'p')?.configSchema).toHaveLength(1);
    expect(state.find(s => s.name === 'bad')?.configSchema).toBeUndefined();
  });
});
