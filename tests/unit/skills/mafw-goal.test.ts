import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { mafwGoalEntry } from '../../../src/skills/mafw-goal/entry';

let tmpDir: string;
let cwdSpy: jest.SpyInstance;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-goal-'));
  fs.mkdirSync(path.join(tmpDir, '.mafw', 'state'), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, '.mafw', 'goals'), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, '.mafw', 'requests'), { recursive: true });
  cwdSpy = jest.spyOn(process, 'cwd').mockReturnValue(tmpDir);
});

afterEach(() => {
  cwdSpy.mockRestore();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function mockLlm(content: string) {
  return {
    chat: jest.fn().mockResolvedValue({ content })
  };
}

test('mafwGoalEntry writes charter, request, and initial state', async () => {
  const result = await mafwGoalEntry({
    message: 'build auth system',
    llm: mockLlm(JSON.stringify({
      title: 'Auth System',
      metrics: { test_coverage: { target: 80, unit: '%' } },
      boundaries: ['Use RS256'],
      scope: { include: ['auth'], exclude: [] },
      risks: [],
      priority: 'high',
      maxLoops: 3,
      parallel: false
    })),
    config: { model: 'test' },
    projectDir: tmpDir
  });

  expect(result.title).toBe('Auth System');
  expect(fs.existsSync(path.join(tmpDir, '.mafw', 'goals', `${result.goalId}.md`))).toBe(true);
  expect(fs.existsSync(path.join(tmpDir, '.mafw', 'requests', `${result.goalId}.json`))).toBe(true);

  const state = JSON.parse(fs.readFileSync(path.join(tmpDir, '.mafw', 'state', `${result.goalId}.json`), 'utf-8'));
  expect(state.nextAction).toBe('CREATE_PLAN_SESSION');
  expect(state.phase).toBe('PLANNING');
});

test('mafwGoalEntry falls back on empty LLM response', async () => {
  const result = await mafwGoalEntry({
    message: '',
    llm: mockLlm(''),
    config: { model: 'test' },
    projectDir: tmpDir
  });

  expect(result.title).toBe('');
  expect(result.metrics).toBeDefined();
  expect(fs.existsSync(path.join(tmpDir, '.mafw', 'state', `${result.goalId}.json`))).toBe(true);
});

test('mafwGoalEntry falls back on malformed LLM response', async () => {
  const result = await mafwGoalEntry({
    message: 'fix bug',
    llm: mockLlm('not json'),
    config: { model: 'test' },
    projectDir: tmpDir
  });

  expect(result.title).toBe('fix bug');
  expect(result.boundaries.length).toBeGreaterThan(0);
});
