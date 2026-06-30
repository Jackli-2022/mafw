import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import simpleGit from 'simple-git';
import { mafwExecuteEntry, mergeWaveToGoal } from '../../../src/skills/mafw-execute/entry';
import { TaskBranchManager } from '../../../src/engine/task-branch-manager';

let tmpDir: string;
let repoDir: string;
let cwdSpy: jest.SpyInstance;

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-exec-'));
  repoDir = path.join(tmpDir, 'repo');
  fs.mkdirSync(repoDir);
  const git = simpleGit(repoDir);
  await git.init();
  await git.addConfig('user.name', 'Test');
  await git.addConfig('user.email', 'test@example.com');
  fs.writeFileSync(path.join(repoDir, 'a.txt'), 'a');
  await git.add('a.txt');
  await git.commit('init');
  await git.checkoutLocalBranch('main');
  await git.checkoutLocalBranch('goal/001-auth');

  fs.mkdirSync(path.join(repoDir, '.opencode', 'mafw', 'state'), { recursive: true });
  fs.mkdirSync(path.join(repoDir, '.opencode', 'mafw', 'requests'), { recursive: true });
  fs.writeFileSync(
    path.join(repoDir, '.opencode', 'mafw', 'state', '001-auth.json'),
    JSON.stringify({
      version: '2',
      goalId: '001-auth',
      loop: 1,
      phase: 'EXECUTING',
      lastPhase: null,
      currentWave: 0,
      totalWaves: null,
      sessions: {},
      nextAction: 'CREATE_EXECUTE_SESSION',
      artifacts: {},
      updatedAt: new Date().toISOString()
    }, null, 2)
  );
  fs.writeFileSync(
    path.join(repoDir, '.opencode', 'mafw', 'requests', '001-auth.json'),
    JSON.stringify({
      version: '1',
      goalId: '001-auth',
      title: 'Auth',
      state: 'PENDING',
      createdAt: new Date().toISOString(),
      confirmedAt: new Date().toISOString(),
      source: 'test',
      projectDir: repoDir,
      mafwDir: path.join(repoDir, '.opencode', 'mafw'),
      goalCharter: 'goals/001-auth.md',
      metrics: {},
      boundaries: [],
      priority: 'normal',
      maxLoops: 5,
      parallel: false,
      degradeOnLoop: 5
    }, null, 2)
  );
  fs.writeFileSync(
    path.join(repoDir, '.opencode', 'mafw', 'waves.json'),
    JSON.stringify({
      waves: [{
        id: 'w1',
        tasks: [{ id: 't1', description: 'add feature', affected_files: ['feat.txt'] }]
      }]
    }, null, 2)
  );

  cwdSpy = jest.spyOn(process, 'cwd').mockReturnValue(repoDir);
});

afterEach(() => {
  cwdSpy.mockRestore();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('mafwExecuteEntry executes wave, merges task branches and transitions to review', async () => {
  const mockLlm = {
    chat: jest.fn().mockResolvedValue({ content: 'console.log("ok");' })
  };

  await mafwExecuteEntry({ message: '/skill mafw-execute 001-auth', llm: mockLlm, config: { model: 'test' }, sessionId: 's1' });

  const state = JSON.parse(fs.readFileSync(path.join(repoDir, '.opencode', 'mafw', 'state', '001-auth.json'), 'utf-8'));
  expect(state.phase).toBe('EXECUTING_COMPLETE');
  expect(state.nextAction).toBe('CREATE_REVIEW_SESSION');

  const receipt = JSON.parse(fs.readFileSync(path.join(repoDir, '.opencode', 'mafw', 'receipts', '001-auth', 'loop-receipt.json'), 'utf-8'));
  expect(receipt.receipts[0].merge.status).toBe('merged');
  expect(receipt.receipts[0].merge.merged).toContain('t1');

  const git = simpleGit(repoDir);
  await git.checkout('goal/001-auth');
  const log = await git.log();
  expect(log.latest?.message).toContain('Merge task t1');
});

test('mergeWaveToGoal merges completed task branches and reports partial status', async () => {
  const mgr = new TaskBranchManager();
  const mergeSpy = jest.spyOn(mgr, 'mergeTaskBranch')
    .mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(new Error('merge conflict'));

  const result = await mergeWaveToGoal(
    { id: 'w1' },
    repoDir,
    mgr,
    [
      { taskId: 't1', status: 'completed' },
      { taskId: 't2', status: 'completed' }
    ]
  );

  mergeSpy.mockRestore();

  expect(result.status).toBe('partial');
  expect(result.merged).toEqual(['t1']);
  expect(result.failed).toEqual(['t2']);
});
