// D4b counterfactual simulation: task-type dimension on the L1 ledger +
// pre-mortem block injected into the plan node prompt. Spec:
// docs/superpowers/specs/2026-10-09-d4b-counterfactual-design.md
import {
  buildCapabilityLedger,
  ledgerForTaskType,
  counterfactualBlock,
  TASK_TYPES,
  LedgerOutcome,
} from '../../../src/orchestration/capability-ledger';
import { renderNodePrompt } from '../../../src/core/goal/node-prompts';
import { counterfactualPromptBlock } from '../../../src/orchestration/capability-ledger';
import { makeHarness, seedGoal } from '../helpers/goal-driver-harness';
import * as fs from 'fs';
import * as path from 'path';

describe('L1 byTaskType bucketing', () => {
  const outcomes: LedgerOutcome[] = [
    { goal_id: '1', verdict: 'PASS', rounds: 2, task_type: 'bugfix' },
    { goal_id: '2', verdict: 'FAIL', rounds: 5, failure_kind: 'exec_error', task_type: 'bugfix' },
    { goal_id: '3', verdict: 'PASS', rounds: 3, task_type: 'bugfix' },
    { goal_id: '4', verdict: 'PASS', rounds: 1, task_type: 'feature' },
    { goal_id: '5', verdict: 'PASS', rounds: 1 }, // legacy: no task_type
  ];

  it('aggregates per task type', () => {
    const l = buildCapabilityLedger(outcomes);
    expect(l.total).toBe(5);
    expect(l.byTaskType['bugfix'].total).toBe(3);
    expect(l.byTaskType['bugfix'].passRate).toBeCloseTo(2 / 3, 5);
    expect(l.byTaskType['feature'].total).toBe(1);
  });

  it('ledgerForTaskType uses the bucket with >=3 samples', () => {
    const l = ledgerForTaskType(outcomes, 'bugfix');
    expect(l.total).toBe(3);
    expect(l.source).toBe('task');
  });

  it('ledgerForTaskType pools to global below 3 samples (no extrapolation)', () => {
    const l = ledgerForTaskType(outcomes, 'feature');
    expect(l.source).toBe('global');
    expect(l.total).toBe(5);
  });
});

describe('counterfactualBlock (pre-mortem rendering)', () => {
  const outcomes: LedgerOutcome[] = [
    { goal_id: '1', verdict: 'PASS', rounds: 2, task_type: 'bugfix' },
    { goal_id: '2', verdict: 'FAIL', rounds: 5, failure_kind: 'exec_error', total_cost: 2.5, task_type: 'bugfix' },
    { goal_id: '3', verdict: 'FAIL', rounds: 4, failure_kind: 'exec_error', task_type: 'bugfix' },
    { goal_id: '4', verdict: 'PASS', rounds: 3, task_type: 'bugfix' },
  ];
  const taxonomy = [
    { pattern: 'PowerShell 无 rg 用 Select-String', count: 5, energy: 0.9, id: 'm1' },
    { pattern: 'jest 不查 index.ts 类型', count: 3, energy: 0.8, id: 'm2' },
  ];

  it('renders failure rate, kinds, loss and taxonomy for the task type', () => {
    const block = counterfactualBlock({ taskType: 'bugfix' }, outcomes, taxonomy);
    expect(block).toContain('bugfix');
    expect(block).toContain('50%'); // 2/4 failed
    expect(block).toContain('exec_error');
    expect(block).toContain('PowerShell 无 rg');
    expect(block).toContain('riskNote');
  });

  it('empty ledger still emits the riskNote requirement (taxonomy only)', () => {
    const block = counterfactualBlock({ taskType: 'bugfix' }, [], taxonomy);
    expect(block).toContain('riskNote');
    expect(block).toContain('PowerShell 无 rg');
  });

  it('counterfactualPromptBlock helper merges prior semantics (alias export)', () => {
    expect(counterfactualPromptBlock).toBe(counterfactualBlock);
  });
});

describe('TASK_TYPES enum', () => {
  it('contains the seven canonical types', () => {
    expect(TASK_TYPES).toContain('bugfix');
    expect(TASK_TYPES).toContain('other');
    expect(TASK_TYPES.length).toBe(7);
  });
});

describe('renderNodePrompt plan branch injects the counterfactual block', () => {
  const ctx = {
    goalId: 'g1', projectDir: 'C:/p', mafwDir: 'C:/p/.mafw', round: 1, maxRounds: 3,
    charterPath: 'c.md', requestPath: 'r.json',
    priorBlock: '### 你在此类任务上的历史',
    counterfactualBlock: '### 反事实推演（pre-mortem）',
  };
  it('plan prompt contains both prior and counterfactual blocks + riskNote contract', () => {
    const p = renderNodePrompt('plan', ctx as any);
    expect(p).toContain('你在此类任务上的历史');
    expect(p).toContain('反事实推演');
    expect(p).toContain('riskNote');
    expect(p).toContain('taskType');
  });
  it('execute/review prompts are untouched', () => {
    expect(renderNodePrompt('execute', ctx as any)).not.toContain('反事实推演');
    expect(renderNodePrompt('review', ctx as any)).not.toContain('反事实推演');
  });
});

describe('D4b driver integration', () => {
  it('plan completion writes a valid waves.taskType back into the state', async () => {
    const h = makeHarness();
    seedGoal(h, 'g-d4b');
    const sid = await h.startAndIdle('g-d4b');
    fs.writeFileSync(
      path.join(h.mafwDir, 'waves.json'),
      JSON.stringify({ taskType: 'bugfix', status: 'ready', waves: [{ id: 'w1', title: 't', tasks: ['a'], riskNote: '测试环境无网 → mock fetch' }] }),
      'utf-8',
    );
    await h.fireIdle(sid);
    expect(h.load('g-d4b').taskType).toBe('bugfix');
  });

  it('invalid waves.taskType is ignored (fail-open, no state pollution)', async () => {
    const h = makeHarness();
    seedGoal(h, 'g-d4b2');
    const sid = await h.startAndIdle('g-d4b2');
    fs.writeFileSync(
      path.join(h.mafwDir, 'waves.json'),
      JSON.stringify({ taskType: 'definitely-not-a-type', status: 'ready', waves: [{ id: 'w1', title: 't', tasks: ['a'] }] }),
      'utf-8',
    );
    await h.fireIdle(sid);
    expect(h.load('g-d4b2').taskType).toBeUndefined();
  });

  it('counterfactualPrior feeds the plan prompt via deps', async () => {
    const h = makeHarness();
    const seen: string[] = [];
    h.deps.capabilityPrior = (goalId) => { seen.push(`prior:${goalId}`); return 'PRIOR'; };
    h.deps.counterfactualPrior = (goalId) => { seen.push(`cf:${goalId}`); return 'COUNTERFACTUAL'; };
    seedGoal(h, 'g-d4b3');
    await h.startAndIdle('g-d4b3');
    const prompt = h.calls.find((c) => c.op === 'promptAsync').parts[0].text;
    expect(prompt).toContain('PRIOR');
    expect(prompt).toContain('COUNTERFACTUAL');
    expect(seen).toContain('cf:g-d4b3');
  });
});
