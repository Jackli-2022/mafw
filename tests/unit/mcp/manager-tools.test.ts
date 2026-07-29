import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import { handleManagerSetGoal } from '../../../gateway/src/mcp/handlers/manager-set-goal';
import { handleManagerGetGoalStatus } from '../../../gateway/src/mcp/handlers/manager-get-goal-status';
import { handleManagerListGoals } from '../../../gateway/src/mcp/handlers/manager-list-goals';
import { handleManagerAnswerQuestion } from '../../../gateway/src/mcp/handlers/manager-answer-question';
import { handleManagerGetEvidence } from '../../../gateway/src/mcp/handlers/manager-get-evidence';
import { handleManagerCancelGoal } from '../../../gateway/src/mcp/handlers/manager-cancel-goal';
import { handleManagerListPendingQuestions } from '../../../gateway/src/mcp/handlers/manager-list-pending-questions';

const ORIG_MAFW_DIR = process.env.MAFW_PROJECT_DIR;

describe('Manager MCP tools handler signatures', () => {
  it('all 7 handlers are functions', () => {
    expect(typeof handleManagerSetGoal).toBe('function');
    expect(typeof handleManagerGetGoalStatus).toBe('function');
    expect(typeof handleManagerListGoals).toBe('function');
    expect(typeof handleManagerAnswerQuestion).toBe('function');
    expect(typeof handleManagerGetEvidence).toBe('function');
    expect(typeof handleManagerCancelGoal).toBe('function');
    expect(typeof handleManagerListPendingQuestions).toBe('function');
  });

  it('handler returns correct shape', async () => {
    const result = await handleManagerSetGoal({ goalId: 'test', title: 't', charter: 'c' }, {} as any);
    expect(result).toHaveProperty('content');
    expect(Array.isArray(result.content)).toBe(true);
    expect(result.content[0]).toHaveProperty('type', 'text');
    expect(result.content[0]).toHaveProperty('text');
  });
});

describe('handleManagerSetGoal', () => {
  let tmpDir: string;
  let projectDir: string;

  beforeAll(() => { delete process.env.MAFW_PROJECT_DIR; });
  afterAll(() => { if (ORIG_MAFW_DIR) process.env.MAFW_PROJECT_DIR = ORIG_MAFW_DIR; });

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-set-goal-'));
    projectDir = path.join(tmpDir, 'project');
    fs.mkdirSync(projectDir, { recursive: true });
    process.env.MAFW_PROJECT_DIR = projectDir;
  });

  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('creates charter and request files', async () => {
    const result = await handleManagerSetGoal({
      goalId: '001-test', title: 'Test Goal', charter: '# Test\nDo the thing.',
      source: 'manager', boundaries: [], priority: 'medium', maxLoops: 5,
    }, {} as any);

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(true);
    expect(parsed.goalId).toBe('001-test');

    expect(fs.existsSync(path.join(projectDir, '.mafw', 'goals', '001-test.md'))).toBe(true);
    expect(fs.readFileSync(path.join(projectDir, '.mafw', 'goals', '001-test.md'), 'utf-8')).toBe('# Test\nDo the thing.');

    const request = JSON.parse(fs.readFileSync(path.join(projectDir, '.mafw', 'requests', '001-test.json'), 'utf-8'));
    expect(request.goalId).toBe('001-test');
    expect(request.title).toBe('Test Goal');
    expect(request.source).toBe('manager');
  });

  it('returns error if goal already exists', async () => {
    fs.mkdirSync(path.join(projectDir, '.mafw', 'goals'), { recursive: true });
    fs.writeFileSync(path.join(projectDir, '.mafw', 'goals', '001-test.md'), 'existing', 'utf-8');

    const result = await handleManagerSetGoal({ goalId: '001-test', title: 'Test', charter: '# Test' }, {} as any);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(false);
    expect(result.isError).toBe(true);
    expect(parsed.error).toContain('already exists');
  });

  it('uses defaults for optional fields', async () => {
    await handleManagerSetGoal({ goalId: '002-defaults', title: 'Defaults', charter: '# Defaults' }, {} as any);
    const request = JSON.parse(fs.readFileSync(path.join(projectDir, '.mafw', 'requests', '002-defaults.json'), 'utf-8'));
    expect(request.source).toBe('manager');
    expect(request.priority).toBe('medium');
    expect(request.maxLoops).toBe(5);
  });
});

describe('handleManagerGetGoalStatus', () => {
  let tmpDir: string;
  let projectDir: string;

  beforeAll(() => { delete process.env.MAFW_PROJECT_DIR; });
  afterAll(() => { if (ORIG_MAFW_DIR) process.env.MAFW_PROJECT_DIR = ORIG_MAFW_DIR; });

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-get-status-'));
    projectDir = path.join(tmpDir, 'project');
    fs.mkdirSync(path.join(projectDir, '.mafw', 'state'), { recursive: true });
    process.env.MAFW_PROJECT_DIR = projectDir;
  });

  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('returns goal status from state file', async () => {
    fs.writeFileSync(path.join(projectDir, '.mafw', 'state', '001-test.json'), JSON.stringify({
      goalId: '001-test', phase: 'EXECUTING', round: 2, reviewVerdict: null, lastError: null, updatedAt: '2024-01-01T00:00:00Z',
    }), 'utf-8');

    const result = await handleManagerGetGoalStatus({ goalId: '001-test' }, {} as any);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(true);
    expect(parsed.phase).toBe('EXECUTING');
    expect(parsed.round).toBe(2);
  });

  it('returns error for non-existent goal', async () => {
    const result = await handleManagerGetGoalStatus({ goalId: 'nonexistent' }, {} as any);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(false);
    expect(result.isError).toBe(true);
    expect(parsed.error).toContain('not found');
  });
});

describe('handleManagerListGoals', () => {
  let tmpDir: string;
  let projectDir: string;

  beforeAll(() => { delete process.env.MAFW_PROJECT_DIR; });
  afterAll(() => { if (ORIG_MAFW_DIR) process.env.MAFW_PROJECT_DIR = ORIG_MAFW_DIR; });

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-list-goals-'));
    projectDir = path.join(tmpDir, 'project');
    process.env.MAFW_PROJECT_DIR = projectDir;
  });

  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('returns empty list when no state dir exists', async () => {
    const result = await handleManagerListGoals({}, {} as any);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(true);
    expect(parsed.goals).toEqual([]);
  });

  it('lists goals from state files', async () => {
    fs.mkdirSync(path.join(projectDir, '.mafw', 'state'), { recursive: true });
    fs.writeFileSync(path.join(projectDir, '.mafw', 'state', 'g1.json'), JSON.stringify({ goalId: 'g1', phase: 'PLANNING', round: 1, updatedAt: 'now' }), 'utf-8');
    fs.writeFileSync(path.join(projectDir, '.mafw', 'state', 'g2.json'), JSON.stringify({ goalId: 'g2', phase: 'EXECUTING', round: 2, updatedAt: 'now' }), 'utf-8');

    const result = await handleManagerListGoals({}, {} as any);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.goals).toHaveLength(2);
    expect(parsed.goals.map((g: any) => g.goalId)).toContain('g1');
    expect(parsed.goals.map((g: any) => g.goalId)).toContain('g2');
  });

  it('skips malformed state files', async () => {
    fs.mkdirSync(path.join(projectDir, '.mafw', 'state'), { recursive: true });
    fs.writeFileSync(path.join(projectDir, '.mafw', 'state', 'good.json'), JSON.stringify({ goalId: 'good', phase: 'PLANNING', round: 1, updatedAt: 'now' }), 'utf-8');
    fs.writeFileSync(path.join(projectDir, '.mafw', 'state', 'bad.json'), '{invalid}', 'utf-8');

    const result = await handleManagerListGoals({}, {} as any);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.goals).toHaveLength(1);
    expect(parsed.goals[0].goalId).toBe('good');
  });
});

describe('handleManagerGetEvidence', () => {
  let tmpDir: string;
  let projectDir: string;

  beforeAll(() => { delete process.env.MAFW_PROJECT_DIR; });
  afterAll(() => { if (ORIG_MAFW_DIR) process.env.MAFW_PROJECT_DIR = ORIG_MAFW_DIR; });

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-evidence-'));
    projectDir = path.join(tmpDir, 'project');
    process.env.MAFW_PROJECT_DIR = projectDir;
  });

  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('returns null when no reviews exist', async () => {
    const result = await handleManagerGetEvidence({ goalId: 'g1' }, {} as any);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(true);
    expect(parsed.evidence).toBeNull();
    expect(parsed.message).toContain('No review reports found');
  });

  it('returns latest review report', async () => {
    fs.mkdirSync(path.join(projectDir, '.mafw', 'reviews'), { recursive: true });
    fs.writeFileSync(path.join(projectDir, '.mafw', 'reviews', 'g1-loop1.md'), '# Review 1\nVerdict: PASS', 'utf-8');
    fs.writeFileSync(path.join(projectDir, '.mafw', 'reviews', 'g1-loop2.md'), '# Review 2\nVerdict: FAIL', 'utf-8');

    const result = await handleManagerGetEvidence({ goalId: 'g1' }, {} as any);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.file).toBe('g1-loop2.md');
    expect(parsed.content).toContain('FAIL');
  });
});

describe('handleManagerListPendingQuestions', () => {
  let tmpDir: string;
  let projectDir: string;

  beforeAll(() => { delete process.env.MAFW_PROJECT_DIR; });
  afterAll(() => { if (ORIG_MAFW_DIR) process.env.MAFW_PROJECT_DIR = ORIG_MAFW_DIR; });

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-pending-q-'));
    projectDir = path.join(tmpDir, 'project');
    process.env.MAFW_PROJECT_DIR = projectDir;
  });

  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('returns empty list when no ledger exists', async () => {
    const result = await handleManagerListPendingQuestions({}, {} as any);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(true);
    expect(parsed.questions).toEqual([]);
  });

  it('returns only pending (unanswered) questions', async () => {
    fs.mkdirSync(path.join(projectDir, '.mafw'), { recursive: true });
    const ledgerPath = path.join(projectDir, '.mafw', 'question-ledger.jsonl');
    fs.writeFileSync(ledgerPath, [
      JSON.stringify({ type: 'asked', questionId: 'q1', goalId: 'g1', node: 'plan', loop: 1, questions: ['What?'], askedAt: 'now' }),
      JSON.stringify({ type: 'answered', questionId: 'q1', goalId: 'g1', answer: 'ok', answeredAt: 'now' }),
      JSON.stringify({ type: 'asked', questionId: 'q2', goalId: 'g1', node: 'review', loop: 1, questions: ['How?'], askedAt: 'now' }),
      JSON.stringify({ type: 'asked', questionId: 'q3', goalId: 'g2', node: 'plan', loop: 1, questions: ['Why?'], askedAt: 'now' }),
    ].join('\n'), 'utf-8');

    const result = await handleManagerListPendingQuestions({}, {} as any);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.questions).toHaveLength(2);
    expect(parsed.questions.map((q: any) => q.questionId)).toEqual(expect.arrayContaining(['q2', 'q3']));
  });

  it('returns empty list when all questions are answered', async () => {
    fs.mkdirSync(path.join(projectDir, '.mafw'), { recursive: true });
    fs.writeFileSync(path.join(projectDir, '.mafw', 'question-ledger.jsonl'), [
      JSON.stringify({ type: 'asked', questionId: 'q1', goalId: 'g1', askedAt: 'now' }),
      JSON.stringify({ type: 'answered', questionId: 'q1', answer: 'ok', answeredAt: 'now' }),
    ].join('\n'), 'utf-8');

    const result = await handleManagerListPendingQuestions({}, {} as any);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.questions).toEqual([]);
  });
});

describe('handleManagerAnswerQuestion', () => {
  it('handler runs and returns a response (relies on gateway on port 3000)', async () => {
    jest.setTimeout(10000);
    const result = await handleManagerAnswerQuestion({ goalId: 'g1', questionId: 'q1', answer: 'yes' }, {} as any);
    expect(result).toHaveProperty('content');
    expect(result.content[0]).toHaveProperty('type', 'text');
  });
});

describe('handleManagerCancelGoal', () => {
  it('handler runs and returns a response (relies on gateway on port 3000)', async () => {
    jest.setTimeout(10000);
    const result = await handleManagerCancelGoal({ goalId: 'g1' }, {} as any);
    expect(result).toHaveProperty('content');
    expect(result.content[0]).toHaveProperty('type', 'text');
  });
});
