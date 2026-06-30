import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { MafwScheduler, phaseToCreateAction } from '../../../gateway/src/index';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-scheduler-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('phaseToCreateAction maps completion phases back to session creation actions', () => {
  expect(phaseToCreateAction('PLANNING')).toBe('CREATE_PLAN_SESSION');
  expect(phaseToCreateAction('PLANNING_COMPLETE')).toBe('CREATE_PLAN_SESSION');
  expect(phaseToCreateAction('EXECUTING')).toBe('CREATE_EXECUTE_SESSION');
  expect(phaseToCreateAction('EXECUTING_COMPLETE')).toBe('CREATE_EXECUTE_SESSION');
  expect(phaseToCreateAction('REVIEWING')).toBe('CREATE_REVIEW_SESSION');
  expect(phaseToCreateAction('REVIEWING_COMPLETE')).toBe('CREATE_REVIEW_SESSION');
});

test('phaseToCreateAction falls back for unknown or null phases', () => {
  expect(phaseToCreateAction('UNKNOWN')).toBe('CREATE_UNKNOWN_SESSION');
  expect(phaseToCreateAction(null)).toBe('CREATE_UNKNOWN_SESSION');
});

test('archiveGoal patches state to FAILED when archiveWorktree throws', async () => {
  const projectDir = path.join(tmpDir, 'project');
  const mafwDir = path.join(projectDir, '.opencode', 'mafw');
  fs.mkdirSync(path.join(mafwDir, 'state'), { recursive: true });
  fs.writeFileSync(
    path.join(mafwDir, 'state', '001-auth.json'),
    JSON.stringify({
      version: '2',
      goalId: '001-auth',
      loop: 1,
      phase: 'REVIEWING_COMPLETE',
      lastPhase: 'REVIEWING',
      currentWave: 0,
      totalWaves: null,
      sessions: {},
      nextAction: 'CHECK_VERDICT',
      artifacts: {},
      updatedAt: new Date().toISOString()
    }, null, 2)
  );

  const scheduler = new MafwScheduler(tmpDir);
  (scheduler as any).registeredProjects.set(projectDir, {
    projectDir,
    mafwDir,
    registeredAt: new Date().toISOString()
  });
  (scheduler as any).activeGoals.set('001-auth', {
    goalId: '001-auth',
    loop: 1,
    phase: 'REVIEWING_COMPLETE',
    nextAction: 'CHECK_VERDICT',
    sessions: {}
  });

  (scheduler as any).loadArchiveModule = async () => ({
    archiveWorktree: async () => { throw new Error('archive exploded'); }
  });

  await (scheduler as any).archiveGoal('001-auth');

  const state = JSON.parse(fs.readFileSync(path.join(mafwDir, 'state', '001-auth.json'), 'utf-8'));
  expect(state.phase).toBe('ARCHIVED');
  expect(state.nextAction).toBe('FAILED');
  expect(state.error).toBe('archive_failed');
});
