/**
 * SearchOptions.retriever may be omitted. The configured default is BM25;
 * token substring counting is an explicit legacy fallback only.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { HarmonicIndexManager } from '../../../../src/core/memory/harmonic-index';

describe('searchScored default retriever', () => {
  test('omitted retriever uses BM25, not token substring scoring', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-default-retriever-'));
    fs.mkdirSync(path.join(dir, 'memory'), { recursive: true });
    const index = new HarmonicIndexManager(dir);
    const bm25 = jest.spyOn(index as any, 'bm25SearchScored').mockReturnValue([]);
    const token = jest.spyOn(index as any, 'tokenSearchScored').mockReturnValue([]);

    index.searchScored('mafw_topic_set', 5);
    expect(bm25).toHaveBeenCalled();
    expect(token).not.toHaveBeenCalled();

    index.searchScored('mafw_topic_set', 5, { retriever: 'token' });
    expect(token).toHaveBeenCalled();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
