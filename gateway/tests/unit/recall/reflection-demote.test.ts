import { demoteSourceEpisodes } from '../../../src/recall/reflection';

function fakeIndex(entries: any[]) {
  const calls: Array<[string, number]> = [];
  return {
    calls,
    index: {
      getIndex: () => ({ entries }),
      updateEnergy: (id: string, delta: number) => calls.push([id, delta]),
      save: () => {},
    },
  };
}

describe('demoteSourceEpisodes (D1b)', () => {
  it('demotes each present episode by factor × energy', () => {
    const { index, calls } = fakeIndex([
      { id: 'e1', energy: 0.8 },
      { id: 'e2', energy: 0.5 },
    ]);
    const n = demoteSourceEpisodes(index, ['e1', 'e2'], 0.3);
    expect(n).toBe(2);
    expect(calls).toEqual([
      ['e1', -(0.8 * 0.3)],
      ['e2', -(0.5 * 0.3)],
    ]);
  });

  it('skips missing ids and returns the demoted count', () => {
    const { index, calls } = fakeIndex([{ id: 'e1', energy: 0.8 }]);
    const n = demoteSourceEpisodes(index, ['e1', 'gone'], 0.3);
    expect(n).toBe(1);
    expect(calls).toEqual([['e1', -0.24]]);
  });
});
