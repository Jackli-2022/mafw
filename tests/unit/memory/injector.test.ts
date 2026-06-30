import { DeltaInjector } from '../../../src/memory/injector';
import { ConstraintDelta, PromptDelta } from '../../../src/types/parametric';

function makeConstraint(id: string, priority: number, energy: number, rule: string): ConstraintDelta {
  return {
    id,
    type: 'constraint',
    scope: ['execute'],
    enforcement: 'hard',
    trigger_condition: {},
    rule,
    origin: { goal: 'g', loop: 1, task: 't' },
    created_at: '2024-01-01T00:00:00Z',
    energy_score: energy,
    verified: false,
    priority
  };
}

test('inject sorts by priority then energy', () => {
  const injector = new DeltaInjector();
  const deltas = [
    makeConstraint('low-p', 1, 0.9, 'low priority'),
    makeConstraint('high-p', 9, 0.5, 'high priority')
  ];
  const result = injector.inject(deltas);
  expect(result.injected[0].id).toBe('high-p');
});

test('inject truncates at 5 deltas', () => {
  const injector = new DeltaInjector();
  const deltas = Array.from({ length: 10 }, (_, i) => makeConstraint(`c${i}`, 5, 0.5, 'rule'));
  const result = injector.inject(deltas);
  expect(result.injected.length).toBeLessThanOrEqual(5);
  expect(result.truncated).toBe(true);
});

test('checkPollution detects leaked markers', () => {
  const injector = new DeltaInjector();
  const out = injector.checkPollution('Output [C-1] leaked');
  expect(out.clean).toBe(false);
  expect(out.violations).toContain('[C-1]');
});
