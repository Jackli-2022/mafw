import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const mockVectorSearch = jest.fn().mockResolvedValue([]);
let mockVectorSize = 0;

jest.mock('../../src/compression/vector-index', () => ({
  VectorIndex: jest.fn().mockImplementation(() => ({
    search: mockVectorSearch,
    get size() { return mockVectorSize; },
    addDocument: jest.fn(),
    addDocuments: jest.fn(),
    removeDocument: jest.fn(),
    clear: jest.fn(),
    save: jest.fn(),
    load: jest.fn(),
    init: jest.fn().mockResolvedValue(undefined),
  }))
}));

import MafwPlugin from '../../src/plugin';

let tmpDir: string;
let originalFetch: typeof global.fetch;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-v5-'));
  originalFetch = global.fetch;
  global.fetch = jest.fn().mockResolvedValue({ ok: false }) as any;
  mockVectorSearch.mockResolvedValue([]);
  mockVectorSize = 0;
});

afterEach(() => {
  global.fetch = originalFetch;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function setupGoalFiles(goalId = '001-auth') {
  const mafwDir = path.join(tmpDir, '.opencode', 'mafw');
  fs.mkdirSync(path.join(mafwDir, 'goals'), { recursive: true });
  fs.mkdirSync(path.join(mafwDir, 'state'), { recursive: true });
  fs.mkdirSync(path.join(mafwDir, 'reviews'), { recursive: true });
  fs.writeFileSync(
    path.join(mafwDir, 'goals', `${goalId}.md`),
    `# Goal Charter\n\n> Goal ID: ${goalId}\n\n## Objective\n\nBuild authentication system with JWT\n\n## Metrics\n- coverage: 80%\n\n## Boundaries\n- Must use RS256\n`,
    'utf-8'
  );
  fs.writeFileSync(
    path.join(mafwDir, 'state', `${goalId}.json`),
    JSON.stringify({ goalId, loop: 2, currentWave: 1, totalWaves: 3, phase: 'EXECUTING' }),
    'utf-8'
  );
}

function setupReviewFile(goalId = '001-auth', loop = 1, verdict = 'FAIL') {
  const mafwDir = path.join(tmpDir, '.opencode', 'mafw');
  const reviewsDir = path.join(mafwDir, 'reviews');
  if (!fs.existsSync(reviewsDir)) fs.mkdirSync(reviewsDir, { recursive: true });
  fs.writeFileSync(
    path.join(reviewsDir, `${goalId}-loop${loop}.md`),
    `# Review Loop ${loop}\n\nverdict: ${verdict}\n\nIssues found in authentication module.\n`,
    'utf-8'
  );
}

describe('mafw_search_hybrid tool', () => {

  test('returns categorized result structure', async () => {
    setupGoalFiles();
    const plugin = await MafwPlugin({ directory: tmpDir });
    const result = await plugin.tool.mafw_search_hybrid.execute({
      goalId: '001-auth',
      query: 'JWT authentication',
      maxResults: 10,
      tokenBudget: 2000
    });
    expect(result).toHaveProperty('semantic');
    expect(result).toHaveProperty('procedural');
    expect(result).toHaveProperty('parametric');
    expect(result).toHaveProperty('episodic');
    expect(result).toHaveProperty('totalTokens');
    expect(Array.isArray(result.semantic)).toBe(true);
    expect(Array.isArray(result.procedural)).toBe(true);
    expect(Array.isArray(result.parametric)).toBe(true);
    expect(Array.isArray(result.episodic)).toBe(true);
  });

  test('includes goal charter as semantic fact when no other results', async () => {
    setupGoalFiles();
    const plugin = await MafwPlugin({ directory: tmpDir });
    const result = await plugin.tool.mafw_search_hybrid.execute({
      goalId: '001-auth',
      query: 'JWT',
      maxResults: 5,
      tokenBudget: 5000
    });
    expect(result.semantic.length).toBeGreaterThanOrEqual(1);
    expect(result.semantic.some((s: any) => s.id === '001-auth-charter')).toBe(true);
    const charterFact = result.semantic.find((s: any) => s.id === '001-auth-charter') as any;
    expect(charterFact.facts[0]).toContain('Goal Charter');
  });

  test('includes episodic results from review files', async () => {
    setupGoalFiles('002-viz');
    setupReviewFile('002-viz', 1, 'FAIL');
    setupReviewFile('002-viz', 2, 'PASS');
    const plugin = await MafwPlugin({ directory: tmpDir });
    const result = await plugin.tool.mafw_search_hybrid.execute({
      goalId: '002-viz',
      query: 'visualization',
      maxResults: 10,
      tokenBudget: 5000
    });
    expect(result.episodic.length).toBeGreaterThanOrEqual(2);
    const verdicts = result.episodic.map((e: any) => e.verdict);
    expect(verdicts).toContain('FAIL');
    expect(verdicts).toContain('PASS');
  });

  test('applies token budget and returns totalTokens', async () => {
    setupGoalFiles('003-perf');
    const plugin = await MafwPlugin({ directory: tmpDir });
    const result = await plugin.tool.mafw_search_hybrid.execute({
      goalId: '003-perf',
      query: 'performance optimization',
      maxResults: 20,
      tokenBudget: 500
    });
    expect(result.totalTokens).toBeLessThanOrEqual(500);
  });

  test('returns empty arrays when no data exists', async () => {
    const plugin = await MafwPlugin({ directory: tmpDir });
    const result = await plugin.tool.mafw_search_hybrid.execute({
      goalId: 'nonexistent',
      query: 'nothing',
      maxResults: 10,
      tokenBudget: 2000
    });
    expect(result.semantic).toEqual([]);
    expect(result.procedural).toEqual([]);
    expect(result.parametric).toEqual([]);
    expect(result.episodic).toEqual([]);
    expect(result.totalTokens).toBe(0);
  });

  test('RRF fusion combines BM25 and Vector results', async () => {
    mockVectorSearch.mockResolvedValue([
      { id: 'vec-doc-1', score: 0.9, text: 'JWT token validation', metadata: { type: 'constraint' } }
    ]);
    mockVectorSize = 3;

    setupGoalFiles('004-rrf');
    const plugin = await MafwPlugin({ directory: tmpDir });
    const result = await plugin.tool.mafw_search_hybrid.execute({
      goalId: '004-rrf',
      query: 'JWT',
      maxResults: 10,
      tokenBudget: 5000
    });
    expect(result.parametric.length).toBeGreaterThanOrEqual(1);
    expect(result.parametric.some((p: any) => p.id === 'vec-vec-doc-1')).toBe(true);
    const vecResult = result.parametric.find((p: any) => p.id === 'vec-vec-doc-1') as any;
    expect(vecResult.content).toContain('JWT');
  });
});

describe('mafw_get_deltas tool', () => {

  test('returns deltas array', async () => {
    const plugin = await MafwPlugin({ directory: tmpDir });
    const result = await plugin.tool.mafw_get_deltas.execute({
      goalId: '001-auth',
      phase: 'plan'
    });
    expect(result).toHaveProperty('deltas');
    expect(Array.isArray(result.deltas)).toBe(true);
  });
});

describe('experimental.chat.messages.transform with V5 hybrid search', () => {

  test('injects <mafw-deltas>, <mafw-facts>, <mafw-history> when hybrid search has results', async () => {
    setupGoalFiles('005-hybrid');
    const plugin = await MafwPlugin({ directory: tmpDir });
    const output = {
      messages: [{ info: { role: 'user' }, parts: [{ text: '/skill mafw-plan 005-hybrid' }] }]
    };
    await (plugin as any)['experimental.chat.messages.transform']({}, output);
    const injected = output.messages[0].parts[0].text;
    expect(injected).toContain('<mafw-facts>');
    expect(injected).toContain('Goal Charter');
  });

  test('falls back to original message when no memories exist', async () => {
    const plugin = await MafwPlugin({ directory: tmpDir });
    const output = {
      messages: [{ info: { role: 'user' }, parts: [{ text: '/skill mafw-execute nonexistent' }] }]
    };
    await (plugin as any)['experimental.chat.messages.transform']({}, output);
    const injected = output.messages[0].parts[0].text;
    expect(injected).not.toContain('<mafw-facts>');
    expect(injected).not.toContain('<mafw-patterns>');
    expect(injected).not.toContain('<mafw-history>');
    expect(injected).not.toContain('<mafw-deltas>');
    expect(injected).toContain('/skill mafw-execute nonexistent');
  });

  test('preserves original message text at the end', async () => {
    setupGoalFiles('006-preserve');
    const plugin = await MafwPlugin({ directory: tmpDir });
    const output = {
      messages: [{ info: { role: 'user' }, parts: [{ text: '/skill mafw-plan 006-preserve' }] }]
    };
    await (plugin as any)['experimental.chat.messages.transform']({}, output);
    const injected = output.messages[0].parts[0].text;
    expect(injected.endsWith('/skill mafw-plan 006-preserve')).toBe(true);
  });

  test('does nothing when no user message found', async () => {
    const plugin = await MafwPlugin({ directory: tmpDir });
    const output = { messages: [] };
    await (plugin as any)['experimental.chat.messages.transform']({}, output);
  });
});
