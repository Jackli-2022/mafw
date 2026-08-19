import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { CognitiveGraphManager } from '../../gateway/src/core/memory/cognitive-graph';

describe('CognitiveGraphManager', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates empty graph on construction', () => {
    const mgr = new CognitiveGraphManager(tmpDir);
    const graph = mgr.getGraph();
    expect(graph.version).toBe(1);
    expect(graph.updated_at).toBeTruthy();
    expect(graph.edges).toEqual([]);
  });

  it('adds a connection between two IDs', () => {
    const mgr = new CognitiveGraphManager(tmpDir);
    mgr.addConnection('mem_a', 'mem_b');
    const graph = mgr.getGraph();
    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0]).toEqual({ source: 'mem_a', target: 'mem_b', weight: 1 });
  });

  it('increments weight for repeated connections', () => {
    const mgr = new CognitiveGraphManager(tmpDir);
    mgr.addConnection('x', 'y');
    mgr.addConnection('x', 'y');
    const graph = mgr.getGraph();
    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0].weight).toBe(2);
  });

  it('returns top associations sorted by weight', () => {
    const mgr = new CognitiveGraphManager(tmpDir);
    mgr.addConnection('a', 'b');
    mgr.addConnection('a', 'b');
    mgr.addConnection('a', 'c');
    mgr.addConnection('a', 'd');
    const top = mgr.getTopAssociations('a', 2);
    expect(top).toEqual(['b', 'c']);
  });

  it('prunes low-weight edges', () => {
    const mgr = new CognitiveGraphManager(tmpDir);
    mgr.addConnection('a', 'b');
    mgr.addConnection('a', 'b');
    mgr.addConnection('a', 'c');
    mgr.addConnection('a', 'd');
    mgr.prune(2);
    const graph = mgr.getGraph();
    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0]).toEqual({ source: 'a', target: 'b', weight: 2 });
  });
});
