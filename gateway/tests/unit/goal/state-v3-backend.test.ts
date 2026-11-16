import { loadGoalState, setGoalStateBackend, writeGoalState, type GoalStateV3 } from '../../../src/core/goal/state-v3';

test('routes reads and writes through the registered backend', () => {
  const saved: GoalStateV3[] = [];
  const state = { goalId: 'g1', revision: 1, phase: 'PLANNING', stateVersion: 0 } as GoalStateV3;
  setGoalStateBackend({
    load: () => state,
    save: (_dir, _id, next) => { saved.push(next); },
    archiveRevision: () => {},
    list: () => [state],
  });
  try {
    expect(loadGoalState('/x', 'g1')?.goalId).toBe('g1');
    writeGoalState('/x', 'g1', { phase: 'EXECUTING' });
    expect(saved[0].phase).toBe('EXECUTING');
    expect(saved[0].stateVersion).toBe(0);
  } finally {
    setGoalStateBackend(null);
  }
});

test('without a backend the file store is the truth', () => {
  expect(loadGoalState('/definitely/missing', 'g1')).toBeNull();
});
