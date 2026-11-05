// gateway/tests/unit/goal/idle-attribution.test.ts
// 业界做法（opencode CLI / orca）：完成信号必须归属到本回合。没有本回合活动的 idle
// 是上一回合的残余，不能用来收账、也不该消耗 grace。
import * as fs from 'fs';
import * as path from 'path';
import { makeHarness, seedGoal } from '../helpers/goal-driver-harness';
import { nodeArtifactPaths } from '../../../src/core/goal/node-prompts';

it('ignores an idle that arrives before any activity from this dispatch', async () => {
  const h = makeHarness({ reuseGraceMs: 10 });
  h.deps.existingNodeSession = (_g, node) => (node === 'plan' ? 'ses_tech_lead' : null);
  seedGoal(h, 'g1', { patch: { planReview: 'auto' } });
  await h.driver.advance('g1');

  await h.fireIdle('ses_tech_lead', { withActivity: false });
  await new Promise((r) => setTimeout(r, 60));

  const st = h.load('g1')!;
  expect(st.nextAction).toBe('RUNNING_plan');
});

it('fails fast when the turn had activity but produced nothing', async () => {
  const h = makeHarness({ reuseGraceMs: 10 });
  h.deps.existingNodeSession = (_g, node) => (node === 'plan' ? 'ses_tech_lead' : null);
  seedGoal(h, 'g1', { patch: { planReview: 'auto' } });
  await h.driver.advance('g1');

  h.driver.noteSessionActivity('ses_tech_lead');
  await h.fireIdle('ses_tech_lead');
  await new Promise((r) => setTimeout(r, 30));

  const st = h.load('g1')!;
  expect(st.nextAction).toBe('FAILED');
  expect(String(st.lastError ?? '')).toContain('artifact_missing');
});

it('completes when the turn had activity and wrote the artifact', async () => {
  const h = makeHarness({ reuseGraceMs: 10 });
  h.deps.existingNodeSession = (_g, node) => (node === 'plan' ? 'ses_tech_lead' : null);
  seedGoal(h, 'g1', { patch: { planReview: 'auto' } });
  await h.driver.advance('g1');

  const waves = nodeArtifactPaths(h.mafwDir, 'g1', 1).waves;
  fs.mkdirSync(path.dirname(waves), { recursive: true });
  fs.writeFileSync(waves, JSON.stringify({
    status: 'ready',
    taskType: 'docs',
    waves: [{ id: 'w1', title: 't', tasks: ['a'], riskNote: 'r' }],
    goalEval: { outcome: 'o', conditions: [{ id: 'g1', statement: 's', required: true, evidence: 'e', method: 'm' }], mapping: { g1: { tasks: ['w1-t1'] } } },
  }), 'utf-8');

  h.driver.noteSessionActivity('ses_tech_lead');
  await h.fireIdle('ses_tech_lead');

  const st = h.load('g1')!;
  expect(st.nextAction).not.toBe('RUNNING_plan');
  expect(st.nextAction).not.toBe('FAILED');
});
