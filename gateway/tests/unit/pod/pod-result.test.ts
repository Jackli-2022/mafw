import { buildPodGoalResult } from '../../../src/core/pod/pod-result';
import type { GoalStateV3 } from '../../../src/core/goal/state-v3';

function state(patch: Partial<GoalStateV3> = {}): GoalStateV3 {
  return {
    version: '3', goalId: 'g1', projectDir: 'C:/p', mafwDir: 'C:/p/.mafw',
    phase: 'FAILED', round: 2, loop: 2, maxRounds: 3,
    reviewVerdict: 'FAIL', reviewReportPath: 'C:/p/.mafw/reviews/g1-loop2.md',
    reviewFeedback: 'tests fail', wavePlanPath: 'C:/p/.mafw/waves.json',
    receiptPath: 'C:/p/.mafw/receipts/g1/loop-2-receipt.json',
    lastError: null, nodeSession: null, pendingQuestion: null, userResponse: null,
    sameSigCount: 0, stateVersion: 2, nextNode: 'archive_fail', nextAction: 'FAILED',
    artifacts: {}, currentWave: 0, totalWaves: 1, sessions: {}, updatedAt: 't',
    ...patch,
  };
}

const request = {
  title: 'Fix Pod',
  acceptance: ['Pod reports truthful status'],
};

describe('buildPodGoalResult', () => {
  test('parses rubric evidence and keeps original goal acceptance', () => {
    const texts: Record<string, string> = {
      'C:/p/.mafw/waves.json': JSON.stringify({ waves: [{ id: 'w1', tasks: ['a'] }] }),
      'C:/p/.mafw/reviews/g1-loop2.md': '# r\n\n```mafw-review\n{"verdict":"FAIL","tasks":[{"taskId":"w1-t1","result":"fail","evidence":"npm test failed"}],"feedback":"fix it"}\n```\n',
      'C:/p/.mafw/receipts/g1/loop-2-receipt.json': JSON.stringify({ goalId: 'g1', receipts: [{ taskId: 'w1-t1', status: 'failed', files: ['a.ts'] }] }),
    };
    const result = buildPodGoalResult({
      goalId: 'g1', state: state(), request,
      readText: (p) => texts[p] ?? null,
    });
    expect(result).toMatchObject({
      verdict: 'FAIL', resultReady: true,
      goalAcceptance: ['Pod reports truthful status'],
      tasks: [{ taskId: 'w1-t1', result: 'fail', evidence: 'npm test failed' }],
      reviewFeedback: 'fix it',
      artifacts: ['a.ts'],
    });
  });

  test('malformed review report yields FAIL and no fabricated evidence', () => {
    const result = buildPodGoalResult({
      goalId: 'g1',
      state: state(),
      request,
      readText: (p) => p.endsWith('waves.json')
        ? JSON.stringify({ waves: [{ id: 'w1', tasks: ['a'] }] })
        : '{broken',
    });
    expect(result.verdict).toBe('FAIL');
    expect(result.tasks).toEqual([]);
    // 不可解析的 review 不是「结果就绪」：failure 存在时 resultReady 必须为 false。
    expect(result.resultReady).toBe(false);
  });

  test('a quick completion is readable without inventing a verdict or reviewer', () => {
    const result = buildPodGoalResult({
      goalId: 'g1',
      state: state({
        reviewVerdict: null,
        reviewReportPath: null,
        reviewFeedback: '',
        receiptPath: 'C:/p/.mafw/receipts/g1/loop-1-receipt.json',
        nextNode: 'archive_unreviewed',
        nextAction: 'COMPLETED',
        assessment: 'unreviewed',
      }),
      request,
      readText: (p) => {
        if (p.endsWith('waves.json')) {
          return JSON.stringify({ waves: [{ id: 'w1', tasks: [{ taskId: 'w1-t1', title: 'x' }] }] });
        }
        if (p.endsWith('loop-1-receipt.json')) {
          return JSON.stringify({ receipts: [{ taskId: 'w1-t1', status: 'done', summary: 'fixed' }] });
        }
        return null;
      },
    });

    expect(result).toMatchObject({
      verdict: null,
      resultReady: true,
      reviewed: false,
      assessment: 'unreviewed',
      failure: null,
      reviewFeedback: '',
    });
  });

  test('a terminal outcome without any readable evidence is not resultReady', () => {
    const result = buildPodGoalResult({
      goalId: 'g1',
      state: state({ receiptPath: null, reviewReportPath: null, reviewVerdict: 'FAIL' }),
      request,
      readText: () => null,
    });
    expect(result.resultReady).toBe(false);
    expect(result.verdict).toBe('FAIL');
  });
});
