import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { MafwScheduler } from '../../../gateway/src/index';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-scheduler-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('archiveGoal patches state to FAILED when archiveWorktree throws', async () => {
  const projectDir = path.join(tmpDir, 'project');
  const mafwDir = path.join(projectDir, '.mafw');
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

describe('handleOpencodeEvent StepInject trigger', () => {
  test('legacy session.next.step.ended still triggers evaluateStepInjection', async () => {
    const scheduler = new MafwScheduler(tmpDir) as any;
    scheduler.evaluateStepInjection = jest.fn();

    scheduler.handleOpencodeEvent({
      type: 'session.next.step.ended',
      properties: { sessionID: 's1', assistantMessageID: 'm1', finish: 'stop' },
    });

    expect(scheduler.evaluateStepInjection).toHaveBeenCalledWith('s1', 'm1');
  });

  test('message.part.updated with step-finish part triggers evaluateStepInjection', async () => {
    const scheduler = new MafwScheduler(tmpDir) as any;
    scheduler.evaluateStepInjection = jest.fn();

    scheduler.handleOpencodeEvent({
      type: 'message.part.updated',
      properties: {
        part: { type: 'step-finish', sessionID: 's1', messageID: 'm2', reason: 'stop' },
      },
    });

    expect(scheduler.evaluateStepInjection).toHaveBeenCalledWith('s1', 'm2');
  });

  test('message.updated with completed assistant triggers evaluateStepInjection', async () => {
    const scheduler = new MafwScheduler(tmpDir) as any;
    scheduler.evaluateStepInjection = jest.fn();

    scheduler.handleOpencodeEvent({
      type: 'message.updated',
      properties: {
        info: {
          role: 'assistant',
          id: 'm3',
          sessionID: 's1',
          finish: 'stop',
          time: { completed: '2026-08-18T00:00:00Z' },
        },
      },
    });

    expect(scheduler.evaluateStepInjection).toHaveBeenCalledWith('s1', 'm3');
  });

  test('message.updated with non-completed assistant does not trigger', async () => {
    const scheduler = new MafwScheduler(tmpDir) as any;
    scheduler.evaluateStepInjection = jest.fn();

    scheduler.handleOpencodeEvent({
      type: 'message.updated',
      properties: {
        info: { role: 'assistant', id: 'm4', sessionID: 's1' },
      },
    });

    expect(scheduler.evaluateStepInjection).not.toHaveBeenCalled();
  });

  test('message.part.updated with non-step-finish part does not trigger', async () => {
    const scheduler = new MafwScheduler(tmpDir) as any;
    scheduler.evaluateStepInjection = jest.fn();

    scheduler.handleOpencodeEvent({
      type: 'message.part.updated',
      properties: {
        part: { type: 'text', sessionID: 's1', messageID: 'm3', text: 'hello' },
      },
    });

    expect(scheduler.evaluateStepInjection).not.toHaveBeenCalled();
  });
});
