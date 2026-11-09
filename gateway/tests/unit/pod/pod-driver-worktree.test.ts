import * as fs from 'fs';
import * as path from 'path';
import { makeHarness, seedGoal } from '../helpers/goal-driver-harness';

function createDirs(h: ReturnType<typeof makeHarness>): Array<{ goalId: string; revision: number; dir: string }> {
  return h.calls
    .filter((call) => call.op === 'create')
    .map((call) => ({ goalId: 'g1', revision: 1, dir: call.directory }));
}

describe('NodeDriver revision worktree sessions', () => {
  test('plan creates its session in the revision worktree', async () => {
    const h = makeHarness();
    seedGoal(h, 'g1');
    const workdir = path.join(h.mafwDir, 'wt-r1');
    (h.deps as any).workdirForRevision = jest.fn(async () => workdir);

    await h.driver.advance('g1');

    expect(createDirs(h)).toEqual([{ goalId: 'g1', revision: 1, dir: workdir }]);
    expect((h.deps as any).workdirForRevision).toHaveBeenCalledWith('g1', 1);
  });

  test('execute and review create their sessions in the same worktree', async () => {
    for (const node of ['execute', 'review'] as const) {
      const h = makeHarness();
      const workdir = path.join(h.mafwDir, `wt-${node}`);
      seedGoal(h, 'g1', {
        patch: {
          nextNode: node,
          nextAction: `NEXT_${node}`,
          wavePlanPath: path.join(h.mafwDir, 'waves.json'),
        },
      });
      fs.writeFileSync(
        path.join(h.mafwDir, 'waves.json'),
        JSON.stringify({ status: 'ready', waves: [{ id: 'w1', tasks: ['do a'] }] }),
        'utf-8',
      );
      (h.deps as any).workdirForRevision = jest.fn(async () => workdir);

      await h.driver.advance('g1');

      expect(createDirs(h)).toEqual([{ goalId: 'g1', revision: 1, dir: workdir }]);
      expect((h.deps as any).workdirForRevision).toHaveBeenCalledWith('g1', 1);
    }
  });

  test('a rejected worktree lookup fails the node instead of using the project directory', async () => {
    const h = makeHarness();
    seedGoal(h, 'g1');
    (h.deps as any).workdirForRevision = jest.fn(async () => {
      throw new Error('worktree unavailable');
    });

    await h.driver.advance('g1');

    expect(h.calls.filter((call) => call.op === 'create')).toEqual([]);
    const archived = h.calls.find((call) => call.op === 'archiveGoal');
    expect(archived).toMatchObject({ verdict: 'ERROR' });
    expect(h.load('g1').lastError).toContain('worktree unavailable');
  });
});
