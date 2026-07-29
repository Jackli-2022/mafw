import { reviewNode, parseReviewVerdict } from '../../../gateway/src/core/langgraph/nodes/review.node';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

describe('parseReviewVerdict', () => {
  it('parses PASS verdict from JSON', () => {
    const result = parseReviewVerdict(
      '{"verdict":"PASS","reason":"All tests pass","metrics":{"coverage":90}}',
    );
    expect(result.verdict).toBe('PASS');
    expect(result.feedback).toContain('All tests pass');
  });

  it('parses FAIL verdict from JSON', () => {
    const result = parseReviewVerdict(
      '{"verdict":"FAIL","reason":"Coverage below 80%","metrics":{"coverage":65}}',
    );
    expect(result.verdict).toBe('FAIL');
  });

  it('falls back to keyword matching when JSON is malformed', () => {
    const result = parseReviewVerdict('PASS: everything looks good');
    expect(result.verdict).toBe('PASS');
  });

  it('returns ERROR on empty content', () => {
    const result = parseReviewVerdict('');
    expect(result.verdict).toBe('ERROR');
  });

  it('returns FAIL on unrecognized content', () => {
    const result = parseReviewVerdict('some ambiguous text');
    expect(result.verdict).toBe('FAIL');
  });
});

function makeState(overrides: Record<string, any> = {}): any {
  return {
    goalId: 'test-goal',
    projectDir: '/tmp/test',
    mafwDir: '/tmp/test/.mafw',
    round: 1,
    maxRounds: 3,
    wavePlanPath: null,
    receiptPath: null,
    reviewVerdict: 'FAIL' as const,
    reviewReportPath: null,
    reviewFeedback: '',
    lastError: null,
    phase: null,
    pendingQuestion: null,
    sameSigCount: 0,
    stateVersion: 0,
    ...overrides,
  };
}

function makeServices(): any {
  const mockCreate = jest.fn().mockResolvedValue({ id: 'session-1' });
  const mockPrompt = jest.fn().mockResolvedValue(undefined);
  const mockDelete = jest.fn().mockResolvedValue(undefined);
  return {
    client: {
      session: {
        create: mockCreate,
        promptAsync: mockPrompt,
        delete: mockDelete,
      },
    },
    syncToFile: jest.fn(),
  };
}

describe('reviewNode', () => {
  let tmpDir: string;
  let mafwDir: string;
  let state: any;
  let services: any;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rev-node-'));
    mafwDir = path.join(tmpDir, '.mafw');
    fs.mkdirSync(path.join(mafwDir, 'reviews'), { recursive: true });
    state = makeState({ projectDir: tmpDir, mafwDir });
    services = makeServices();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns ERROR when review report missing', async () => {
    const result = await reviewNode(state, services);
    expect(result.reviewVerdict).toBe('ERROR');
    expect(result.lastError).toContain('not found');
  });

  it('returns PASS verdict when review says pass', async () => {
    const reviewPath = path.join(mafwDir, 'reviews', 'test-goal-loop1.md');
    fs.writeFileSync(reviewPath, '{"verdict":"PASS","reason":"Great job!"}', 'utf-8');
    const result = await reviewNode(state, services);
    expect(result.reviewVerdict).toBe('PASS');
    expect(result.reviewFeedback).toContain('Great job!');
  });

  it('returns FAIL and tracks sameSigCount on first fail', async () => {
    const reviewPath = path.join(mafwDir, 'reviews', 'test-goal-loop1.md');
    fs.writeFileSync(reviewPath, '{"verdict":"FAIL","reason":"Missing error handling"}', 'utf-8');
    const result = await reviewNode(state, services);
    expect(result.reviewVerdict).toBe('FAIL');
    expect(result.reviewFeedback).toContain('Missing error handling');
    expect(result.sameSigCount).toBe(1);
    expect(result.pendingQuestion).toBeUndefined();
  });

  it('sets pendingQuestion on second consecutive same-signature fail', async () => {
    const reviewPath = path.join(mafwDir, 'reviews', 'test-goal-loop2.md');
    fs.writeFileSync(reviewPath, '{"verdict":"FAIL","reason":"Missing error handling"}', 'utf-8');
    state.reviewFeedback = 'Missing error handling';
    state.round = 2;
    state.sameSigCount = 1;
    const result = await reviewNode(state, services);
    expect(result.reviewVerdict).toBe('FAIL');
    expect(result.pendingQuestion).not.toBeUndefined();
    expect(result.pendingQuestion!.node).toBe('review');
    expect(result.pendingQuestion!.questions[0]).toContain('Missing error handling');
    expect(result.sameSigCount).toBe(2);
  });

  it('resets sameSigCount on different feedback', async () => {
    const reviewPath = path.join(mafwDir, 'reviews', 'test-goal-loop1.md');
    fs.writeFileSync(reviewPath, '{"verdict":"FAIL","reason":"Different issue now"}', 'utf-8');
    state.reviewFeedback = 'Old issue';
    state.sameSigCount = 2;
    const result = await reviewNode(state, services);
    expect(result.reviewVerdict).toBe('FAIL');
    expect(result.pendingQuestion).toBeUndefined();
    expect(result.sameSigCount).toBe(1);
  });
});
