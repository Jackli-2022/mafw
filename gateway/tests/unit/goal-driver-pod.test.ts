import { makeHarness, seedGoal } from './helpers/goal-driver-harness';

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
});
