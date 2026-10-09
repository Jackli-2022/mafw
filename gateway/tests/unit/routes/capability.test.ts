import { handleCapabilities } from '../../../src/routes/capability';

describe('handleCapabilities', () => {
  it('combines ledger from outcomes with taxonomy from index', async () => {
    const r = await handleCapabilities({
      listOutcomes: () => [{ goal_id: 'g1', verdict: 'PASS', rounds: 1 }],
      getIndex: () => ({ entries: [{ id: 'm1', energy: 0.9, primary_abstraction: '坑', cue_anchors: ['cat:failure'] }] }),
      limit: 200,
    });
    expect(r.ledger.total).toBe(1);
    expect(r.ledger.passRate).toBe(1);
    expect(r.failureTaxonomy[0].pattern).toBe('坑');
  });

  it('empty inputs → zeroed ledger, empty taxonomy', async () => {
    const r = await handleCapabilities({
      listOutcomes: () => [],
      getIndex: () => ({ entries: [] }),
    });
    expect(r.ledger.total).toBe(0);
    expect(r.failureTaxonomy).toEqual([]);
  });
});
