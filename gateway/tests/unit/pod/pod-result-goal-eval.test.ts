import { buildPodGoalResult, goalEvalPathFor } from '../../../src/core/pod/pod-result';
import type { GoalStateV3 } from '../../../src/core/goal/state-v3';
import * as path from 'path';

function state(patch: Partial<GoalStateV3> = {}): GoalStateV3 {
  return {
    version: '3', goalId: 'g1', revision: 2, projectDir: 'C:/p', mafwDir: 'C:/p/.mafw',
    phase: 'COMPLETED', round: 1, loop: 1, maxRounds: 3,
    reviewVerdict: 'PASS', reviewReportPath: 'C:/p/.mafw/reviews/g1-loop2.md',
    reviewFeedback: '', wavePlanPath: 'C:/p/.mafw/waves.json',
    receiptPath: 'C:/p/.mafw/receipts/g1/loop-2-receipt.json',
    lastError: null, nodeSession: null, pendingQuestion: null, userResponse: null,
    sameSigCount: 0, stateVersion: 2, nextNode: 'archive', nextAction: 'COMPLETED',
    artifacts: {}, currentWave: 0, totalWaves: 1, sessions: {}, updatedAt: 't',
    ...patch,
  };
}

const WAVES = JSON.stringify({ waves: [{ id: 'w1', tasks: ['a'] }] });

const EVAL = {
  outcome: 'Ship the collaborative loop',
  conditions: [
    { id: 'c1', statement: 'Stage projection is truthful', required: true, evidence: 'projection tests', method: 'unit test' },
    { id: 'c2', statement: 'Docs updated', required: false, evidence: 'docs diff', method: 'read the diff' },
    { id: 'c3', statement: 'No regressions', required: true, evidence: 'full suite output', method: 'npm test' },
  ],
  failureConditions: ['unit tests fail'],
  constraints: ['no new runtime deps'],
  nonGoals: [],
  mapping: { c1: { tasks: ['w1-t1'] } },
};

const EVAL_PATH = goalEvalPathFor('C:/p/.mafw', 'g1');

function review(payload: unknown): string {
  return `# review\n\n\`\`\`mafw-review\n${JSON.stringify(payload)}\n\`\`\`\n`;
}

function texts(patch: Record<string, string> = {}): Record<string, string> {
  return {
    'C:/p/.mafw/waves.json': WAVES,
    'C:/p/.mafw/receipts/g1/loop-2-receipt.json': JSON.stringify({ goalId: 'g1', receipts: [] }),
    ...patch,
  };
}

describe('buildPodGoalResult — Goal eval results', () => {
  test('carries the revision, Goal conditions and per-condition evidence', () => {
    const result = buildPodGoalResult({
      goalId: 'g1',
      state: state(),
      request: { title: 'Fix Pod', acceptance: ['Pod reports truthful status'] },
      readText: (path) => texts({
        [EVAL_PATH]: JSON.stringify(EVAL),
        'C:/p/.mafw/reviews/g1-loop2.md': review({
          verdict: 'PASS',
          tasks: [{ taskId: 'w1-t1', result: 'pass', evidence: 'npm test passed' }],
          goalResults: [
            { conditionId: 'c1', result: 'pass', evidence: 'projection tests pass' },
            { conditionId: 'c3', result: 'pass', evidence: 'full suite 4039 passed' },
          ],
          feedback: '',
        }),
      })[path] ?? null,
    });

    expect(result).toMatchObject({
      revision: 2,
      verdict: 'PASS',
      goalEvalValid: true,
      failure: null,
      goalAcceptance: ['Pod reports truthful status'],
      goalResults: [
        { conditionId: 'c1', result: 'pass', evidence: 'projection tests pass' },
        { conditionId: 'c3', result: 'pass', evidence: 'full suite 4039 passed' },
      ],
      tasks: [{ taskId: 'w1-t1', result: 'pass', evidence: 'npm test passed' }],
    });
    expect(result.goalConditions.map((condition) => condition.id)).toEqual(['c1', 'c2', 'c3']);
    expect(result.resultReady).toBe(true);
  });

  test('a PASS that misses a required Goal condition is a normal FAIL with the gap named', () => {
    const result = buildPodGoalResult({
      goalId: 'g1',
      state: state(),
      request: null,
      readText: (path) => texts({
        [EVAL_PATH]: JSON.stringify(EVAL),
        'C:/p/.mafw/reviews/g1-loop2.md': review({
          verdict: 'PASS',
          tasks: [{ taskId: 'w1-t1', result: 'pass', evidence: 'npm test passed' }],
          goalResults: [{ conditionId: 'c1', result: 'pass', evidence: 'projection tests pass' }],
          feedback: '',
        }),
      })[path] ?? null,
    });

    expect(result.verdict).toBe('FAIL');
    // omission-only 是评审判定（驱动侧同轮复核修复），不是坏产物。
    expect(result.failure).toBeNull();
    // 已有的逐条件证据可信（只是不完整）——保留而不是清空。
    expect(result.goalResults).toEqual([
      { conditionId: 'c1', result: 'pass', evidence: 'projection tests pass' },
    ]);
    expect(result.reviewFeedback).toContain('c3');
    expect(result.resultReady).toBe(true);
  });

  test('a failing required condition inside a PASS verdict is downgraded to FAIL, not softened', () => {
    const result = buildPodGoalResult({
      goalId: 'g1',
      state: state(),
      request: null,
      readText: (path) => texts({
        [EVAL_PATH]: JSON.stringify(EVAL),
        'C:/p/.mafw/reviews/g1-loop2.md': review({
          verdict: 'PASS',
          tasks: [{ taskId: 'w1-t1', result: 'pass', evidence: 'npm test passed' }],
          goalResults: [
            { conditionId: 'c1', result: 'pass', evidence: 'projection tests pass' },
            { conditionId: 'c3', result: 'fail', evidence: 'suite has 2 failures' },
          ],
          feedback: '',
        }),
      })[path] ?? null,
    });

    expect(result.verdict).toBe('FAIL');
    expect(result.failure).toBeNull();
    expect(result.goalResults).toHaveLength(2);
    expect(result.resultReady).toBe(true);
  });

  test('a Goal condition without evidence never becomes a pass', () => {
    const result = buildPodGoalResult({
      goalId: 'g1',
      state: state(),
      request: null,
      readText: (path) => texts({
        [EVAL_PATH]: JSON.stringify(EVAL),
        'C:/p/.mafw/reviews/g1-loop2.md': review({
          verdict: 'PASS',
          tasks: [{ taskId: 'w1-t1', result: 'pass', evidence: 'npm test passed' }],
          goalResults: [
            { conditionId: 'c1', result: 'pass', evidence: '' },
            { conditionId: 'c3', result: 'pass', evidence: 'suite passed' },
          ],
          feedback: '',
        }),
      })[path] ?? null,
    });

    expect(result.verdict).toBe('FAIL');
    expect(result.failure).toBeNull();
    expect(result.goalResults?.[0]).toMatchObject({ conditionId: 'c1', result: 'fail' });
    expect(result.resultReady).toBe(true);
  });

  test('a malformed Goal eval is fail-closed: no conditions, no invented PASS', () => {
    const result = buildPodGoalResult({
      goalId: 'g1',
      state: state(),
      request: null,
      readText: (path) => texts({
        [EVAL_PATH]: '{broken',
        'C:/p/.mafw/reviews/g1-loop2.md': review({
          verdict: 'PASS',
          tasks: [{ taskId: 'w1-t1', result: 'pass', evidence: 'npm test passed' }],
          feedback: '',
        }),
      })[path] ?? null,
    });

    expect(result.verdict).toBe('FAIL');
    expect(result.failure).toBe('goal_eval_invalid');
    expect(result.goalEvalValid).toBe(false);
    expect(result.goalConditions).toEqual([]);
    expect(result.goalResults).toEqual([]);
  });

  test('legacy goals without a Goal eval keep their review verdict', () => {
    const result = buildPodGoalResult({
      goalId: 'g1',
      state: state(),
      request: null,
      readText: (path) => texts({
        'C:/p/.mafw/reviews/g1-loop2.md': review({
          verdict: 'PASS',
          tasks: [{ taskId: 'w1-t1', result: 'pass', evidence: 'npm test passed' }],
          feedback: '',
        }),
      })[path] ?? null,
    });

    expect(result).toMatchObject({
      revision: 2,
      verdict: 'PASS',
      goalEvalValid: false,
      goalConditions: [],
      goalResults: [],
      failure: null,
      resultReady: true,
    });
  });

  test('a persisted PASS without a readable review is not a verified result', () => {
    const result = buildPodGoalResult({
      goalId: 'g1',
      state: state({ receiptPath: null, reviewReportPath: 'C:/p/.mafw/reviews/missing.md' }),
      request: null,
      readText: () => null,
    });

    expect(result.verdict).toBe('PASS');
    expect(result.resultReady).toBe(false);
    expect(result.failure).toBe('review_missing');
  });

  test('readable artifacts cannot make an unverified PASS resultReady', () => {
    const result = buildPodGoalResult({
      goalId: 'g1',
      state: state({
        receiptPath: null,
        reviewReportPath: 'C:/p/.mafw/reviews/missing.md',
        artifacts: { plan: 'C:/p/.mafw/goals/g1/waves.json' },
      }),
      request: null,
      readText: () => null,
    });

    expect(result.verdict).toBe('PASS');
    expect(result.failure).toBe('review_missing');
    expect(result.resultReady).toBe(false);
    expect(result.artifacts).toEqual(['C:/p/.mafw/goals/g1/waves.json']);
  });

  test('the Goal Eval path never escapes the goals directory', () => {
    for (const goalId of ['..', '.', '...', '../etc', 'a/b']) {
      const target = goalEvalPathFor('C:/p/.mafw', goalId);
      const segments = target.split(/[\\/]/);
      expect(segments).not.toContain('..');
      expect(segments).not.toContain('.');
      expect(target.startsWith(path.join('C:/p/.mafw', 'goals'))).toBe(true);
    }
    expect(goalEvalPathFor('C:/p/.mafw', 'g1')).toBe(
      path.join('C:/p/.mafw', 'goals', 'g1', 'goal-eval.json'),
    );
  });

  test('legacy state without a revision reads as revision 1 and an explicit revision wins', () => {
    const legacy = state({ revision: undefined });
    expect(buildPodGoalResult({
      goalId: 'g1', state: legacy, request: null, readText: () => null,
    }).revision).toBe(1);
    expect(buildPodGoalResult({
      goalId: 'g1', state: legacy, request: null, revision: 4, readText: () => null,
    }).revision).toBe(4);
  });

  test('an already parsed Goal eval is accepted without re-reading the file', () => {
    const result = buildPodGoalResult({
      goalId: 'g1',
      state: state(),
      request: null,
      goalEval: EVAL,
      readText: (path) => texts({
        'C:/p/.mafw/reviews/g1-loop2.md': review({
          verdict: 'PASS',
          tasks: [{ taskId: 'w1-t1', result: 'pass', evidence: 'npm test passed' }],
          goalResults: [
            { conditionId: 'c1', result: 'pass', evidence: 'projection tests pass' },
            { conditionId: 'c3', result: 'pass', evidence: 'full suite passed' },
          ],
          feedback: '',
        }),
      })[path] ?? null,
    });

    expect(result).toMatchObject({ verdict: 'PASS', goalEvalValid: true, failure: null });
    expect(result.goalConditions).toHaveLength(3);
  });
});
