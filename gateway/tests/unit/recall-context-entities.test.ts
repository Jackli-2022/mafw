/**
 * Unit tests for recall-context.ts entity extraction and query expansion.
 * Tests the extractQueryEntities function for cross-session topic linking.
 */

// We test the exported function indirectly by importing the module and using
// a minimal mock of the index. The actual function is not exported, so we
// test the behavior through the public API.

import { searchRecallMemories } from '../../src/recall/recall-context';

// Minimal mock of HarmonicIndexManager
function createMockIndex(entries: any[]) {
  return {
    search: (query: string, topK: number, options?: any) => {
      // Simple BM25-like matching: check if query words appear in primary_abstraction or cue_anchors
      const queryWords = query.toLowerCase().split(/\s+/);
      return entries
        .filter((e) => {
          const text = `${e.primary_abstraction} ${(e.cue_anchors || []).join(' ')}`.toLowerCase();
          return queryWords.some((w) => w.length >= 2 && text.includes(w));
        })
        .slice(0, topK)
        .map((e) => ({
          ...e,
          energy: e.energy || 0.5,
        }));
    },
    getIndex: () => ({ entries }),
  } as any;
}

describe('recall-context entity extraction', () => {
  it('should include entity-related memories in results', async () => {
    const entries = [
      {
        id: 'mem-001',
        primary_abstraction: 'React component library setup',
        cue_anchors: ['react', 'component', 'library', 'frontend'],
        energy: 0.8,
        type: 'semantic',
        created_at: '2024-01-15T10:00:00Z',
      },
      {
        id: 'mem-002',
        primary_abstraction: 'Auth module implementation',
        cue_anchors: ['auth', 'module', 'login', 'user'],
        energy: 0.7,
        type: 'semantic',
        created_at: '2024-01-16T10:00:00Z',
      },
      {
        id: 'mem-003',
        primary_abstraction: 'Database schema design',
        cue_anchors: ['database', 'schema', 'table', 'sql'],
        energy: 0.6,
        type: 'semantic',
        created_at: '2024-01-17T10:00:00Z',
      },
    ];

    const index = createMockIndex(entries);
    const pushed = new Set<string>();

    // Search for "React" should return mem-001
    const results = await searchRecallMemories(index, 'React', pushed, 5, {});
    expect(results.length).toBeGreaterThan(0);
    expect(results.some((r) => r.id === 'mem-001')).toBe(true);
  });

  it('should expand query to find related entity memories', async () => {
    const entries = [
      {
        id: 'mem-001',
        primary_abstraction: 'User authentication with JWT tokens',
        cue_anchors: ['auth', 'jwt', 'token', 'user', 'login'],
        energy: 0.8,
        type: 'semantic',
        created_at: '2024-01-15T10:00:00Z',
      },
      {
        id: 'mem-002',
        primary_abstraction: 'Auth module permissions',
        cue_anchors: ['auth', 'permissions', 'access', 'role'],
        energy: 0.7,
        type: 'semantic',
        created_at: '2024-01-16T10:00:00Z',
      },
      {
        id: 'mem-003',
        primary_abstraction: 'React component library',
        cue_anchors: ['react', 'component', 'library'],
        energy: 0.6,
        type: 'semantic',
        created_at: '2024-01-17T10:00:00Z',
      },
    ];

    const index = createMockIndex(entries);
    const pushed = new Set<string>();

    // Search for "authentication" should find auth-related memories
    const results = await searchRecallMemories(index, 'authentication system', pushed, 5, {});
    expect(results.length).toBeGreaterThan(0);
    // Should find auth-related memories
    expect(results.some((r) => r.id === 'mem-001' || r.id === 'mem-002')).toBe(true);
  });

  it('should respect pushed set filter', async () => {
    const entries = [
      {
        id: 'mem-001',
        primary_abstraction: 'React component library',
        cue_anchors: ['react', 'component'],
        energy: 0.8,
        type: 'semantic',
        created_at: '2024-01-15T10:00:00Z',
      },
    ];

    const index = createMockIndex(entries);
    const pushed = new Set<string>(['mem-001']);

    const results = await searchRecallMemories(index, 'React', pushed, 5, {});
    expect(results.length).toBe(0);
  });

  it('should filter out superseded entries', async () => {
    const entries = [
      {
        id: 'mem-001',
        primary_abstraction: 'React component library',
        cue_anchors: ['react', 'component'],
        energy: 0.8,
        type: 'semantic',
        created_at: '2024-01-15T10:00:00Z',
        superseded_by: 'mem-002',
      },
    ];

    const index = createMockIndex(entries);
    const pushed = new Set<string>();

    const results = await searchRecallMemories(index, 'React', pushed, 5, {});
    expect(results.length).toBe(0);
  });
});
