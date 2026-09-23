import { GatewayDatabase } from '../../../src/memory/gateway-db';
import { CoactivationGraphStore } from '../../../src/graph/coactivation-store';
import { HarmonicIndexManager } from '../../../src/core/memory/harmonic-index';
import { HarmonicUnitFileStore } from '../../../src/memory/harmonic-file-store';
import { HarmonicUnit } from '../../../src/core/memory/harmonic-types';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

function unit(id: string, sessionId: string): HarmonicUnit {
  const now = new Date().toISOString();
  return {
    id, type: 'episodic', primary_abstraction: 'abs ' + id, cue_anchors: [],
    memory_value: 'value ' + id, energy: 0.8, created_at: now, updated_at: now,
    source_session_id: sessionId,
  } as HarmonicUnit;
}

describe('coactivation write path', () => {
  test('写入同会话两条记忆 → 生成共激活边，且索引条目带 created_at', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coact-w-'));
    const db = new GatewayDatabase(path.join(dir, 'test.db'));
    const index = new HarmonicIndexManager(dir);
    const coact = new CoactivationGraphStore(db);
    const store = new HarmonicUnitFileStore(dir, index, undefined, coact);

    await store.write(unit('a', 's1'));
    await store.write(unit('b', 's1'));

    expect(coact.getNeighbors(['a'], 10).get('a')!.get('b')).toBeGreaterThan(0);
    const entry = index.getIndex().entries.find(e => e.id === 'a')!;
    expect(entry.created_at).toBeTruthy();

    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
