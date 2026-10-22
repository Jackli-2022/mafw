import { handleSearchHybrid } from '../../../src/mcp/handlers/search-hybrid';
import { handleGetMemory } from '../../../src/mcp/handlers/get-memory';
import { handleManagerListGoals } from '../../../src/mcp/handlers/manager-list-goals';
import { DEFINITIONS } from '../../../src/mcp/tool-registry';

const parse = (r: any) => JSON.parse(r.content[0].text);

// get-memory 的 mem 分支动态 import HarmonicUnitFileStore 并真读磁盘——
// jest.mock 拦截（变量须 mock 前缀，hoisting 约定）
let mockEntries: any[] = [];
let mockUnit: any = null;
jest.mock('../../../src/memory/harmonic-file-store', () => ({
  HarmonicUnitFileStore: class {
    indexManager_() { return { getIndex: () => ({ entries: mockEntries }) }; }
    async read(id: string) { return mockUnit && mockUnit.id === id ? mockUnit : null; }
  },
}));

describe('首批 structured 工具（spec G5，schema 照实 + 同源原则）', () => {
  it('mafw_search_hybrid：structuredContent 与 text 同源（含迭代协议字段）', async () => {
    const r = await handleSearchHybrid({ query: 'x' }, { memory: { search: () => [] } } as any);
    expect(r.structuredContent).toBeDefined();
    expect(r.structuredContent).toEqual(parse(r));
    for (const k of ['results', 'canExpand', 'round', 'count', 'hint']) {
      expect(r.structuredContent!).toHaveProperty(k); // schema 照实：迭代协议字段不得丢
    }
  });
  it('mafw_get_memory（t1 分支）：structuredContent 与 text 同源', async () => {
    const rows = [{ session_id: 'ses_S1', turn_id: 3, source: 'user_input', content: 'q' }];
    const r = await handleGetMemory({ id: 't1:123456:3' }, { resolveT1: () => rows as any } as any);
    expect(r.structuredContent).toBeDefined();
    expect(r.structuredContent).toEqual(parse(r));
    expect((r.structuredContent as any).t1.rows).toHaveLength(1);
  });
  it('mafw_get_memory（mem 分支）：structuredContent 与 text 同源', async () => {
    mockEntries = [{ id: 'mem_1234567890_abcdef', primary_abstraction: 'pa', cue_anchors: ['a'], energy: 0.5, created_at: '2026-10-22', updated_at: '2026-10-22', type: 'semantic' }];
    mockUnit = { id: 'mem_1234567890_abcdef', primary_abstraction: 'pa', memory_value: 'v', cue_anchors: ['a'], type: 'semantic', created_at: '2026-10-22', updated_at: '2026-10-22' };
    const r = await handleGetMemory({ id: 'mem_1234567890_abcdef' }, {} as any);
    expect(parse(r).success).toBe(true);
    expect(r.structuredContent).toEqual(parse(r));
    expect((r.structuredContent as any).memory.id).toBe('mem_1234567890_abcdef');
  });
  it('mafw_list_goals：structuredContent 与 text 同源', async () => {
    const r = await handleManagerListGoals({}, { mafwDir: undefined } as any);
    expect(r.structuredContent).toBeDefined();
    expect(r.structuredContent).toEqual(parse(r));
  });
  it('错误分支无 structuredContent（Review Focus #3）', async () => {
    const missing = await handleGetMemory({ id: 't1:zzzzzz:9' }, { resolveT1: () => [] } as any);
    expect(missing.isError).toBe(true);
    expect(missing.structuredContent).toBeUndefined();
    const notFound = await handleGetMemory({ id: 'mem_nope' }, {} as any);
    if (notFound.isError) expect(notFound.structuredContent).toBeUndefined();
  });
  it('三定义携带 outputSchema（顶层 object，schema 照实）', () => {
    for (const name of ['mafw_search_hybrid', 'mafw_get_memory', 'mafw_list_goals']) {
      const def = DEFINITIONS.find(d => d.name === name)!;
      expect(def.outputSchema).toBeDefined();
      expect(def.outputSchema!.type).toBe('object');
    }
    const search = DEFINITIONS.find(d => d.name === 'mafw_search_hybrid')!;
    for (const k of ['results', 'canExpand', 'round', 'count', 'hint']) {
      expect((search.outputSchema!.properties as any)[k]).toBeDefined();
    }
  });
});
