import { capCommitment, COMMITMENT_CAP, selectGraduations } from '../../../src/recall/commitment';

const T0 = Date.parse('2026-10-12T00:00:00.000Z');
const H = 3600 * 1000;
function mkGradEntry(id: string, cappedAtAgoH: number | null, energy = 0.6, extra: any = {}) {
  return { id, type: 'semantic', energy, cue_anchors: [],
    commitment_capped_at: cappedAtAgoH === null ? undefined : new Date(T0 - cappedAtAgoH * H).toISOString(),
    created_at: new Date(T0 - (cappedAtAgoH ?? 0) * H).toISOString(), ...extra } as any;
}

describe('⑦ graduation (decay pass)', () => {
  it('capped > 48h ago → graduates', () => {
    expect(selectGraduations([mkGradEntry('a', 49)], T0)).toEqual(['a']);
  });
  it('capped < 48h → stays', () => {
    expect(selectGraduations([mkGradEntry('b', 47)], T0)).toEqual([]);
  });
  it('no cap stamp → never (naturally-low energy is not inflated)', () => {
    expect(selectGraduations([mkGradEntry('c', null)], T0)).toEqual([]);
  });
  it('already-graduated (energy > cap+0.02) → never', () => {
    expect(selectGraduations([mkGradEntry('d', 100, 0.8)], T0)).toEqual([]);
  });
  it('superseded / rejected anchor / episodic → never', () => {
    expect(selectGraduations([mkGradEntry('e', 100, 0.6, { superseded_by: 'z' })], T0)).toEqual([]);
    expect(selectGraduations([mkGradEntry('f', 100, 0.6, { cue_anchors: ['rejected'] })], T0)).toEqual([]);
    expect(selectGraduations([mkGradEntry('g', 100, 0.6, { type: 'episodic' })], T0)).toEqual([]);
  });
});

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
