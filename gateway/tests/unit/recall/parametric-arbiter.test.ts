// G4 parametric arbiter (MARTA arXiv:2610.05223): pre-/post-retrieval
// arbitration — never hard-skips in v1, only annotates. Complements FOK
// (does memory have it?) with a parametric-sufficiency estimate.
import {
  arbitrateRetrieval,
  entityOverlap,
  buildEntitySet,
  hasSelfReference,
  ARBITER_PARAMETRIC_NOTE,
  ARBITER_SPARSE_NOTE,
} from '../../../src/recall/parametric-arbiter';

describe('entityOverlap', () => {
  const entities = buildEntitySet([
    { id: 'a', cue_anchors: ['llamacpp', 'embedding-sidecar'] },
    { id: 'b', cue_anchors: ['mafw', 'llamacpp'] },
    { id: 'c', cue_anchors: ['common', 'x'] },
  ] as any);

  it('counts query tokens that are known entities (containment on query side)', () => {
    expect(entityOverlap('llamacpp sidecar 超时', entities)).toBeGreaterThan(0);
  });
  it('zero overlap for unrelated generic queries', () => {
    expect(entityOverlap('python reverse string', entities)).toBe(0);
  });
  it('empty query / empty set → 0', () => {
    expect(entityOverlap('', entities)).toBe(0);
    expect(entityOverlap('llamacpp', new Set())).toBe(0);
  });
});

describe('hasSelfReference', () => {
  it('detects first-person / temporal self-reference', () => {
    for (const q of ['我们的部署流程', '上次怎么修的', 'my config', 'our repo', 'last week we decided']) {
      expect(hasSelfReference(q)).toBe(true);
    }
  });
  it('generic questions pass', () => {
    expect(hasSelfReference('python reverse a string')).toBe(false);
  });
});

describe('arbitrateRetrieval', () => {
  it('retrieve when entities overlap', () => {
    expect(arbitrateRetrieval('llamacpp oom', { entityOverlap: 0.5, fokZone: 'no-memory' }).action).toBe('retrieve');
  });
  it('retrieve on self-reference regardless of overlap', () => {
    expect(arbitrateRetrieval('我们上次怎么做', { entityOverlap: 0, fokZone: 'no-memory' }).action).toBe('retrieve');
  });
  it('annotate-parametric: zero overlap + no-memory + generic shape', () => {
    const r = arbitrateRetrieval('python reverse string', { entityOverlap: 0, fokZone: 'no-memory' });
    expect(r.action).toBe('annotate-parametric');
    expect(r.note).toBe(ARBITER_PARAMETRIC_NOTE);
  });
  it('annotate-sparse: low overlap + low-confidence', () => {
    const r = arbitrateRetrieval('some vaguely related thing', { entityOverlap: 0.05, fokZone: 'low-confidence' });
    expect(r.action).toBe('annotate-sparse');
    expect(r.note).toBe(ARBITER_SPARSE_NOTE);
  });
  it('retrieve when fok says inject', () => {
    expect(arbitrateRetrieval('whatever', { entityOverlap: 0, fokZone: 'inject' }).action).toBe('retrieve');
  });
  it('v1 never returns skip', () => {
    for (const zone of ['inject', 'low-confidence', 'no-memory'] as const) {
      for (const ov of [0, 0.1, 1]) {
        expect(arbitrateRetrieval('q', { entityOverlap: ov, fokZone: zone }).action).not.toBe('skip');
      }
    }
  });
});
