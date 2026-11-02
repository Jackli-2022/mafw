import * as fs from 'fs';
import * as path from 'path';
import { makeHarness } from '../helpers/goal-driver-harness';
import { ensureGoalState } from '../../../src/core/goal/state-v3';

describe('NodeDriver goal-dir layout', () => {
  test('plan prompt reads goal.md/request.json and preserves acceptance, boundaries, taskType, planReview', async () => {
    const h = makeHarness();
    const goalId = 'g-goal-dir';
    const goalDir = path.join(h.mafwDir, 'goals', goalId);
    fs.mkdirSync(goalDir, { recursive: true });
    fs.writeFileSync(path.join(goalDir, 'goal.md'), '# Goal-dir charter', 'utf-8');
    fs.writeFileSync(path.join(goalDir, 'request.json'), JSON.stringify({
      goalId,
      title: 'Goal dir',
      layout: 'goal-dir',
      discussion: true,
      acceptance: ['tests pass', 'receipt lists artifacts'],
      boundaries: ['no schema changes', 'no network'],
      taskType: 'research',
      planReview: 'manual',
    }), 'utf-8');

    ensureGoalState(h.mafwDir, goalId, {
      projectDir: 'C:/p',
      maxRounds: 3,
      planReview: 'manual',
    });
    h.driver.registerGoalDir(goalId, h.mafwDir);

    await h.driver.advance(goalId);
    const promptCall = h.calls.find((call) => call.op === 'promptAsync');
    expect(promptCall).toBeTruthy();
    const text = promptCall.parts[0].text;

    expect(text).toContain(`charter: ${path.join(goalDir, 'goal.md')}`);
    expect(text).toContain(`request: ${path.join(goalDir, 'request.json')}`);
    expect(text).toContain('Goal acceptance');
    expect(text).toContain('- tests pass');
    expect(text).toContain('- receipt lists artifacts');
    expect(text).toContain('Goal boundaries');
    expect(text).toContain('- no schema changes');
    expect(text).toContain('- no network');
    expect(text).toContain('Declared task type: research');
    expect(text).toContain('Plan review mode: manual');
  });
});
