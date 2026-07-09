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
  const mafwDir = path.join(tmpDir, '.mafw');
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
  const mafwDir = path.join(tmpDir, '.mafw');
  const reviewsDir = path.join(mafwDir, 'reviews');
  if (!fs.existsSync(reviewsDir)) fs.mkdirSync(reviewsDir, { recursive: true });
  fs.writeFileSync(
    path.join(reviewsDir, `${goalId}-loop${loop}.md`),
    `# Review Loop ${loop}\n\nverdict: ${verdict}\n\nIssues found in authentication module.\n`,
    'utf-8'
  );
}

describe('experimental.chat.messages.transform with V5 hybrid search', () => {

  test('injects <mafw-context> when goal state exists', async () => {
    setupGoalFiles('005-hybrid');
    const plugin = await MafwPlugin({ directory: tmpDir });
    const output = {
      messages: [{ info: { role: 'user' }, parts: [{ text: '/skill mafw-plan 005-hybrid' }] }]
    };
    await (plugin as any)['experimental.chat.messages.transform']({}, output);
    const injected = output.messages[0].parts[0].text;
    expect(injected).toContain('<mafw-context>');
    expect(injected).toContain('/skill mafw-plan 005-hybrid');
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
