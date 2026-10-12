import { capCommitment, COMMITMENT_CAP } from '../../../src/recall/commitment';

const now = '2026-10-12T00:00:00.000Z';
function mkUnit(energy: number) {
  return { id: 'u', type: 'semantic' as const, primary_abstraction: 'a', cue_anchors: ['k'],
    memory_value: 'v', energy, created_at: now, updated_at: now };
}

describe('⑦ commitment gradient — write-side cap', () => {
  it('pipeline semantic/procedural first-pass capped to 0.6 + stamped', () => {
    const out = capCommitment(mkUnit(0.9), { isPipeline: true, now });
    expect(out.energy).toBe(COMMITMENT_CAP);
    expect((out as any).commitment_capped_at).toBe(now);
  });

  it('low computed energy is NOT raised (cap is min, not set) but still stamped', () => {
    const out = capCommitment(mkUnit(0.3), { isPipeline: true, now });
    expect(out.energy).toBe(0.3);
    expect((out as any).commitment_capped_at).toBe(now);
  });

  it('episodic / user writes / disabled → untouched', () => {
    const ep = { ...mkUnit(0.9), type: 'episodic' as const };
    expect(capCommitment(ep, { isPipeline: true, now }).energy).toBe(0.9);
    expect((capCommitment(ep, { isPipeline: true, now }) as any).commitment_capped_at).toBeUndefined();
    expect(capCommitment(mkUnit(0.9), { isPipeline: false, now }).energy).toBe(0.9);
    expect(capCommitment(mkUnit(0.9), { isPipeline: true, enabled: false, now }).energy).toBe(0.9);
  });
});
