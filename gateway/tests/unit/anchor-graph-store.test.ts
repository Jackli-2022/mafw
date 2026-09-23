import { GatewayDatabase } from '../../src/memory/gateway-db';
import { AnchorGraphStore } from '../../src/graph/anchor-graph-store';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

describe('AnchorGraphStore IDF weighting', () => {
  let dir: string;
  let db: GatewayDatabase;
  let store: AnchorGraphStore;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anchorg-'));
    db = new GatewayDatabase(path.join(dir, 'test.db'));
    store = new AnchorGraphStore(db);
  });
  afterEach(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); });

  test('稀有锚点边权 > hub 锚点边权', () => {
    for (let i = 0; i < 60; i++) store.upsertUnit('h' + i, ['hub']);
    store.upsertUnit('a', ['rare']);
    store.upsertUnit('b', ['rare']);
    const rareW = store.getNeighbors(['a'], 10).get('b')!.weight;
    const hubW = [...store.getNeighbors(['h0'], 100).values()][0]!.weight;
    expect(rareW).toBeGreaterThan(hubW);
  });

  test('新锚点（df=1）边权最大（未被误杀）', () => {
    store.upsertUnit('a', ['brand-new']);
    store.upsertUnit('b', ['brand-new']);
    expect(store.getNeighbors(['a'], 10).get('b')!.weight).toBeGreaterThan(0);
  });

  test('getNeighbors 按权重降序', () => {
    for (let i = 0; i < 60; i++) store.upsertUnit('h' + i, ['hub']);
    store.upsertUnit('a', ['hub', 'rare']);
    store.upsertUnit('b', ['rare']);
    const nb = store.getNeighbors(['a'], 10);
    const weights = [...nb.values()].map(v => v.weight);
    for (let i = 1; i < weights.length; i++) expect(weights[i - 1]).toBeGreaterThanOrEqual(weights[i]);
  });

  test('removeUnit 清边', () => {
    store.upsertUnit('a', ['x']);
    store.upsertUnit('b', ['x']);
    store.removeUnit('b');
    expect(store.getNeighbors(['a'], 10).size).toBe(0);
  });
});
