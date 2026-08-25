import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { GatewayDatabase } from '../../../gateway/src/memory/gateway-db';
import { HarmonicUnitFileStore } from '../../../gateway/src/memory/harmonic-file-store';
import { ReflectionPipeline } from '../../../gateway/src/recall/reflection';
import { ReflectCursor } from '../../../gateway/src/recall/reflect-cursor';

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
