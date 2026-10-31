import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runPluginCheck, pluginCheckExitCode } from '../../../src/runtime/plugin-check';

function writePlugin(source: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-check-'));
  const file = path.join(dir, 'plugin.js');
  fs.writeFileSync(file, source);
  return file;
}

const SESSION_STUBS = `
  session: {
    async create() { return { id: 's1' }; },
    async promptAsync() {},
    async prompt() { return { parts: [] }; },
    async messages() { return { data: [] }; },
    async get() { return {}; },
    async delete() {},
    async abort() {},
    async list() { return []; },
    async todo() { return []; },
    async children() { return []; },
    async summarize() {},
  },
  global: { async event() { return { stream: (async function* () {})() }; } },
  provider: { async list() { return { all: [], connected: [], default: {} }; } },
  app: { async agents() { return []; } },
  config: { async get() { return {}; }, async update(c) { return c; } },
  tools: { async registerTools() {}, nativeTools() { return []; } },
  getBaseUrl() { return 'http://127.0.0.1:3000'; },
`;

function goodPlugin(extra = ''): string {
  return `module.exports = {
  name: 'good',
  capabilities: { eventStream: true },
  eventSource: { typePath: '$.type' },
  eventMappings: [{ from: 'done', to: 'turn.completed' }],
  sampleEvents: [{ type: 'done', sessionID: 's1' }],
  ${extra}
  async createRuntime() {
    return { name: 'good', ${SESSION_STUBS} };
  },
};`;
}

describe('runPluginCheck', () => {
  test('good plugin: status ok, sample translated, exit 0', async () => {
    const r = await runPluginCheck({ file: writePlugin(goodPlugin()) });
    expect(r.status).toBe('ok');
    expect(r.translation.mode).toBe('declared');
    expect(r.samples).toMatchObject({ total: 1, translated: 1, unmatched: 0 });
    expect(pluginCheckExitCode(r)).toBe(0);
  });

  test('missing name → status error and exit 1', async () => {
    const r = await runPluginCheck({ file: writePlugin('module.exports = { createRuntime() {} };') });
    expect(r.status).toBe('error');
    expect(r.error).toContain('name');
    expect(pluginCheckExitCode(r)).toBe(1);
  });

  test('createRuntime throw → status error, never crashes', async () => {
    const r = await runPluginCheck({
      file: writePlugin(`module.exports = { name: 'boom', capabilities: {}, async createRuntime() { throw new Error('nope'); } };`),
    });
    expect(r.status).toBe('error');
    expect(r.error).toContain('nope');
    expect(pluginCheckExitCode(r)).toBe(1);
  });

  test('self translation is reported as escape mode', async () => {
    const r = await runPluginCheck({
      file: writePlugin(`module.exports = { name: 'selfy', eventTranslation: 'self', capabilities: { eventStream: true },
        async createRuntime() { return { name: 'selfy', ${SESSION_STUBS} }; } };`),
    });
    expect(r.status).toBe('ok');
    expect(r.translation.mode).toBe('self');
  });

  test('unknown canonical mapping target → error', async () => {
    const r = await runPluginCheck({
      file: writePlugin(`module.exports = { name: 'badtarget', capabilities: { eventStream: true },
        eventSource: { typePath: '$.type' },
        eventMappings: [{ from: 'x', to: 'not.a.type' }],
        async createRuntime() { return { name: 'badtarget', ${SESSION_STUBS} }; } };`),
    });
    expect(r.status).toBe('error');
    expect(r.translation.issues.join(' ')).toContain('not.a.type');
  });

  test('strict preset gap → exit 1', async () => {
    const r = await runPluginCheck({ file: writePlugin(goodPlugin()), preset: 'desktop', strict: true });
    expect(r.preset).toBe('desktop');
    expect(r.presetMissing.length).toBeGreaterThan(0);
    expect(pluginCheckExitCode(r, true)).toBe(1);
  });

  test('all samples unmatched → exit 1', async () => {
    const r = await runPluginCheck({
      file: writePlugin(`module.exports = { name: 'nosample', capabilities: { eventStream: true },
        eventSource: { typePath: '$.type' },
        eventMappings: [{ from: 'done', to: 'turn.completed' }],
        sampleEvents: [{ type: 'mystery', sessionID: 's1' }],
        async createRuntime() { return { name: 'nosample', ${SESSION_STUBS} }; } };`),
    });
    expect(r.samples?.unmatched).toBe(1);
    expect(pluginCheckExitCode(r)).toBe(1);
  });

  test('unknown preset → error and exit 1 (no "complete" false green)', async () => {
    const r = await runPluginCheck({ file: writePlugin(goodPlugin()), preset: 'Desktop' as any, strict: true });
    expect(r.status).toBe('error');
    expect(r.error).toContain('unknown preset');
    expect(pluginCheckExitCode(r, true)).toBe(1);
  });

  test('require failure → error report, preset not evaluated', async () => {
    const r = await runPluginCheck({ file: path.join(os.tmpdir(), 'does-not-exist-xyz.js') });
    expect(r.status).toBe('error');
    expect(r.presetEvaluated).toBe(false);
    expect(pluginCheckExitCode(r)).toBe(1);
  });

  test('malformed mapping table (null row) → error report, never throws', async () => {
    const r = await runPluginCheck({
      file: writePlugin(`module.exports = { name: 'malformed', capabilities: { eventStream: true },
        eventSource: { typePath: '$.type' },
        eventMappings: [null],
        async createRuntime() { return { name: 'malformed', ${SESSION_STUBS} }; } };`),
    });
    expect(r.status).toBe('error');
    expect(pluginCheckExitCode(r)).toBe(1);
  });

  test('eventSource-only dead config → error (same verdict as loader)', async () => {
    const r = await runPluginCheck({
      file: writePlugin(`module.exports = { name: 'deadsource', capabilities: { eventStream: true },
        eventSource: { typePath: '$.type' },
        async createRuntime() { return { name: 'deadsource', ${SESSION_STUBS} }; } };`),
    });
    expect(r.status).toBe('error');
    expect(r.translation.issues.join(' ')).toContain('dead config');
  });
});
