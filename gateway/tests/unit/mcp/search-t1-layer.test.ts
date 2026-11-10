import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { handleSearchHybrid } from '../../../src/mcp/handlers/search-hybrid';

const parse = (r: any) => JSON.parse(r.content[0].text);

function setup(overrides: Record<string, any> = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'search-t1-'));
  const search = jest.fn(() => []);
  const searchT1 = jest.fn(async () => [
    { sessionId: 's1', turnId: 1, traceId: 't1t_a', cosine: 0.8, excerpt: 'raw' },
  ]);
  const recordT1Retrieval = jest.fn();
  const services = {
    memory: {
      search,
      harmonicIndex: { getIndex: () => ({ entries: [] }), getAnchorGraphStore: () => null },
    },
    searchT1,
    recordT1Retrieval,
    mafwDir: dir,
    ...overrides,
  } as any;
  return { dir, search, searchT1, recordT1Retrieval, services };
}

const cleanup = (dir: string) => fs.rmSync(dir, { recursive: true, force: true });

describe('mafw_search_hybrid layer selection', () => {
  test('omitted layer keeps gist-only behavior and does not touch T1', async () => {
    const { dir, search, searchT1, services } = setup();
    const r = await handleSearchHybrid({ query: 'q' }, services);
    const body = parse(r);
    expect(search).toHaveBeenCalledTimes(1);
    expect(searchT1).not.toHaveBeenCalled();
    expect(body.results).toEqual([]);
    expect(body).not.toHaveProperty('t1Results');
    cleanup(dir);
  });

  test('layer=t1 searches only T1, records search events, and skips Harmonic', async () => {
    const { dir, search, searchT1, recordT1Retrieval, services } = setup();
    const r = await handleSearchHybrid({ query: 'q', layer: 't1', topK: 2 }, services);
    const body = parse(r);
    expect(search).not.toHaveBeenCalled();
    expect(searchT1).toHaveBeenCalledWith('q', 2);
    expect(body.results).toEqual([]);
    expect(body.t1Results).toHaveLength(1);
    expect(body.t1Results[0].traceId).toBe('t1t_a');
    expect(body.canExpand).toBe(false);
    expect(recordT1Retrieval).toHaveBeenCalledWith('t1t_a', 'search', 0.8);
    cleanup(dir);
  });

  test('layer=both returns both result sets', async () => {
    const { dir, search, searchT1, services } = setup();
    search.mockReturnValue([{ id: 'mem_1', type: 'semantic' }]);
    const r = await handleSearchHybrid({ query: 'q', layer: 'both' }, services);
    const body = parse(r);
    expect(search).toHaveBeenCalledTimes(1);
    expect(searchT1).toHaveBeenCalledTimes(1);
    expect(body.results).toHaveLength(1);
    expect(body.t1Results).toHaveLength(1);
    cleanup(dir);
  });

  test('invalid layer is an explicit tool error', async () => {
    const { dir, search, services } = setup();
    const r = await handleSearchHybrid({ query: 'q', layer: 'nope' }, services);
    expect(r.isError).toBe(true);
    expect(parse(r).error).toContain('gist|t1|both');
    expect(search).not.toHaveBeenCalled();
    cleanup(dir);
  });

  test('T1 failure is fail-open for both mode', async () => {
    const { dir, search, services } = setup({
      searchT1: async () => { throw new Error('t1 down'); },
    });
    search.mockReturnValue([{ id: 'mem_1', type: 'semantic' }]);
    const r = await handleSearchHybrid({ query: 'q', layer: 'both' }, services);
    const body = parse(r);
    expect(body.results).toHaveLength(1);
    expect(body.t1Results).toEqual([]);
    cleanup(dir);
  });
});
