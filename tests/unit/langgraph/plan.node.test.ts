import { planNode } from '../../../gateway/src/core/langgraph/nodes/plan.node';
import { LoopStateType } from '../../../gateway/src/core/langgraph/loop-state';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

function makeServices(tmpDir: string) {
  const sessions: string[] = [];
  const client = {
    session: {
      async create(_opts: { directory: string }) {
        const id = `sess_${Math.random().toString(36).slice(2, 8)}`;
        sessions.push(id);
        return { id };
      },
      async promptAsync(_opts: { sessionID: string; message: string }) {},
      async delete(opts: { sessionID: string }) {
        const idx = sessions.indexOf(opts.sessionID);
        if (idx >= 0) sessions.splice(idx, 1);
      },
    },
  };
  const syncToFile = jest.fn();
  return { client, syncToFile, sessions };
}

function makeState(overrides: Partial<LoopStateType> = {}): LoopStateType {
  return {
    goalId: 'test-goal',
    projectDir: '/tmp',
    mafwDir: '/tmp/mafw',
    round: 1,
    maxRounds: 3,
    wavePlanPath: null,
    receiptPath: null,
    reviewVerdict: 'FAIL' as const,
    reviewReportPath: null,
    reviewFeedback: '',
    lastError: null,
    phase: null,
    draftPlan: null,
    pendingQuestion: null,
    userResponse: null,
    stateVersion: 0,
    ...overrides,
  } as LoopStateType;
}

describe('planNode', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should clear HITL state when draftPlan and userResponse exist', async () => {
    const services = makeServices(tmpDir);
    const state = makeState({
      mafwDir: tmpDir,
      draftPlan: { status: 'need_clarification', ambiguities: ['test?'] },
      userResponse: { questionId: 'q_1', answer: 'yes', respondedAt: new Date().toISOString() },
    });

    const result = await planNode(state, services);

    expect(result.draftPlan).toBeNull();
    expect(result.pendingQuestion).toBeNull();
    expect(result.userResponse).toBeNull();
    expect(result.round).toBe(1);
    expect(services.syncToFile).toHaveBeenCalled();
  });

  it('should return pendingQuestion when waves.json has need_clarification', async () => {
    const services = makeServices(tmpDir);
    const state = makeState({ mafwDir: tmpDir, projectDir: tmpDir });

    const wavesData = {
      status: 'need_clarification',
      ambiguities: ['Which framework?', 'What timeout?'],
    };
    fs.writeFileSync(path.join(tmpDir, 'waves.json'), JSON.stringify(wavesData), 'utf-8');

    const result = await planNode(state, services);

    expect(result.pendingQuestion).not.toBeNull();
    expect(result.pendingQuestion!.node).toBe('plan');
    expect(result.pendingQuestion!.loop).toBe(1);
    expect(result.pendingQuestion!.questions).toEqual(['Which framework?', 'What timeout?']);
    expect(result.draftPlan).toEqual(wavesData);
  });

  it('should not return pendingQuestion when waves.json is normal', async () => {
    const services = makeServices(tmpDir);
    const state = makeState({ mafwDir: tmpDir, projectDir: tmpDir });

    const wavesData = { status: 'ready', waves: [] };
    fs.writeFileSync(path.join(tmpDir, 'waves.json'), JSON.stringify(wavesData), 'utf-8');

    const result = await planNode(state, services);

    expect(result.pendingQuestion).toBeNull();
    expect(result.draftPlan).toBeNull();
    expect(result.wavePlanPath).toBe(path.join(tmpDir, 'waves.json'));
  });

  it('should return error when waves.json is missing', async () => {
    const services = makeServices(tmpDir);
    const state = makeState({ mafwDir: tmpDir, projectDir: tmpDir });

    const result = await planNode(state, services);

    expect(result.lastError).toContain('waves.json not found');
    expect(result.reviewVerdict).toBe('ERROR');
  });

  it('should return error when waves.json has invalid JSON', async () => {
    const services = makeServices(tmpDir);
    const state = makeState({ mafwDir: tmpDir, projectDir: tmpDir });

    fs.writeFileSync(path.join(tmpDir, 'waves.json'), 'not-json', 'utf-8');

    const result = await planNode(state, services);

    expect(result.lastError).toContain('Invalid waves.json');
    expect(result.reviewVerdict).toBe('ERROR');
  });

  it('should clean up session after completion', async () => {
    const services = makeServices(tmpDir);
    const state = makeState({ mafwDir: tmpDir, projectDir: tmpDir });

    fs.writeFileSync(path.join(tmpDir, 'waves.json'), JSON.stringify({ status: 'ready' }), 'utf-8');

    await planNode(state, services);

    expect(services.sessions.length).toBe(0);
  });
});
