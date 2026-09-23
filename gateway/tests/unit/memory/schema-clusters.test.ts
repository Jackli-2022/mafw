/**
 * S2.2: embedding schema clusters (assignment / representatives / related clusters).
 */
import { assignCluster, topClusters } from '../../../src/memory/schema-clusters';

test('assigns to nearest cluster above theta, else new', () => {
  const c = [{ id: 'c1', centroid: [1, 0], members: ['a'] }];
  expect(assignCluster('b', [0.99, 0.1], c, 0.85).clusterId).toBe('c1');
  expect(assignCluster('c', [0, 1], c, 0.85).isNew).toBe(true);
});

test('topClusters ranks by cosine', () => {
  const c = [
    { id: 'c1', centroid: [1, 0], members: [] },
    { id: 'c2', centroid: [0, 1], members: [] },
  ];
  expect(topClusters([1, 0.1], c, 1).map((x) => x.id)).toEqual(['c1']);
});

test('topClusters n larger than list returns all sorted', () => {
  const c = [
    { id: 'c1', centroid: [1, 0], members: [] },
    { id: 'c2', centroid: [0, 1], members: [] },
  ];
  expect(topClusters([1, 0], c, 5).map((x) => x.id)).toEqual(['c1', 'c2']);
});
