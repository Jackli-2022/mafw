import {
  createLlmGoalEvalProvider,
  buildGoalEvalPrompt,
} from '../../../src/core/goal/goal-eval-llm-provider';
import type { GoalEval } from '../../../src/core/goal/goal-eval';
import type { CompletionChannel, CompletionRequest } from '../../../src/runtime/contract';

function goalEval(): GoalEval {
  return {
    outcome: 'feature works',
    conditions: [
      { id: 'c1', statement: 'tests pass', required: true, evidence: 'test output', method: 'run tests' },
      { id: 'c2', statement: 'docs updated', required: false, evidence: 'diff', method: 'inspect diff' },
    ],
    failureConditions: [],
    constraints: [],
    nonGoals: [],
    mapping: {},
  };
}

function input() {
  return {
    goalEval: goalEval(),
    plan: { waves: [{ id: 'w1', tasks: [{ title: 'implement' }] }] },
    taskResults: [{ taskId: 't1', result: 'pass' as const, evidence: 'npm test 12/12' }],
    reviewFeedback: 'looks good',
  };
}

describe('LLM GoalEval provider', () => {
  test('requests a structured result and returns provider results', async () => {
    const requests: CompletionRequest[] = [];
    const channel: CompletionChannel = {
      complete: async (request) => {
        requests.push(request);
        return {
          text: '```json\n[{"conditionId":"c1","result":"pass","evidence":"npm test 12/12"},{"conditionId":"c2","result":"skipped","evidence":""}]\n```',
        };
      },
    };
    const provider = createLlmGoalEvalProvider({
      channel: () => channel,
      model: { providerID: 'runtime', modelID: 'reviewer' },
      timeoutMs: 1234,
    });
    expect(provider).not.toBeNull();

    const results = await provider!.evaluate(input());
    expect(results).toEqual([
      { conditionId: 'c1', result: 'pass', evidence: 'npm test 12/12' },
      { conditionId: 'c2', result: 'skipped', evidence: '' },
    ]);
    expect(requests).toHaveLength(1);
    expect(requests[0].model).toEqual({ providerID: 'runtime', modelID: 'reviewer' });
    expect(requests[0].timeoutMs).toBe(1234);
    expect(requests[0].user[0]).toMatchObject({ type: 'text' });
    expect((requests[0].user[0] as any).text).toContain('tests pass');
    expect((requests[0].user[0] as any).text).toContain('npm test 12/12');
  });

  test('invalid JSON rejects so the driver can keep the reviewer rubric', async () => {
    const provider = createLlmGoalEvalProvider({
      channel: () => ({ complete: async () => ({ text: 'not json' }) }),
      model: { providerID: 'runtime', modelID: 'reviewer' },
    });
    await expect(provider!.evaluate(input())).rejects.toThrow(/JSON/);
  });

  test('missing completion channel rejects rather than auto-passing', async () => {
    const provider = createLlmGoalEvalProvider({
      channel: () => undefined,
      model: { providerID: 'runtime', modelID: 'reviewer' },
    });
    await expect(provider!.evaluate(input())).rejects.toThrow(/completion channel/);
  });

  test('prompt includes conditions, task evidence and review feedback', () => {
    const prompt = buildGoalEvalPrompt(input());
    expect(prompt).toContain('c1');
    expect(prompt).toContain('tests pass');
    expect(prompt).toContain('npm test 12/12');
    expect(prompt).toContain('looks good');
  });
});
