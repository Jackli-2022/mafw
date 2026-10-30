import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { build } from 'esbuild';
import { computeCoverage, applyBehaviorResults } from '../../../src/runtime/coverage';
import { buildRuntimeContractManifest } from '../../../src/runtime/contract-manifest';

const REPO_ROOT = join(__dirname, '..', '..', '..', '..');
let createClaudeRuntime: any;
let bundleDir: string;

beforeAll(async () => {
  bundleDir = mkdtempSync(join(tmpdir(), 'claude-behavior-'));
  const outfile = join(bundleDir, 'runtime.js');
  await build({
    entryPoints: [join(REPO_ROOT, 'adapters/claude/src/runtime.ts')],
    bundle: true, platform: 'node', target: 'node22', format: 'cjs',
    outfile, logLevel: 'silent',
  });
  createClaudeRuntime = require(outfile).createClaudeRuntime;
}, 120_000);

afterAll(() => {
  if (bundleDir) rmSync(bundleDir, { recursive: true, force: true });
});

function fakeSdk(script: any[] = []) {
  const calls: any[] = [];
  return {
    calls,
    async query(args: any) {
      calls.push(args);
      const messages = script;
      return {
        async *[Symbol.asyncIterator]() { for (const m of messages) yield m; },
        interrupt() {},
      };
    },
    async listSessions() { return []; },
    async getSessionMessages() { return [{ uuid: 'a1', role: 'assistant', content: [{ type: 'text', text: 'ok' }] }]; },
  };
}

describe('claude adapter behavior gaps', () => {
  it('detects missing prompt usage and dropped media parts', async () => {
    const sdk = fakeSdk([{ type: 'result', subtype: 'success', session_id: 'S', usage: { input_tokens: 3 }, total_cost_usd: 0.01 }]);
    const rt = createClaudeRuntime({ sdk: sdk as any });
    const s = await rt.session.create({ directory: 'C:/tmp/proj' });
    const result = await rt.session.prompt({ sessionID: s.id, parts: [{ type: 'file', url: 'data:image/png;base64,AA==', mime: 'image/png' }] });
    await new Promise((r) => setTimeout(r, 10)); // prompt() returns before spawn() awaits query()
    expect(result.usage).toBeUndefined();
    expect(sdk.calls[0].prompt).toBe('');
    expect(rt.session.children).toBeDefined();
    expect(await rt.session.children({ sessionID: s.id })).toEqual([]);

    const coverage = computeCoverage({ rt, source: 'active' }, buildRuntimeContractManifest());
    const applied = applyBehaviorResults(coverage, [
      { surfaceId: 'prompt.result.usage', status: 'failed', detail: 'usage missing' },
      { surfaceId: 'prompt.parts.file', status: 'failed', detail: 'file part text dropped' },
    ]);
    expect(applied.behavioral?.failed).toEqual(expect.arrayContaining(['prompt.result.usage', 'prompt.parts.file']));
    expect(applied.behavioral?.details['prompt.result.usage']).toBe('usage missing');
  });

  it('detects the MCP stub in registerTools', async () => {
    const sdk = fakeSdk();
    const rt = createClaudeRuntime({ sdk: sdk as any });
    const s = await rt.session.create({ directory: 'C:/tmp/proj' });
    await rt.tools.registerTools(() => [{ name: 'x', description: 'x', parameters: {}, execute: async () => ({ text: 'ok' }) }]);
    await rt.session.prompt({ sessionID: s.id, message: 'hi' });
    await new Promise((r) => setTimeout(r, 10));
    const mcp = sdk.calls[0].options.mcpServers?.mafw;
    expect(mcp?.__mafwStub).toBe(true);
  });
});
