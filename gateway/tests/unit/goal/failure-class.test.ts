import { classifyNodeFailure } from '../../../src/core/goal/failure-class';

describe('classifyNodeFailure', () => {
  test('network/provider errors retry', () => {
    for (const code of ['429', '502', 'ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'rate_limit']) {
      expect(classifyNodeFailure({ code, node: 'execute', source: 'runtime' })).toBe('retryable_environment');
    }
  });

  test('artifact and unknown runtime errors terminate', () => {
    expect(classifyNodeFailure({ code: 'artifact_invalid', node: 'review', source: 'artifact' })).toBe('terminal_contract');
    expect(classifyNodeFailure({ code: 'artifact_missing', node: 'plan', source: 'artifact' })).toBe('terminal_contract');
    expect(classifyNodeFailure({ code: 'weird_runtime_code', node: 'execute', source: 'runtime' })).toBe('terminal_session');
    expect(classifyNodeFailure({ code: 'TypeError', node: 'execute', source: 'runtime' })).toBe('terminal_session');
  });
});
