import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const { AutomationEngine, actionRegistry } = require('../../../gateway/src/automation-engine');
const {
  wakeCompletedHandler,
  wakeFailedHandler,
  wakeQuestionHandler,
} = require('../../../gateway/src/core/manager/wake-handlers');

describe('wake-handlers', () => {
  let tmpDir: string;
  let stateDir: string;
  let engine: InstanceType<typeof AutomationEngine>;

  beforeEach(() => {
    actionRegistry.set('manager:report_completed', wakeCompletedHandler);
    actionRegistry.set('manager:report_failed', wakeFailedHandler);
    actionRegistry.set('manager:report_question', wakeQuestionHandler);
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wake-test-'));
    stateDir = path.join(tmpDir, 'state');
    fs.mkdirSync(stateDir, { recursive: true });
    engine = new AutomationEngine(tmpDir);
  });

  afterEach(() => {
    actionRegistry.delete('manager:report_completed');
    actionRegistry.delete('manager:report_failed');
    actionRegistry.delete('manager:report_question');
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  function writeStateFile(goalId: string, overrides: Record<string, any> = {}): void {
    const data = {
      goalId,
      phase: 'ARCHIVED',
      loop: 3,
      reviewVerdict: 'PASS',
      stateVersion: 2,
      reportedAt: null,
      ...overrides,
    };
    fs.writeFileSync(path.join(stateDir, `${goalId}.json`), JSON.stringify(data), 'utf-8');
  }

  function writeManagerSession(sessionId: string = 'mgr-session-1'): void {
    fs.writeFileSync(
      path.join(tmpDir, 'manager-session.json'),
      JSON.stringify({ sessionId }),
      'utf-8',
    );
  }

  // ── actionRegistry registration ──

  it('registers 3 manager action handlers in actionRegistry', () => {
    expect(actionRegistry.has('manager:report_completed')).toBe(true);
    expect(actionRegistry.has('manager:report_failed')).toBe(true);
    expect(actionRegistry.has('manager:report_question')).toBe(true);
  });

  // ── wakeCompletedHandler ──

  it('does nothing when state dir is empty', async () => {
    writeManagerSession();
    const logSpy = jest.spyOn(require('../../../gateway/src/core/utils/logger').log, 'info').mockImplementation();
    await wakeCompletedHandler({ id: 'test', enabled: true, trigger: { type: 'event', on: ['goal:completed'], perGoalCooldown: '60s' } }, engine);
    expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining('Injecting wake prompt'));
    logSpy.mockRestore();
  });

  it('does nothing when no goal has PASS verdict', async () => {
    writeManagerSession();
    writeStateFile('g1', { reviewVerdict: 'FAIL' });
    writeStateFile('g2', { reviewVerdict: 'ERROR' });
    const logSpy = jest.spyOn(require('../../../gateway/src/core/utils/logger').log, 'info').mockImplementation();
    await wakeCompletedHandler({ id: 'test', enabled: true, trigger: { type: 'event', on: ['goal:completed'], perGoalCooldown: '60s' } }, engine);
    expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining('Injecting wake prompt'));
    logSpy.mockRestore();
  });

  it('does nothing when PASS goal already has reportedAt set', async () => {
    writeManagerSession();
    writeStateFile('g1', { reviewVerdict: 'PASS', reportedAt: new Date().toISOString() });
    const logSpy = jest.spyOn(require('../../../gateway/src/core/utils/logger').log, 'info').mockImplementation();
    await wakeCompletedHandler({ id: 'test', enabled: true, trigger: { type: 'event', on: ['goal:completed'], perGoalCooldown: '60s' } }, engine);
    expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining('Injecting wake prompt'));
    logSpy.mockRestore();
  });

  it('calls injectWakeMessage with PASS unreported goals', async () => {
    writeManagerSession();
    writeStateFile('g1', { reviewVerdict: 'PASS', reportedAt: null });
    writeStateFile('g2', { reviewVerdict: 'PASS', reportedAt: null });
    writeStateFile('g3', { reviewVerdict: 'FAIL' });

    const logSpy = jest.spyOn(require('../../../gateway/src/core/utils/logger').log, 'info').mockImplementation();
    await wakeCompletedHandler({ id: 'test', enabled: true, trigger: { type: 'event', on: ['goal:completed'], perGoalCooldown: '60s' } }, engine);

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Injecting wake prompt'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('report_completed'));
    logSpy.mockRestore();
  });

  it('skips corrupt state files silently', async () => {
    writeManagerSession();
    writeStateFile('g1', { reviewVerdict: 'PASS', reportedAt: null });
    fs.writeFileSync(path.join(stateDir, 'corrupt.json'), '{invalid', 'utf-8');

    const logSpy = jest.spyOn(require('../../../gateway/src/core/utils/logger').log, 'info').mockImplementation();
    await wakeCompletedHandler({ id: 'test', enabled: true, trigger: { type: 'event', on: ['goal:completed'], perGoalCooldown: '60s' } }, engine);

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Injecting wake prompt'));
    logSpy.mockRestore();
  });

  // ── wakeFailedHandler ──

  it('does nothing when no goal has FAIL or ERROR verdict', async () => {
    writeManagerSession();
    writeStateFile('g1', { reviewVerdict: 'PASS' });
    const logSpy = jest.spyOn(require('../../../gateway/src/core/utils/logger').log, 'info').mockImplementation();
    await wakeFailedHandler({ id: 'test', enabled: true, trigger: { type: 'event', on: ['goal:failed'], perGoalCooldown: '60s' } }, engine);
    expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining('Injecting wake prompt'));
    logSpy.mockRestore();
  });

  it('does nothing when FAIL goal already has reportedAt set', async () => {
    writeManagerSession();
    writeStateFile('g1', { reviewVerdict: 'FAIL', reportedAt: new Date().toISOString() });
    const logSpy = jest.spyOn(require('../../../gateway/src/core/utils/logger').log, 'info').mockImplementation();
    await wakeFailedHandler({ id: 'test', enabled: true, trigger: { type: 'event', on: ['goal:failed'], perGoalCooldown: '60s' } }, engine);
    expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining('Injecting wake prompt'));
    logSpy.mockRestore();
  });

  it('calls injectWakeMessage with FAIL unreported goals', async () => {
    writeManagerSession();
    writeStateFile('g1', { reviewVerdict: 'FAIL', reportedAt: null });
    writeStateFile('g2', { reviewVerdict: 'PASS' });

    const logSpy = jest.spyOn(require('../../../gateway/src/core/utils/logger').log, 'info').mockImplementation();
    await wakeFailedHandler({ id: 'test', enabled: true, trigger: { type: 'event', on: ['goal:failed'], perGoalCooldown: '60s' } }, engine);

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Injecting wake prompt'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('report_failed'));
    logSpy.mockRestore();
  });

  it('includes ERROR verdict goals as failed', async () => {
    writeManagerSession();
    writeStateFile('g1', { reviewVerdict: 'ERROR', reportedAt: null });
    writeStateFile('g2', { reviewVerdict: 'FAIL', reportedAt: null });

    const logSpy = jest.spyOn(require('../../../gateway/src/core/utils/logger').log, 'info').mockImplementation();
    await wakeFailedHandler({ id: 'test', enabled: true, trigger: { type: 'event', on: ['goal:failed'], perGoalCooldown: '60s' } }, engine);

    expect(logSpy).toHaveBeenCalledTimes(1);
    logSpy.mockRestore();
  });

  // ── wakeQuestionHandler ──

  it('does nothing when question-ledger has no pending questions', async () => {
    writeManagerSession();
    const logSpy = jest.spyOn(require('../../../gateway/src/core/utils/logger').log, 'info').mockImplementation();
    await wakeQuestionHandler({ id: 'test', enabled: true, trigger: { type: 'event', on: ['question:asked'], perGoalCooldown: '60s' } }, engine);
    expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining('Injecting wake prompt'));
    logSpy.mockRestore();
  });

  it('calls injectWakeMessage when pending questions exist', async () => {
    writeManagerSession();
    const ledgerPath = path.join(tmpDir, 'question-ledger.jsonl');
    const now = new Date().toISOString();
    fs.writeFileSync(
      ledgerPath,
      JSON.stringify({ type: 'asked', questionId: 'q1', goalId: 'g1', node: 'plan', loop: 1, questions: ['Test?'], askedAt: now }) + '\n',
      'utf-8',
    );

    const logSpy = jest.spyOn(require('../../../gateway/src/core/utils/logger').log, 'info').mockImplementation();
    await wakeQuestionHandler({ id: 'test', enabled: true, trigger: { type: 'event', on: ['question:asked'], perGoalCooldown: '60s' } }, engine);

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Injecting wake prompt'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('report_question'));
    logSpy.mockRestore();
  });

  it('does not inject when all questions are answered', async () => {
    writeManagerSession();
    const now = new Date().toISOString();
    const lines = [
      JSON.stringify({ type: 'asked', questionId: 'q1', goalId: 'g1', node: 'plan', loop: 1, questions: ['Test?'], askedAt: now }),
      JSON.stringify({ type: 'answered', questionId: 'q1', answer: 'done', answeredAt: now }),
    ];
    fs.writeFileSync(path.join(tmpDir, 'question-ledger.jsonl'), lines.join('\n') + '\n', 'utf-8');

    const logSpy = jest.spyOn(require('../../../gateway/src/core/utils/logger').log, 'info').mockImplementation();
    await wakeQuestionHandler({ id: 'test', enabled: true, trigger: { type: 'event', on: ['question:asked'], perGoalCooldown: '60s' } }, engine);

    expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining('Injecting wake prompt'));
    logSpy.mockRestore();
  });

  // ── injectWakeMessage edge cases (via side effects) ──

  it('does not inject when manager-session.json does not exist', async () => {
    // No writeManagerSession() — file intentionally missing
    writeStateFile('g1', { reviewVerdict: 'PASS', reportedAt: null });

    const logSpy = jest.spyOn(require('../../../gateway/src/core/utils/logger').log, 'info').mockImplementation();
    await wakeCompletedHandler({ id: 'test', enabled: true, trigger: { type: 'event', on: ['goal:completed'], perGoalCooldown: '60s' } }, engine);

    expect(logSpy).toHaveBeenCalledWith('[WakeHandler] No manager session found — skipping wake injection');
    logSpy.mockRestore();
  });

  it('does not crash when state dir is missing', async () => {
    fs.rmSync(stateDir, { recursive: true, force: true });
    await expect(
      wakeCompletedHandler({ id: 'test', enabled: true, trigger: { type: 'event', on: ['goal:completed'], perGoalCooldown: '60s' } }, engine),
    ).resolves.toBeUndefined();
  });

  // ── validateRule integration — manager actions should be recognized ──

  it('validateRule accepts manager:report_completed action type', () => {
    const result = engine.validateRule({
      id: 'wake-test', enabled: false,
      trigger: { type: 'event', on: ['goal:completed'], perGoalCooldown: '60s' },
      action: { type: 'manager:report_completed' },
    });
    expect(result.valid).toBe(true);
  });

  it('validateRule accepts manager:report_failed action type', () => {
    const result = engine.validateRule({
      id: 'wake-test', enabled: false,
      trigger: { type: 'event', on: ['goal:failed'], perGoalCooldown: '60s' },
      action: { type: 'manager:report_failed' },
    });
    expect(result.valid).toBe(true);
  });

  it('validateRule accepts manager:report_question action type', () => {
    const result = engine.validateRule({
      id: 'wake-test', enabled: false,
      trigger: { type: 'event', on: ['question:asked'], perGoalCooldown: '60s' },
      action: { type: 'manager:report_question' },
    });
    expect(result.valid).toBe(true);
  });
});
