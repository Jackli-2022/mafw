import { RuntimePluginLoader } from '../../../src/runtime/loader';
import { wrapGlobalEventStream } from '../../../src/runtime/event-mapper';
import { EVENT_FLOW_MATRIX } from '../../../src/runtime/event-flow-matrix';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const CANON = new Set(Object.keys(EVENT_FLOW_MATRIX)) as ReadonlySet<string>;

function makePluginDir(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-loader-'));
  for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), content);
  return dir;
}

test('声明 eventMappings 的插件：加载后 meta 带映射；未知 canonical to → error + eventStream 降级', async () => {
  const dir = makePluginDir({
    'good.js': `module.exports = { name: 'good', capabilities: { eventStream: true },
      eventSource: { typePath: '$.type' },
      eventMappings: [{ from: 'done', to: 'session.idle' }],
      async createRuntime() { return { name: 'good', capabilities: { eventStream: true } }; } };`,
    'bad.js': `module.exports = { name: 'bad', capabilities: { eventStream: true },
      eventSource: { typePath: '$.type' },
      eventMappings: [{ from: 'x', to: 'not.a.type' }],
      async createRuntime() { return { name: 'bad', capabilities: { eventStream: true } }; } };`,
  });
  const loader = new RuntimePluginLoader(dir);
  loader.setCanonicalTypes(CANON);
  await loader.scan();
  const good = loader.get('good');
  expect(good?.eventMappings).toHaveLength(1);
  const bad = loader.get('bad');
  expect(bad?.capabilities.eventStream).toBe(false); // 降级
  const state = loader.getState().find((s) => s.name === 'bad');
  expect(state?.status).toBe('error');
});

test('wrapGlobalEventStream 端到端：原生进 canonical 出，drop/未知/passthrough 各就各位', async () => {
  const natives = [
    { type: 'done', sessionID: 's1' },
    { type: 'noise', sessionID: 's1' },
    { type: 'mystery' },
    { payload: { type: 'permission.asked', properties: { sessionID: 's1' } } }, // 已 canonical 信封
  ];
  const rt: any = { global: { event: async () => ({ stream: (async function* () { for (const n of natives) yield n; })() }) } };
  const unknown: string[] = [];
  const mini = new Set(['session.idle', 'permission.asked']);
  wrapGlobalEventStream(rt, {
    eventSource: { typePath: '$.type', sessionIdPath: '$.sessionID' },
    eventMappings: [{ from: 'done', to: 'session.idle' }, { from: 'noise', to: 'drop' }],
  }, (t) => mini.has(t), (t) => unknown.push(t));
  const { stream } = await rt.global.event();
  const out: any[] = [];
  for await (const e of stream) out.push(e);
  expect(out).toHaveLength(2);
  expect(out[0].payload.type).toBe('session.idle');
  expect(out[1].payload.type).toBe('permission.asked');
  expect(unknown).toEqual(['mystery']);
});
