import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { config } from '../../../src/config';
import { handleSearchHybrid } from '../../../src/mcp/handlers/search-hybrid';

const parse = (r: any) => JSON.parse(r.content[0].text);

describe('mafw_search_hybrid score parity', () => {
  test('keeps BM25 score order instead of flattening every candidate to 1', async () => {
    const previousReranker = config.search.reranker;
    config.search.reranker = 'off';
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'search-score-parity-'));
    const entries = [
      { id: 'low', type: 'semantic', primary_abstraction: 'weak hit' },
      { id: 'high', type: 'semantic', primary_abstraction: 'strong exact hit' },
    ];
    const services: any = {
      memory: {
        search: () => entries,
        harmonicIndex: {
          searchScored: () => [
            { entry: entries[0], score: 0.2 },
            { entry: entries[1], score: 9.9 },
          ],
          getIndex: () => ({ entries }),
          getAnchorGraphStore: () => null,
        },
      },
      mafwDir: dir,
    };

    try {
      const body = parse(await handleSearchHybrid({ query: 'exact hit', topK: 2 }, services));
      expect(body.results.map((r: any) => r.id)).toEqual(['high', 'low']);
    } finally {
      config.search.reranker = previousReranker;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
