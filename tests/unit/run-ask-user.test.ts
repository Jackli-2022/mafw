import { askUser, getUnansweredQuestions, recordAnswer } from '../../src/tools/run-ask-user';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

const QUESTIONS_DIR = '.mafw/user-questions';

let cwdSpy: jest.SpyInstance;
let tmpDir: string;

beforeEach(() => {
  tmpDir = path.join(os.tmpdir(), `mafw-askuser-test-${Date.now()}-${Math.random()}`);
  fs.mkdirSync(tmpDir, { recursive: true });
  cwdSpy = jest.spyOn(process, 'cwd').mockReturnValue(tmpDir);
});

afterEach(() => {
  cwdSpy.mockRestore();
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ok */ }
});

test('askUser creates question file with correct fields', async () => {
  const result = await askUser({
    question: 'What framework?',
    options: ['React', 'Vue'],
    priority: 'high',
    goalId: 'goal-1',
    loopNum: 1
  });
  expect(result.success).toBe(true);
  expect(result.questionId).toMatch(/^q_\d+_/);
  expect(fs.existsSync(result.questionPath)).toBe(true);
  const data = JSON.parse(fs.readFileSync(result.questionPath, 'utf-8'));
  expect(data.question).toBe('What framework?');
  expect(data.options).toEqual(['React', 'Vue']);
  expect(data.priority).toBe('high');
  expect(data.goalId).toBe('goal-1');
  expect(data.loopNum).toBe(1);
  expect(data.answered).toBe(false);
  expect(data.answer).toBeNull();
  expect(data.timestamp).toBeDefined();
});

test('askUser works without options', async () => {
  const result = await askUser({
    question: 'Proceed?',
    priority: 'normal',
    goalId: 'goal-2',
    loopNum: 2
  });
  expect(result.success).toBe(true);
  const data = JSON.parse(fs.readFileSync(result.questionPath, 'utf-8'));
  expect(data.options).toBeUndefined();
});

test('getUnansweredQuestions returns unanswered questions', async () => {
  await askUser({ question: 'Q1', priority: 'normal', goalId: 'g1', loopNum: 1 });
  await askUser({ question: 'Q2', priority: 'high', goalId: 'g1', loopNum: 1 });
  await askUser({ question: 'Q3', priority: 'normal', goalId: 'g1', loopNum: 1 });

  const all = await askUser({ question: 'Q-answer', priority: 'normal', goalId: 'g1', loopNum: 1 });
  recordAnswer(all.questionId, 'yes');

  const unanswered = getUnansweredQuestions('g1');
  expect(unanswered).toHaveLength(3);
  expect(unanswered.map(q => q.question).sort()).toEqual(['Q1', 'Q2', 'Q3']);
});

test('getUnansweredQuestions returns empty for non-existent goal', () => {
  expect(getUnansweredQuestions('no-such-goal')).toEqual([]);
});

test('getUnansweredQuestions returns empty for goal with no questions', () => {
  const dir = path.join(tmpDir, QUESTIONS_DIR, 'empty-goal');
  fs.mkdirSync(dir, { recursive: true });
  expect(getUnansweredQuestions('empty-goal')).toEqual([]);
});

test('recordAnswer marks question as answered', async () => {
  const { questionId } = await askUser({
    question: 'Confirm?', priority: 'high', goalId: 'g2', loopNum: 1
  });
  const result = recordAnswer(questionId, 'yes');
  expect(result).toBe(true);
  const unanswered = getUnansweredQuestions('g2');
  expect(unanswered).toHaveLength(0);
});

test('recordAnswer returns false for non-existent questionId', () => {
  expect(recordAnswer('nonexistent_q', 'no')).toBe(false);
});

test('recordAnswer returns false when base dir does not exist', () => {
  const cwd = path.join(os.tmpdir(), `mafw-no-base-${Date.now()}`);
  cwdSpy.mockRestore();
  jest.spyOn(process, 'cwd').mockReturnValue(cwd);
  expect(recordAnswer('q_1234_abcd', 'no')).toBe(false);
});
