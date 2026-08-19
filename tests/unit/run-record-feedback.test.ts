import { recordFeedback, ENERGY_DELTAS } from '../../gateway/src/core/tools/run-record-feedback';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

const FEEDBACK_DIR = '.mafw/user-feedback';

let cwdSpy: jest.SpyInstance;
let tmpDir: string;

beforeEach(() => {
  tmpDir = path.join(os.tmpdir(), `mafw-feedback-test-${Date.now()}-${Math.random()}`);
  fs.mkdirSync(tmpDir, { recursive: true });
  cwdSpy = jest.spyOn(process, 'cwd').mockReturnValue(tmpDir);
});

afterEach(() => {
  cwdSpy.mockRestore();
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ok */ }
});

test('recordFeedback creates file with thumbs_up and correct energyDelta', async () => {
  const result = await recordFeedback({
    targetId: 't1',
    type: 'thumbs_up',
    goalId: 'goal-1',
    loopNum: 1
  });
  expect(result.success).toBe(true);
  expect(result.feedbackId).toMatch(/^fb_\d+_/);
  expect(result.energyDelta).toBe(0.2);
});

test('recordFeedback thumbs_down gives negative energyDelta', async () => {
  const result = await recordFeedback({
    targetId: 't2',
    type: 'thumbs_down',
    comment: 'wrong approach',
    goalId: 'goal-1',
    loopNum: 2
  });
  expect(result.success).toBe(true);
  expect(result.energyDelta).toBe(-0.1);
  expect(result.comment).toBe('wrong approach');
});

test('recordFeedback correction gives zero energyDelta', async () => {
  const result = await recordFeedback({
    targetId: 't3',
    type: 'correction',
    comment: 'use RS256',
    goalId: 'goal-1',
    loopNum: 3
  });
  expect(result.success).toBe(true);
  expect(result.energyDelta).toBe(0);
  expect(result.comment).toBe('use RS256');
});

test('recordFeedback writes JSON file with all fields', async () => {
  const result = await recordFeedback({
    targetId: 't4',
    type: 'thumbs_up',
    goalId: 'goal-2',
    loopNum: 5,
    comment: 'great work'
  });
  const files = fs.readdirSync(path.join(tmpDir, FEEDBACK_DIR));
  const file = files.find(f => f.startsWith('fb_'))!;
  expect(file).toBeDefined();
  const data = JSON.parse(fs.readFileSync(path.join(tmpDir, FEEDBACK_DIR, file), 'utf-8'));
  expect(data.targetId).toBe('t4');
  expect(data.type).toBe('thumbs_up');
  expect(data.energyDelta).toBe(0.2);
  expect(data.comment).toBe('great work');
  expect(data.goalId).toBe('goal-2');
  expect(data.loopNum).toBe(5);
  expect(data.timestamp).toBeDefined();
});

test('ENERGY_DELTAS has correct values', () => {
  expect(ENERGY_DELTAS.thumbs_up).toBe(0.2);
  expect(ENERGY_DELTAS.thumbs_down).toBe(-0.1);
  expect(ENERGY_DELTAS.correction).toBe(0.0);
});

test('recordFeedback creates directory if missing', async () => {
  const feedbackDir = path.join(tmpDir, FEEDBACK_DIR);
  expect(fs.existsSync(feedbackDir)).toBe(false);
  await recordFeedback({
    targetId: 't5',
    type: 'thumbs_up',
    goalId: 'new-goal',
    loopNum: 0
  });
  expect(fs.existsSync(feedbackDir)).toBe(true);
});
