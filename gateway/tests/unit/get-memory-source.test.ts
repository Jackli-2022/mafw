import { handleGetMemory } from '../../src/mcp/handlers/get-memory';
import { HarmonicIndexManager } from '../../src/core/memory/harmonic-index';
import { HarmonicUnitFileStore } from '../../src/memory/harmonic-file-store';
import { HarmonicUnit } from '../../src/core/memory/harmonic-types';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

async function setup(withArchive: boolean) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'getmem-src-'));
  fs.mkdirSync(path.join(dir, 'memory'), { recursive: true });
  const index = new HarmonicIndexManager(dir);
  const now = new Date().toISOString();
  const unit: HarmonicUnit = { id: 'mem_1_abcdef', type: 'semantic', primary_abstraction: 'k8s note', cue_anchors: ['kubernetes'], memory_value: 'full value', energy: 0.8, created_at: now, updated_at: now, source_session_id: 's1' } as HarmonicUnit;
  const store = new HarmonicUnitFileStore(dir, index);
  await store.write(unit);
  const services: any = { memory: { harmonicIndex: index }, mafwDir: dir };
  if (withArchive) {
    services.searchArchive = (_sid: string, _anchors: string[], _k: number) => ([
      { source: 'user_input', content: 'raw kubernetes question' },
    ] as any);
  }
  return { dir, services };
}

describe('handleGetMemory source reconstruction', () => {
  test('有 searchArchive 时附 source.evidence', async () => {
    const { dir, services } = await setup(true);
    const res = await handleGetMemory({ id: 'mem_1_abcdef' }, services);
    const body = JSON.parse(res.content[0].text);
    expect(body.success).toBe(true);
    expect(body.source.evidence).toContain('raw kubernetes question');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('无 searchArchive 时不附 source', async () => {
    const { dir, services } = await setup(false);
    const res = await handleGetMemory({ id: 'mem_1_abcdef' }, services);
    const body = JSON.parse(res.content[0].text);
    expect(body.source).toBeUndefined();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
