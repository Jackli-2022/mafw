/**
 * Unit tests for inject-format.ts multi-session rendering.
 * Tests the enhanced pointer rendering for cross-session queries.
 */

import { formatRecallContext } from '../../src/recall/inject-format';

describe('formatRecallContext multi-session', () => {
  it('should return null for empty memories', () => {
    const result = formatRecallContext([]);
    expect(result.pointers).toBeNull();
  });

  it('should render flat list for single-type memories', () => {
    const memories = [
      {
        id: 'mem-001',
        primary_abstraction: 'React component library',
        cue_anchors: ['react', 'component'],
        energy: 0.8,
        type: 'semantic',
        created_at: '2024-01-15T10:00:00Z',
      },
      {
        id: 'mem-002',
        primary_abstraction: 'Auth module implementation',
        cue_anchors: ['auth', 'module'],
        energy: 0.7,
        type: 'semantic',
        created_at: '2024-01-16T10:00:00Z',
      },
    ];

    const result = formatRecallContext(memories);
    expect(result.pointers).toContain('<recall>');
    expect(result.pointers).toContain('</recall>');
    // IDs are truncated to 6 chars in pointerLine
    expect(result.pointers).toContain('mem-00');
    // Should NOT contain type headers for single-type
    expect(result.pointers).not.toContain('[semantic]');
  });

  it('should group by type for multi-type memories', () => {
    const memories = [
      {
        id: 'mem-001',
        primary_abstraction: 'React component library',
        cue_anchors: ['react', 'component'],
        energy: 0.8,
        type: 'semantic',
        created_at: '2024-01-15T10:00:00Z',
      },
      {
        id: 'mem-002',
        primary_abstraction: 'Auth module implementation',
        cue_anchors: ['auth', 'module'],
        energy: 0.7,
        type: 'procedural',
        created_at: '2024-01-16T10:00:00Z',
      },
      {
        id: 'mem-003',
        primary_abstraction: 'User login session',
        cue_anchors: ['login', 'session'],
        energy: 0.6,
        type: 'episodic',
        created_at: '2024-01-17T10:00:00Z',
      },
    ];

    const result = formatRecallContext(memories);
    expect(result.pointers).toContain('<recall>');
    expect(result.pointers).toContain('</recall>');
    // Multi-type: should contain type group headers
    expect(result.pointers).toContain('[semantic]');
    expect(result.pointers).toContain('[procedural]');
    expect(result.pointers).toContain('[episodic]');
  });

  it('should limit total pointers to 5 lines', () => {
    const memories = Array.from({ length: 10 }, (_, i) => ({
      id: `mem-${String(i).padStart(3, '0')}`,
      primary_abstraction: `Memory ${i}`,
      cue_anchors: [`keyword${i}`],
      energy: 0.5,
      type: i % 2 === 0 ? 'semantic' : 'procedural',
      created_at: `2024-01-${String(i + 1).padStart(2, '0')}T10:00:00Z`,
    }));

    const result = formatRecallContext(memories);
    const lines = result.pointers!.split('\n').filter((l) => l.startsWith('-') || l.startsWith('  -'));
    expect(lines.length).toBeLessThanOrEqual(5);
  });
});
