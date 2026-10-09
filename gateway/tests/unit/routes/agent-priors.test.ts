import { handleAgentPriors } from '../../../src/routes/agent-priors';

const idx = (entries: any[]) => ({ entries });

describe('handleAgentPriors', () => {
  it('combines L5 axioms with cat:failure/correction patterns, sorted by energy×(1+need)', async () => {
    const r = await handleAgentPriors({
      l5: { getTop: () => ({ axioms: [{ content: '公理A', energy: 0.9 }], heuristics: [] }) },
      getIndex: () => idx([
        { id: 'm1', energy: 0.5, salience: 1, cue_anchors: ['cat:failure'], primary_abstraction: '失败P1' },
        { id: 'm2', energy: 0.8, salience: 1, cue_anchors: ['cat:failure'], primary_abstraction: '失败P2' },
        { id: 'm3', energy: 0.9, salience: 1, cue_anchors: ['cat:insight'], primary_abstraction: '不收' },
        { id: 'm4', energy: 0.9, salience: 1, cue_anchors: ['cat:failure'], primary_abstraction: '已取代', superseded_by: 'm2' },
      ]),
      needFor: () => 0,
    });
    expect(r.block).toContain('公理A');
    expect(r.block).toContain('失败P2');
    expect(r.block).not.toContain('不收');
    expect(r.block).not.toContain('已取代');
    expect(r.block!.indexOf('失败P2')).toBeLessThan(r.block!.indexOf('失败P1'));
  });

  it('need signal re-ranks patterns', async () => {
    const r = await handleAgentPriors({
      l5: { getTop: () => ({ axioms: [], heuristics: [] }) },
      getIndex: () => idx([
        { id: 'low', energy: 0.5, salience: 1, cue_anchors: ['cat:failure'], primary_abstraction: '低能高需' },
        { id: 'high', energy: 0.45, salience: 1, cue_anchors: ['cat:failure'], primary_abstraction: '高能低需' },
      ]),
      needFor: (id) => (id === 'low' ? 10 : 0),
    });
    expect(r.block!.indexOf('低能高需')).toBeLessThan(r.block!.indexOf('高能低需'));
  });

  it('empty everything → null block', async () => {
    const r = await handleAgentPriors({
      l5: { getTop: () => ({ axioms: [], heuristics: [] }) },
      getIndex: () => idx([]),
    });
    expect(r.block).toBeNull();
  });
});
