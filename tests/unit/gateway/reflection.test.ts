import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { GatewayDatabase } from '../../../gateway/src/memory/gateway-db';
import { HarmonicUnitFileStore } from '../../../gateway/src/memory/harmonic-file-store';
import { ReflectionPipeline, REFLECT_SYSTEM } from '../../../gateway/src/recall/reflection';
import { ReflectCursor } from '../../../gateway/src/recall/reflect-cursor';
import { TOOL_EXTRACTION_SYSTEM } from '../../../gateway/src/recall/turn-pipeline';

let dir: string;
let db: GatewayDatabase;
let store: HarmonicUnitFileStore;

const T = '2025-01-01T00:00:00.000Z';

function epUnit(id: string, primary: string, anchors: string[], memoryValue: string): any {
  return {
    id, type: 'episodic', primary_abstraction: primary, cue_anchors: anchors,
    memory_value: memoryValue, energy: 0.8, created_at: T, updated_at: T,
    source_session_id: 'sess-1',
  };
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reflect-'));
  fs.mkdirSync(path.join(dir, 'memory'), { recursive: true });
  db = new GatewayDatabase(path.join(dir, 'gw.db'));
  store = new HarmonicUnitFileStore(dir, undefined, undefined);
});

afterEach(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('reflectSession prompt includes full memory_value', async () => {
  await store.write(epUnit('ep1', 'deployed service', ['deploy'], 'Full narrative of the deployment with all details and the root cause of the outage was the missing timeout on the HTTP client.'));
  const prompts: string[] = [];
  const pipeline = new ReflectionPipeline({
    index: store.indexManager_(),
    baseDir: dir,
    workerFor: () => ({
      prompt: async (_p: string, _sys: string, _m: any) => {
        prompts.push(_p);
        return '{"insights":[]}';
      },
    }) as any,
    cursor: new ReflectCursor(db),
    workerModel: { providerID: 'x', modelID: 'y' },
  });
  await (pipeline as any).reflectSession('sess-1', [{ id: 'ep1', text: 'deployed service deploy' }]);
  expect(prompts[0]).toContain('Full narrative of the deployment');
  expect(prompts[0]).not.toContain('deployed service deploy');
});

test('prompt division: extract focuses on facts, reflect on cross-episode patterns', () => {
  expect(TOOL_EXTRACTION_SYSTEM).toContain('FACT LAYER');
  expect(TOOL_EXTRACTION_SYSTEM).toContain('cross-session pattern generalization');
  expect(REFLECT_SYSTEM).toContain('CROSS-EPISODE');
  expect(REFLECT_SYSTEM).toContain('single-point facts');
});

test('reflectSession runs question to evidence to distillation', async () => {
  await store.write(epUnit('ep1', 'deployed service crashed', ['deploy'], 'Service crashed due to missing timeout.'));
  const calls: { p: string; sys: string }[] = [];
  const searchCalls: string[] = [];
  const mockIndex = Object.create(store.indexManager_());
  mockIndex.searchScored = (q: string) => {
    searchCalls.push(q);
    return [{ entry: { id: 'ev1', primary_abstraction: 'timeout lessons', cue_anchors: [] }, score: 1 }] as any;
  };
  const pipeline = new ReflectionPipeline({
    index: mockIndex,
    baseDir: dir,
    workerFor: () => ({
      prompt: async (p: string, sys: string) => {
        calls.push({ p, sys });
        if (sys.includes('questions')) return '{"questions":["What caused the crash?"]}';
        return '{"insights":[{"category":"failure","content":"Deployments need timeout configuration before release","cue_anchors":["deploy"]}]}';
      },
    }) as any,
    cursor: new ReflectCursor(db),
    workerModel: { providerID: 'x', modelID: 'y' },
  });
  const result = await (pipeline as any).reflectSession('sess-1', [{ id: 'ep1', text: 'deployed service crashed deploy' }]);
  expect(calls.length).toBe(2);
  expect(searchCalls).toContain('What caused the crash?');
  expect(calls[1].p).toContain('### Related Historical Memories');
  expect(calls[1].p).toContain('[ev1] timeout lessons');
  expect(result.distilled).toBe(1);
});

test('reflectSession falls back to direct distillation when questions unparseable', async () => {
  await store.write(epUnit('ep1', 'deployed service crashed', ['deploy'], 'Service crashed.'));
  const calls: string[] = [];
  const searchCalls: string[] = [];
  const mockIndex = Object.create(store.indexManager_());
  mockIndex.searchScored = (q: string) => { searchCalls.push(q); return []; };
  const pipeline = new ReflectionPipeline({
    index: mockIndex,
    baseDir: dir,
    workerFor: () => ({
      prompt: async (p: string, sys: string) => {
        calls.push(sys);
        if (sys.includes('questions')) return 'not json at all';
        return '{"insights":[{"category":"insight","content":"lesson","cue_anchors":["x"]}]}';
      },
    }) as any,
    cursor: new ReflectCursor(db),
    workerModel: { providerID: 'x', modelID: 'y' },
  });
  await (pipeline as any).reflectSession('sess-1', [{ id: 'ep1', text: 'deployed service crashed deploy' }]);
  expect(calls.length).toBe(2);
  expect(searchCalls.length).toBe(0);
});
