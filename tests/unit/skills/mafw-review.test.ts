import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { mafwReviewEntry } from '../../../gateway/src/core/skills/mafw-review/entry';

let tmpDir: string;
let cwdSpy: jest.SpyInstance;

function setupDirs() {
  const dirs = [
    'state', 'requests', 'goals', 'receipts/001-auth', 'reviews',
    'lessons', 'parametric', 'parametric/banned'
  ];
  for (const d of dirs) {
    fs.mkdirSync(path.join(tmpDir, '.mafw', d), { recursive: true });
  }
  fs.writeFileSync(
    path.join(tmpDir, '.mafw', 'parametric', 'base-skill-manifest.yaml'),
    'manifest_version: 1\nmerged_deltas: []\n'
  );
}

function writeBaseState(phase = 'REVIEWING', nextAction = 'CREATE_REVIEW_SESSION', loop = 1, maxLoops = 5) {
  fs.writeFileSync(
    path.join(tmpDir, '.mafw', 'state', '001-auth.json'),
    JSON.stringify({
      version: '2', goalId: '001-auth', loop,
      phase, lastPhase: 'EXECUTING_COMPLETE',
      currentWave: 1, totalWaves: 1,
      sessions: {}, nextAction,
      artifacts: {}, updatedAt: new Date().toISOString()
    }, null, 2)
  );
  fs.writeFileSync(
    path.join(tmpDir, '.mafw', 'requests', '001-auth.json'),
    JSON.stringify({
      version: '1', goalId: '001-auth', title: 'Auth',
      metrics: { test_coverage: { target: 80, unit: '%' } },
      boundaries: [], maxLoops, parallel: false,
      projectDir: tmpDir, mafwDir: path.join(tmpDir, '.mafw')
    }, null, 2)
  );
  fs.writeFileSync(path.join(tmpDir, '.mafw', 'goals', '001-auth.md'), '# Auth');
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-review-'));
  setupDirs();
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

test('mafwReviewEntry PASS with metrics met �?REVIEWING_COMPLETE', async () => {
  writeBaseState();

  await mafwReviewEntry({
    message: '/skill mafw-review 001-auth',
    llm: mockLlm(JSON.stringify({ verdict: 'PASS', reason: 'ok', metrics: { test_coverage: 85 } })),
    config: { model: 'test' },
    sessionId: 's1'
  });

  const state = JSON.parse(fs.readFileSync(path.join(tmpDir, '.mafw', 'state', '001-auth.json'), 'utf-8'));
  expect(state.nextAction).toBe('PASS');
  expect(state.phase).toBe('REVIEWING_COMPLETE');
  expect(fs.existsSync(path.join(tmpDir, '.mafw', 'reviews', '001-auth-loop1.md'))).toBe(true);
});

test('mafwReviewEntry FAIL with maxLoops reached �?REVIEWING_COMPLETE with error', async () => {
  writeBaseState('REVIEWING', 'CREATE_REVIEW_SESSION', 1, 1);

  await mafwReviewEntry({
    message: '/skill mafw-review 001-auth',
    llm: mockLlm(JSON.stringify({ verdict: 'FAIL', reason: 'not enough coverage', metrics: { test_coverage: 70 } })),
    config: { model: 'test' },
    sessionId: 's1'
  });

  const state = JSON.parse(fs.readFileSync(path.join(tmpDir, '.mafw', 'state', '001-auth.json'), 'utf-8'));
  expect(state.nextAction).toBe('FAIL');
  expect(state.error).toBe('max_loops_reached');
});

test('mafwReviewEntry FAIL with loop available �?REVIEWING_COMPLETE', async () => {
  writeBaseState('REVIEWING', 'CREATE_REVIEW_SESSION', 1, 3);

  await mafwReviewEntry({
    message: '/skill mafw-review 001-auth',
    llm: mockLlm(JSON.stringify({ verdict: 'FAIL', reason: 'retry', metrics: {} })),
    config: { model: 'test' },
    sessionId: 's1'
  });

  const state = JSON.parse(fs.readFileSync(path.join(tmpDir, '.mafw', 'state', '001-auth.json'), 'utf-8'));
  expect(state.nextAction).toBe('FAIL');
  expect(state.phase).toBe('REVIEWING_COMPLETE');
});

test('mafwReviewEntry handles non-JSON LLM response', async () => {
  writeBaseState();

  await mafwReviewEntry({
    message: '/skill mafw-review 001-auth',
    llm: mockLlm('Verdict: PASS\ncoverage: 85'),
    config: { model: 'test' },
    sessionId: 's1'
  });

  const state = JSON.parse(fs.readFileSync(path.join(tmpDir, '.mafw', 'state', '001-auth.json'), 'utf-8'));
  expect(state.nextAction).toBe('PASS');
  expect(state.phase).toBe('REVIEWING_COMPLETE');
});
