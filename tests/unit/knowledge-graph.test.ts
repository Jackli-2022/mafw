import { EntityExtractor } from '../../src/graph/entity-extractor';
import { RelationInferencer } from '../../src/graph/relation-inferencer';
import { GraphSearcher } from '../../src/graph/graph-searcher';
import { KnowledgeGraphManager } from '../../src/graph/knowledge-graph-manager';
import { GraphNode, GraphEdge, KnowledgeGraph } from '../../src/graph/types';

jest.mock('fs');

const fs = require('fs');

describe('EntityExtractor', () => {
  let extractor: EntityExtractor;

  beforeEach(() => {
    extractor = new EntityExtractor();
  });

  test('extracts tech keywords', () => {
    const text = 'The API uses JWT for authentication and Express as middleware';
    const entities = extractor.extract(text);
    expect(entities).toContain('jwt');
    expect(entities).toContain('api');
    expect(entities).toContain('authentication');
    expect(entities).toContain('express');
    expect(entities).toContain('middleware');
  });

  test('extracts file extensions', () => {
    const text = 'Files: main.ts, server.js, model.py, handler.go';
    const entities = extractor.extract(text);
    expect(entities).toContain('.ts');
    expect(entities).toContain('.js');
    expect(entities).toContain('.py');
    expect(entities).toContain('.go');
  });

  test('deduplicates matches', () => {
    const text = 'JWT token and jwt validation';
    const entities = extractor.extract(text);
    expect(entities.filter(e => e === 'jwt').length).toBe(1);
  });

  test('returns empty for unrelated text', () => {
    const entities = extractor.extract('hello world foo bar');
    expect(entities).toEqual([]);
  });

  test('extractWithLLM returns empty array', async () => {
    const result = await extractor.extractWithLLM!('test');
    expect(result).toEqual([]);
  });
});

describe('RelationInferencer', () => {
  let inferencer: RelationInferencer;

  beforeEach(() => {
    inferencer = new RelationInferencer();
  });

  test('creates co-occurrence edges for entities in same sentence', () => {
    const entities = ['jwt', 'express', 'api'];
    const context = 'The api uses jwt and express together.';
    const edges = inferencer.inferRelations(entities, context);
    const coOccurEdges = edges.filter(e => e.relation === 'co_occurs');
    expect(coOccurEdges.length).toBeGreaterThan(0);
    expect(coOccurEdges[0].weight).toBe(0.5);
  });

  test('creates dependency edges when context contains depends on', () => {
    const entities = ['api', 'database'];
    const context = 'The api depends on database for storage.';
    const edges = inferencer.inferRelations(entities, context);
    const depEdges = edges.filter(e => e.relation === 'depends_on');
    expect(depEdges.length).toBeGreaterThan(0);
    expect(depEdges[0].weight).toBe(0.7);
  });

  test('creates cause edges when context contains bug', () => {
    const entities = ['auth', 'error'];
    const context = 'The auth bug causes error in login.';
    const edges = inferencer.inferRelations(entities, context);
    const causeEdges = edges.filter(e => e.relation === 'causes');
    expect(causeEdges.length).toBeGreaterThan(0);
    expect(causeEdges[0].weight).toBe(0.8);
  });

  test('creates part_of edges when context contains part of', () => {
    const entities = ['middleware', 'express'];
    const context = 'Middleware is part of express framework.';
    const edges = inferencer.inferRelations(entities, context);
    const partEdges = edges.filter(e => e.relation === 'part_of');
    expect(partEdges.length).toBeGreaterThan(0);
    expect(partEdges[0].weight).toBe(0.6);
  });

  test('creates no edges for unrelated text', () => {
    const entities = ['jwt', 'express'];
    const context = 'The weather is nice today.';
    const edges = inferencer.inferRelations(entities, context);
    expect(edges.length).toBe(0);
  });

  test('generates unique IDs for each edge', () => {
    const entities = ['jwt', 'express', 'api'];
    const context = 'The api uses jwt and express.';
    const edges = inferencer.inferRelations(entities, context);
    const ids = edges.map(e => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('GraphSearcher', () => {
  function makeGraph(): KnowledgeGraph {
    const nodes = new Map<string, GraphNode>();
    const edges = new Map<string, GraphEdge>();

    const nodeA: GraphNode = { id: 'a', type: 'concept', label: 'auth', energy: 0.8, sourceLoops: [1], properties: {}, createdAt: '2024-01-01' };
    const nodeB: GraphNode = { id: 'b', type: 'concept', label: 'jwt', energy: 0.7, sourceLoops: [1], properties: {}, createdAt: '2024-01-01' };
    const nodeC: GraphNode = { id: 'c', type: 'concept', label: 'express', energy: 0.6, sourceLoops: [1], properties: {}, createdAt: '2024-01-01' };
    const nodeD: GraphNode = { id: 'd', type: 'concept', label: 'middleware', energy: 0.5, sourceLoops: [1], properties: {}, createdAt: '2024-01-01' };
    const nodeE: GraphNode = { id: 'e', type: 'concept', label: 'database', energy: 0.4, sourceLoops: [1], properties: {}, createdAt: '2024-01-01' };

    nodes.set('a', nodeA);
    nodes.set('b', nodeB);
    nodes.set('c', nodeC);
    nodes.set('d', nodeD);
    nodes.set('e', nodeE);

    const edge1: GraphEdge = { id: 'e1', source: 'a', target: 'b', relation: 'uses', weight: 0.9, sourceLoops: [1], createdAt: '2024-01-01' };
    const edge2: GraphEdge = { id: 'e2', source: 'b', target: 'c', relation: 'co_occurs', weight: 0.5, sourceLoops: [1], createdAt: '2024-01-01' };
    const edge3: GraphEdge = { id: 'e3', source: 'c', target: 'd', relation: 'part_of', weight: 0.6, sourceLoops: [1], createdAt: '2024-01-01' };
    const edge4: GraphEdge = { id: 'e4', source: 'a', target: 'e', relation: 'depends_on', weight: 0.7, sourceLoops: [1], createdAt: '2024-01-01' };

    edges.set('e1', edge1);
    edges.set('e2', edge2);
    edges.set('e3', edge3);
    edges.set('e4', edge4);

    return { nodes, edges };
  }

  let searcher: GraphSearcher;

  beforeEach(() => {
    const graph = makeGraph();
    searcher = new GraphSearcher(graph);
  });

  test('BFS traversal from auth node', () => {
    const results = searcher.search(['auth'], 1);
    expect(results.length).toBe(3);
    const labels = results.map(r => r.label);
    expect(labels).toContain('auth');
    expect(labels).toContain('jwt');
    expect(labels).toContain('database');
  });

  test('BFS with depth 2 finds nodes within 2 hops', () => {
    const results = searcher.search(['auth'], 2);
    expect(results.length).toBe(4);
    const labels = results.map(r => r.label);
    expect(labels).toContain('express');
  });

  test('BFS with depth 3 finds all nodes', () => {
    const results = searcher.search(['auth'], 3);
    expect(results.length).toBe(5);
  });

  test('search with no matches returns empty', () => {
    const results = searcher.search(['nonexistent'], 2);
    expect(results).toEqual([]);
  });

  test('calculateImportance sums incoming edge weights', () => {
    const importance = searcher.calculateImportance('b');
    expect(importance).toBe(0.9);
  });

  test('calculateImportance for node with no incoming edges', () => {
    const importance = searcher.calculateImportance('d');
    expect(importance).toBeCloseTo(0.6, 1);
  });

  test('calculateImportance for isolated node returns 0', () => {
    const graph = makeGraph();
    graph.nodes.set('iso', { id: 'iso', type: 'concept', label: 'isolated', energy: 0.5, sourceLoops: [1], properties: {}, createdAt: '2024-01-01' });
    const s = new GraphSearcher(graph);
    expect(s.calculateImportance('iso')).toBe(0);
  });

  test('findPath returns shortest path between nodes', () => {
    const path = searcher.findPath('a', 'd');
    expect(path).toEqual(['a', 'b', 'c', 'd']);
  });

  test('findPath returns empty for unreachable nodes', () => {
    const path = searcher.findPath('a', 'nonexistent');
    expect(path).toEqual([]);
  });

  test('findPath from a node to itself', () => {
    const path = searcher.findPath('a', 'a');
    expect(path).toEqual(['a']);
  });

  test('findRelated returns connected nodes sorted by weight', () => {
    const related = searcher.findRelated('a');
    expect(related.length).toBe(2);
    expect(related[0].label).toBe('jwt');
    expect(related[1].label).toBe('database');
  });

  test('findRelated with relation filter', () => {
    const related = searcher.findRelated('a', 'uses');
    expect(related.length).toBe(1);
    expect(related[0].label).toBe('jwt');
  });

  test('findRelated with maxResults', () => {
    const related = searcher.findRelated('a', undefined, 1);
    expect(related.length).toBe(1);
  });
});

describe('KnowledgeGraphManager', () => {
  let manager: KnowledgeGraphManager;
  const testPath = './test-knowledge-graph.json';

  beforeEach(() => {
    jest.clearAllMocks();
    (fs.existsSync as jest.Mock).mockReturnValue(false);
    manager = new KnowledgeGraphManager(testPath);
  });

  test('addNode and getNode', () => {
    const node: GraphNode = {
      id: 'node-jwt',
      type: 'concept',
      label: 'jwt',
      energy: 0.8,
      sourceLoops: [1],
      properties: {},
      createdAt: '2024-01-01',
    };
    manager.addNode(node);
    expect(manager.getNode('node-jwt')).toEqual(node);
  });

  test('addEdge', () => {
    const edge: GraphEdge = {
      id: 'edge-1',
      source: 'a',
      target: 'b',
      relation: 'uses',
      weight: 0.9,
      sourceLoops: [1],
      createdAt: '2024-01-01',
    };
    manager.addEdge(edge);
    const graph = manager.getGraph();
    expect(graph.edges).toContainEqual(edge);
  });

  test('removeNode removes associated edges', () => {
    const node: GraphNode = { id: 'n1', type: 'concept', label: 'test', energy: 0.5, sourceLoops: [1], properties: {}, createdAt: '2024-01-01' };
    const edge: GraphEdge = { id: 'e1', source: 'n1', target: 'n2', relation: 'uses', weight: 0.5, sourceLoops: [1], createdAt: '2024-01-01' };
    manager.addNode(node);
    manager.addEdge(edge);
    manager.removeNode('n1');
    expect(manager.getNode('n1')).toBeUndefined();
    expect(manager.getGraph().edges.length).toBe(0);
  });

  test('removeEdge', () => {
    const edge: GraphEdge = { id: 'e1', source: 'a', target: 'b', relation: 'uses', weight: 0.5, sourceLoops: [1], createdAt: '2024-01-01' };
    manager.addEdge(edge);
    manager.removeEdge('e1');
    expect(manager.getGraph().edges.length).toBe(0);
  });

  test('search returns matching nodes by label', () => {
    manager.addNode({ id: 'node-api', type: 'concept', label: 'api', energy: 0.5, sourceLoops: [1], properties: {}, createdAt: '2024-01-01' });
    manager.addNode({ id: 'node-jwt', type: 'concept', label: 'jwt', energy: 0.5, sourceLoops: [1], properties: {}, createdAt: '2024-01-01' });
    const results = manager.search('api');
    expect(results.length).toBe(1);
    expect(results[0].label).toBe('api');
  });

  test('search respects maxResults', () => {
    manager.addNode({ id: 'n1', type: 'concept', label: 'api', energy: 0.5, sourceLoops: [1], properties: {}, createdAt: '2024-01-01' });
    manager.addNode({ id: 'n2', type: 'concept', label: 'api-gateway', energy: 0.5, sourceLoops: [1], properties: {}, createdAt: '2024-01-01' });
    const results = manager.search('api', 1);
    expect(results.length).toBe(1);
  });

  test('save and load round-trip', async () => {
    const mockFiles: Record<string, string> = {};
    (fs.existsSync as jest.Mock).mockImplementation((p: string) => p in mockFiles);
    (fs.writeFileSync as jest.Mock).mockImplementation((p: string, data: string) => {
      mockFiles[p] = data;
    });
    (fs.readFileSync as jest.Mock).mockImplementation((p: string) => mockFiles[p]);
    (fs.renameSync as jest.Mock).mockImplementation((src: string, dest: string) => {
      mockFiles[dest] = mockFiles[src];
      delete mockFiles[src];
    });

    manager.addNode({ id: 'node-jwt', type: 'concept', label: 'jwt', energy: 0.8, sourceLoops: [1], properties: {}, createdAt: '2024-01-01' });
    await manager.save();

    const manager2 = new KnowledgeGraphManager(testPath);
    await manager2.load();

    expect(manager2.getNode('node-jwt')).toBeDefined();
    expect(manager2.getNode('node-jwt')!.label).toBe('jwt');
  });

  test('load with no existing file initializes empty graph', async () => {
    (fs.existsSync as jest.Mock).mockReturnValue(false);
    const m = new KnowledgeGraphManager('./nonexistent.json');
    await m.load();
    expect(m.getGraph().nodes).toEqual([]);
    expect(m.getGraph().edges).toEqual([]);
  });

  test('processObservation pipeline', async () => {
    await manager.processObservation('The API uses JWT for authentication', 1);
    const graph = manager.getGraph();
    expect(graph.nodes.length).toBeGreaterThan(0);
    expect(graph.edges.length).toBeGreaterThan(0);
  });

  test('getGraph returns plain objects', () => {
    const graph = manager.getGraph();
    expect(Array.isArray(graph.nodes)).toBe(true);
    expect(Array.isArray(graph.edges)).toBe(true);
  });
});
