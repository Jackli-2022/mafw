import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { GatewayDatabase } from '../../../gateway/src/memory/gateway-db';
import { AnchorGraphStore } from '../../../gateway/src/graph/anchor-graph-store';

let dir: string;
let db: GatewayDatabase;
let store: AnchorGraphStore;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-test-'));
  db = new GatewayDatabase(path.join(dir, 'gateway.db'));
  store = new AnchorGraphStore(db);
});

afterEach(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('upsertUnit creates anchor→unit rows and edges between shared-anchor units', () => {
  store.upsertUnit('mem_a', ['project-orion', 'deadline']);
  store.upsertUnit('mem_b', ['project-orion', 'dave']);
  store.upsertUnit('mem_c', ['unrelated', 'topic']);

  const nb = store.getNeighbors(['mem_a'], 5);
  expect(nb.has('mem_b')).toBe(true);
  expect(nb.has('mem_c')).toBe(false);
  expect(store.getSharedAnchors('mem_a', 'mem_b')).toBe(1);
});

test('upsertUnit replaces old anchors (idempotent rewrite)', () => {
  store.upsertUnit('mem_a', ['x', 'y']);
  store.upsertUnit('mem_b', ['x']);
  expect(store.getSharedAnchors('mem_a', 'mem_b')).toBe(1);
  // 重写 mem_a 去掉 x
  store.upsertUnit('mem_a', ['y', 'z']);
  expect(store.getSharedAnchors('mem_a', 'mem_b')).toBe(0);
});

test('removeUnit clears all edges and anchor rows', () => {
  store.upsertUnit('mem_a', ['x']);
  store.upsertUnit('mem_b', ['x']);
  store.removeUnit('mem_a');
  const nb = store.getNeighbors(['mem_b'], 5);
  expect(nb.has('mem_a')).toBe(false);
});

test('getNeighbors respects topK and orders by weight desc', () => {
  // mem_a 与 mem_b 共享 2 锚点，与 mem_c 共享 1 锚点 → b 权重更高
  store.upsertUnit('mem_a', ['x', 'y', 'z']);
  store.upsertUnit('mem_b', ['x', 'y']);
  store.upsertUnit('mem_c', ['x']);
  const nb = store.getNeighbors(['mem_a'], 1);
  expect([...nb.keys()]).toEqual(['mem_b']);
});

test('rebuild is idempotent and skips superseded entries', () => {
  const index = {
    entries: [
      { id: 'mem_a', cue_anchors: ['x'], superseded_by: undefined },
      { id: 'mem_b', cue_anchors: ['x'], superseded_by: undefined },
      { id: 'mem_old', cue_anchors: ['x'], superseded_by: 'mem_b' },
    ],
  };
  store.rebuild(index as any);
  const nb = store.getNeighbors(['mem_a'], 5);
  expect(nb.has('mem_b')).toBe(true);
  expect(nb.has('mem_old')).toBe(false);

  // 幂等
  store.rebuild(index as any);
  expect(store.getSharedAnchors('mem_a', 'mem_b')).toBe(1);
});

test('getNeighbors excludes passed unit ids', () => {
  store.upsertUnit('mem_a', ['x']);
  store.upsertUnit('mem_b', ['x']);
  const nb = store.getNeighbors(['mem_a'], 5, new Set(['mem_b']));
  expect(nb.has('mem_b')).toBe(false);
});
