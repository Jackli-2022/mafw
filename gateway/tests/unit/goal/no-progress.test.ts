import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { nextNoProgress } from '../../../src/core/goal/no-progress';
import { nodeArtifactPaths } from '../../../src/core/goal/node-prompts';
import { makeHarness, seedGoal } from '../helpers/goal-driver-harness';

describe('no progress gate', () => {
  test('identical artifact advances the counter and third repeat asks for help', () => {
    let state = nextNoProgress({ previousDigest: 'h1', previousCount: 0, digest: 'h1' });
    expect(state).toMatchObject({ count: 1, ask: false });
    state = nextNoProgress({ previousDigest: state.digest, previousCount: state.count, digest: 'h1' });
    expect(state).toMatchObject({ count: 2, ask: false });
    state = nextNoProgress({ previousDigest: state.digest, previousCount: state.count, digest: 'h1' });
    expect(state).toMatchObject({ count: 3, ask: true });
  });

  test('a changed artifact resets the counter', () => {
    expect(nextNoProgress({ previousDigest: 'h1', previousCount: 2, digest: 'h2' }))
      .toMatchObject({ count: 0, digest: 'h2', ask: false });
    expect(nextNoProgress({ previousDigest: undefined, previousCount: 0, digest: 'h1' }))
      .toMatchObject({ count: 0, digest: 'h1', ask: false });
  });

  test('NodeDriver asks instead of looping when the plan artifact repeats', async () => {
    const h = makeHarness();
    const waves = JSON.stringify({ waves: [{ id: 'w1', title: 't', tasks: [] }], status: 'ready' });
    const digest = createHash('sha1').update(waves).digest('hex');
    seedGoal(h, 'g9', { patch: { lastArtifactDigest: { plan: digest }, noProgressCount: 2 } });
    const sid = await h.startAndIdle('g9');
    fs.writeFileSync(nodeArtifactPaths(h.mafwDir, 'g9', 1).waves, waves, 'utf-8');
    await h.fireIdle(sid);
    const st = h.load('g9')!;
    expect(st.pendingQuestion).toMatchObject({ node: 'plan', resumeNode: 'plan' });
    expect(st.pendingQuestion?.questions[0]).toMatch(/no progress/i);
  });
});
