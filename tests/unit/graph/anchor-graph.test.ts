import { AnchorGraph } from '../../../gateway/src/graph/anchor-graph';
import { IDFStats } from '../../../gateway/src/retrieval/idf-stats';

test('builds implicit edges from shared anchors', () => {
  const graph = new AnchorGraph();
  const idf = new IDFStats(0.4);
  idf.addDocument(['payment', 'create']);
  idf.addDocument(['payment', 'refund']);
  idf.addDocument(['order']);
  idf.addDocument(['invoice']);
  idf.addDocument(['shipping']);

  graph.addUnit('mem_001', ['payment', 'create']);
  graph.addUnit('mem_002', ['payment', 'refund']);

  const edges = graph.buildImplicitEdges(idf);
  expect(graph.getNeighbors('mem_001', edges)).toContain('mem_002');
});

test('skips noisy anchors for implicit edges', () => {
  const graph = new AnchorGraph();
  const idf = new IDFStats(0.5);
  idf.addDocument(['common']);
  idf.addDocument(['common']);

  graph.addUnit('mem_001', ['common']);
  graph.addUnit('mem_002', ['common']);
  const edges = graph.buildImplicitEdges(idf);
  expect(graph.getNeighbors('mem_001', edges)).not.toContain('mem_002');
});

test('detects hub nodes', () => {
  const graph = new AnchorGraph(3);
  for (let i = 0; i < 5; i++) {
    graph.addUnit(`mem_${i}`, ['shared_anchor']);
  }
  expect(graph.isHubNode('shared_anchor')).toBe(true);
});
