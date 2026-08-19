import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { GatewayDatabase } from '../../../gateway/src/memory/gateway-db';
import { AnchorGraphStore } from '../../../gateway/src/graph/anchor-graph-store';
import { HarmonicUnitFileStore } from '../../../gateway/src/memory/harmonic-file-store';
import { handleSearchHybrid, encodeState, decodeState } from '../../../gateway/src/mcp/handlers/search-hybrid';

let dir: string;
let db: GatewayDatabase;
let graph: AnchorGraphStore;
let store: HarmonicUnitFileStore;

const T = '2025-01-01T00:00:00.000Z';

function unit(id: string, primary: string, anchors: string[]): any {
  return {
    id, type: 'semantic', primary_abstraction: primary, cue_anchors: anchors,
    memory_value: 'v', energy: 0.8, created_at: T, updated_at: T,
  };
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shp-'));
  const memoryDir = path.join(dir, 'memory');
  fs.mkdirSync(memoryDir, { recursive: true });
  db = new GatewayDatabase(path.join(dir, 'gw.db'));
  graph = new AnchorGraphStore(db);
  store = new HarmonicUnitFileStore(dir, undefined, graph);
  store.indexManager_().setAnchorGraphStore(graph);   // 关键：图必须 attach 到 index manager
});

afterEach(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

function services() {
  return { memory: store.indexManager_(), mafwDir: dir } as any;
}

// A-B-C-D 四单元链：query 'Dave agreed Orion schedule' 命中 a(全词) + b(锚点 orion-plan 弱命中)；
// searchScored 1-hop 图扩展从 b 带回 c；d 与 c 共享 risk-review（与 query 无词重叠）→ 首轮结果 a/b/c，frontier={d}
async function seedChain() {
  await store.write(unit('a', 'Dave agreed the Orion schedule', ['orion-plan', 'dave']));
  await store.write(unit('b', 'Prototype shipped early April', ['orion-plan', 'prototype']));
  await store.write(unit('c', 'Risks reviewed for slip', ['prototype', 'risk-review']));
  await store.write(unit('d', 'Mitigation steps drafted', ['risk-review', 'mitigation']));
}

test('encodeState/decodeState round-trips', () => {
  const s = { seen: ['a'], frontier: [{ id: 'c', weight: 2 }], round: 1 };
  expect(decodeState(encodeState(s))).toEqual(s);
});

test('decodeState returns null on corrupt input', () => {
  expect(decodeState('not-json')).toBeNull();
  expect(decodeState('')).toBeNull();
  expect(decodeState(null)).toBeNull();
});

test('first round returns results + canExpand + state', async () => {
  await seedChain();
  const res = JSON.parse((await handleSearchHybrid({ query: 'Dave agreed Orion schedule' }, services())).content[0].text);
  expect(res.results.length).toBeGreaterThan(0);
  expect(res.canExpand).toBe(true);       // frontier = {c}
  expect(res.state).toBeTruthy();
  expect(res.round).toBe(0);
  expect(res.count).toBe(res.results.length);
  expect(typeof res.hint).toBe('string');
});

test('iteration round returns increment (no seen) and advances state', async () => {
  await seedChain();
  const first = JSON.parse((await handleSearchHybrid({ query: 'Dave agreed Orion schedule' }, services())).content[0].text);
  const firstIds = new Set(first.results.map((r: any) => r.id));
  const iter = JSON.parse((await handleSearchHybrid({ query: 'Dave agreed Orion schedule', state: first.state }, services())).content[0].text);
  expect(iter.round).toBe(1);
  expect(iter.results.length).toBeGreaterThan(0);
  for (const r of iter.results) expect(firstIds.has(r.id)).toBe(false);   // 增量：不含已见
  expect(iter.results.map((r: any) => r.id)).toContain('d');              // 链尾经 frontier 进入
});

test('round cap: state.round=2 returns canExpand=false without iterating', async () => {
  const s = encodeState({ seen: ['a'], frontier: [{ id: 'c', weight: 2 }], round: 2 });
  const res = JSON.parse((await handleSearchHybrid({ query: 'Dave agreed Orion schedule', state: s }, services())).content[0].text);
  expect(res.canExpand).toBe(false);
  expect(res.round).toBe(2);              // clamp：不递增到 3
  expect(res.results.length).toBe(0);     // 轮次已满：不消费 frontier，query 命中已 seen → 无增量
});

test('no shared anchors -> canExpand=false', async () => {
  await store.write(unit('x', 'Unrelated cooking recipe', ['cooking']));
  const res = JSON.parse((await handleSearchHybrid({ query: 'cooking recipe' }, services())).content[0].text);
  expect(res.canExpand).toBe(false);
  expect(res.state).toBeNull();
});

test('bad state falls back to first-round behavior', async () => {
  await seedChain();
  const res = JSON.parse((await handleSearchHybrid({ query: 'Dave agreed Orion schedule', state: 'garbage' }, services())).content[0].text);
  expect(res.round).toBe(0);
  expect(res.results.length).toBeGreaterThan(0);
});
