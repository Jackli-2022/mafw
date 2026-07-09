import * as fs from 'fs';
import * as path from 'path';
import os from 'os';
import { HarmonicIndexManager } from '../../src/memory/harmonic-index';
import { HarmonicUnit, generateHarmonicId } from '../../src/memory/harmonic-types';
import { MinHashMerger } from '../../src/memory/minhash-merger';

function makeUnit(overrides: Partial<HarmonicUnit> = {}): HarmonicUnit {
  return {
    id: generateHarmonicId(),
    type: 'semantic',
    primary_abstraction: 'JWT token configuration',
    cue_anchors: ['jwt', 'auth'],
    memory_value: 'Tokens expire in 30 minutes',
    energy: 0.7,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

describe('Harmonic Memory E2E', () => {
  let tmpDir: string;
  let indexManager: HarmonicIndexManager;
  let merger: MinHashMerger;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-e2e-'));
    fs.mkdirSync(path.join(tmpDir, 'memory'), { recursive: true });
    indexManager = new HarmonicIndexManager(tmpDir);
    merger = new MinHashMerger();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // 1. Full flow: write → index → search
  it('full flow: writes unit to tier file, indexes it, and searches successfully', () => {
    const unit = makeUnit({
      primary_abstraction: 'OAuth2 refresh token rotation',
      cue_anchors: ['oauth2', 'refresh', 'rotation'],
    });

    const tier = 'tier3';
    const tierDir = path.join(tmpDir, 'memory', tier);
    fs.mkdirSync(tierDir, { recursive: true });
    fs.writeFileSync(path.join(tierDir, `${unit.id}.json`), JSON.stringify(unit), 'utf-8');

    indexManager.addEntry(unit, tier);

    const results = indexManager.search('OAuth2 refresh');
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe(unit.id);
    expect(results[0].primary_abstraction).toBe('OAuth2 refresh token rotation');
    expect(results[0].tier).toBe('tier3');
  });

  // 2. Search is tier-agnostic
  it('search returns results from all tiers when query matches', () => {
    const u1 = makeUnit({
      id: generateHarmonicId(),
      primary_abstraction: 'API rate limiting strategy',
      cue_anchors: ['api', 'rate', 'limit'],
      type: 'semantic',
    });
    const u2 = makeUnit({
      id: generateHarmonicId(),
      primary_abstraction: 'API gateway circuit breaker',
      cue_anchors: ['api', 'circuit'],
      type: 'procedural',
    });

    indexManager.addEntry(u1, 'tier2');
    indexManager.addEntry(u2, 'tier3');

    const results = indexManager.search('API');
    expect(results).toHaveLength(2);

    const ids = results.map(r => r.id);
    expect(ids).toContain(u1.id);
    expect(ids).toContain(u2.id);

    const tiers = results.map(r => r.tier);
    expect(tiers).toContain('tier2');
    expect(tiers).toContain('tier3');
  });

  // 3. MinHash correctly identifies similar abstractions
  it('MinHash detects similarity for related text and difference for unrelated text', () => {
    const similarA = merger.generateSignature('JWT token auth configuration setup');
    const similarB = merger.generateSignature('JWT token authentication configuration setup for users');

    const differentA = merger.generateSignature('JWT token');
    const differentB = merger.generateSignature('Database connection');

    const similarScore = merger.similarity(similarA, similarB);
    const differentScore = merger.similarity(differentA, differentB);

    expect(similarScore).toBeGreaterThan(0.6);
    expect(differentScore).toBeLessThanOrEqual(0.25);
  });

  // 4. Cross-tier merge produces combined unit
  it('cross-tier merge combines similar units across tiers and removes old entry', async () => {
    const existing = makeUnit({
      id: 'mem_existing_e2e',
      primary_abstraction: 'JWT token authentication configuration setup',
      cue_anchors: ['jwt', 'auth', 'token'],
      memory_value: 'Use RS256 for signing',
      energy: 0.6,
    });

    const incoming = makeUnit({
      id: 'mem_incoming_e2e',
      primary_abstraction: 'JWT token authentication configuration setup for users',
      cue_anchors: ['jwt', 'setup', 'guide'],
      memory_value: 'Rotate keys every 90 days',
      energy: 0.5,
    });

    const tierExisting = 'tier3';
    const tierDir = path.join(tmpDir, 'memory', tierExisting);
    fs.mkdirSync(tierDir, { recursive: true });
    fs.writeFileSync(path.join(tierDir, `${existing.id}.json`), JSON.stringify(existing), 'utf-8');
    indexManager.addEntry(existing, tierExisting);

    const tierIncoming = 'tier2';
    const tierDir2 = path.join(tmpDir, 'memory', tierIncoming);
    fs.mkdirSync(tierDir2, { recursive: true });
    fs.writeFileSync(path.join(tierDir2, `${incoming.id}.json`), JSON.stringify(incoming), 'utf-8');

    const result = await merger.merge(incoming, tierIncoming, indexManager, tmpDir);

    expect(result.merged_from).toBeDefined();
    expect(result.merged_from).toContain('mem_existing_e2e');
    expect(result.energy).toBe(0.65);

    const idx = indexManager.getIndex();
    const removed = idx.entries.find(e => e.id === 'mem_existing_e2e');
    expect(removed).toBeUndefined();
  });

  // 5. search returns empty for unmatched queries
  it('search returns empty array when no entries match the query', () => {
    const unit = makeUnit({
      primary_abstraction: 'Redis cache eviction policy',
      cue_anchors: ['redis', 'cache'],
    });

    indexManager.addEntry(unit, 'tier3');

    const results = indexManager.search('PostgreSQL connection pool');
    expect(results).toEqual([]);
  });
});
