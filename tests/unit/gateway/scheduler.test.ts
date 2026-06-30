import { phaseToCreateAction } from '../../../gateway/src/index';

test('phaseToCreateAction maps completion phases back to session creation actions', () => {
  expect(phaseToCreateAction('PLANNING')).toBe('CREATE_PLAN_SESSION');
  expect(phaseToCreateAction('PLANNING_COMPLETE')).toBe('CREATE_PLAN_SESSION');
  expect(phaseToCreateAction('EXECUTING')).toBe('CREATE_EXECUTE_SESSION');
  expect(phaseToCreateAction('EXECUTING_COMPLETE')).toBe('CREATE_EXECUTE_SESSION');
  expect(phaseToCreateAction('REVIEWING')).toBe('CREATE_REVIEW_SESSION');
  expect(phaseToCreateAction('REVIEWING_COMPLETE')).toBe('CREATE_REVIEW_SESSION');
});

test('phaseToCreateAction falls back for unknown or null phases', () => {
  expect(phaseToCreateAction('UNKNOWN')).toBe('CREATE_UNKNOWN_SESSION');
  expect(phaseToCreateAction(null)).toBe('CREATE_UNKNOWN_SESSION');
});
