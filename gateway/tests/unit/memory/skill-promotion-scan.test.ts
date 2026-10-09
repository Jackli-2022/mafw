import { scanPromotionCandidates } from '../../../src/memory/skill-promotion';

describe('scanPromotionCandidates', () => {
  it('eligible procedural -> staging write + triage draft; already-materialized skipped', async () => {
    const staged: any[] = [];
    const triaged: any[] = [];
    const n = await scanPromotionCandidates({
      getIndex: () => ({
        entries: [
          { id: 'mem_1_abcdef', type: 'procedural', energy: 0.8, updated_at: '2026-09-20T00:00:00Z', cue_anchors: [] },
          { id: 'mem_2_ghijkl', type: 'procedural', energy: 0.8, updated_at: '2026-09-20T00:00:00Z', cue_anchors: ['skill:ms-foobar'] },
          { id: 'mem_3_mnopqr', type: 'semantic', energy: 0.9, updated_at: '2026-09-20T00:00:00Z', cue_anchors: [] },
        ],
      }),
      readUnit: async (id) =>
        id === 'mem_1_abcdef'
          ? { id, memory_value: '1. a\n2. b', cue_anchors: ['verified:2026-10-01', 'serve'] }
          : null,
      needFor: () => 5,
      existingSkillCount: () => 2,
      writeStaging: (name, content) => staged.push({ name, content }),
      createTriageItem: (item) => triaged.push(item),
      now: new Date('2026-10-08T00:00:00Z'),
    });
    expect(n).toBe(1);
    expect(staged[0].name).toBe('ms-abcdef');
    expect(staged[0].content).toContain('name: ms-abcdef');
    expect(triaged[0].summary.skillDraft).toEqual({ name: 'ms-abcdef', memoryId: 'mem_1_abcdef' });
  });

  it('ineligible (no verified anchor) → nothing staged', async () => {
    const staged: any[] = [];
    const n = await scanPromotionCandidates({
      getIndex: () => ({ entries: [{ id: 'mem_1_abcdef', type: 'procedural', energy: 0.8, updated_at: '2026-09-20T00:00:00Z', cue_anchors: [] }] }),
      readUnit: async (id) => ({ id, memory_value: '1. a\n2. b', cue_anchors: ['serve'] }),
      needFor: () => 5,
      existingSkillCount: () => 2,
      writeStaging: (name, content) => staged.push({ name, content }),
      createTriageItem: () => {},
      now: new Date('2026-10-08T00:00:00Z'),
    });
    expect(n).toBe(0);
    expect(staged).toHaveLength(0);
  });

  it('readUnit failure is fail-open (skips the candidate)', async () => {
    const n = await scanPromotionCandidates({
      getIndex: () => ({ entries: [{ id: 'mem_1_abcdef', type: 'procedural', energy: 0.8, updated_at: '2026-09-20T00:00:00Z', cue_anchors: [] }] }),
      readUnit: async () => { throw new Error('io'); },
      needFor: () => 5,
      existingSkillCount: () => 0,
      writeStaging: () => {},
      createTriageItem: () => {},
      now: new Date('2026-10-08T00:00:00Z'),
    });
    expect(n).toBe(0);
  });
});
