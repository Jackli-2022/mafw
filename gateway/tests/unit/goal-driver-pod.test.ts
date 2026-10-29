import { makeHarness, seedGoal } from './helpers/goal-driver-harness';
import * as fs from 'fs';
import * as path from 'path';

describe('NodeDriver pod context', () => {
  test('prepends pod context to the plan prompt and keeps the normal prompt', async () => {
    const h = makeHarness();
    seedGoal(h, 'g1');
    const seen: Array<[string, string]> = [];
    (h.deps as any).podContext = (goalId: string, node: string) => {
      seen.push([goalId, node]);
      return '[POD CONTEXT]\nproject dialect: use pnpm';
    };

    await h.driver.advance('g1');
    const prompt = h.calls.find((call) => call.op === 'promptAsync')?.parts?.[0]?.text ?? '';

    expect(seen).toEqual([['g1', 'plan']]);
    expect(prompt.startsWith('[POD CONTEXT]')).toBe(true);
    expect(prompt).toContain('project dialect: use pnpm');
    expect(prompt).toContain('waves.json');
  });

  test('leaves the prompt unchanged when pod context is absent or null', async () => {
    const h = makeHarness();
    seedGoal(h, 'g1');
    (h.deps as any).podContext = () => null;

    await h.driver.advance('g1');
    const prompt = h.calls.find((call) => call.op === 'promptAsync')?.parts?.[0]?.text ?? '';

    expect(prompt.startsWith('[POD CONTEXT]')).toBe(false);
    expect(prompt).toContain('waves.json');
  });

  test('finished plan event fires after wavePlanPath is persisted', async () => {
    const h = makeHarness();
    seedGoal(h, 'g1');
    fs.writeFileSync(
      path.join(h.mafwDir, 'waves.json'),
      JSON.stringify({ waves: [{ id: 'w1', tasks: ['do a'] }], status: 'ready' }),
      'utf-8',
    );
    let stateAtEvent: any = null;
    const original = h.deps.emitNodeEvent;
    h.deps.emitNodeEvent = (p: any) => {
      if (p.type === 'goal_node' && p.transition === 'finished' && p.node === 'plan') {
        stateAtEvent = h.load('g1');
      }
      original(p);
    };

    await h.startAndIdle('g1');
    await h.fireIdle();

    expect(stateAtEvent?.wavePlanPath).toBe(path.join(h.mafwDir, 'waves.json'));
  });
});
