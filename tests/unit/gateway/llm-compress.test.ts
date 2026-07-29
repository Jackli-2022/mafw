import { DashboardAPI } from '../../../gateway/src/dashboard/api';
import * as fs from 'fs';
import * as path from 'path';
import os from 'os';

describe('DashboardAPI llmCompress', () => {
  let api: DashboardAPI;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'llm-test-'));
    api = new DashboardAPI(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns fallback result when no SDK client available', async () => {
    const result = await api.llmCompress(['test observation']);
    expect(result).toHaveProperty('narrative');
    expect(result).toHaveProperty('facts');
    expect(result).toHaveProperty('concepts');
    expect(result).toHaveProperty('energy');
    expect(result.narrative).toContain('Compression failed');
  });

  it('returns fallback result with SDK client when session fails', async () => {
    const mockClient = { session: { create: async () => { throw new Error('no serve'); } } };
    const apiWithClient = new DashboardAPI(tmpDir, undefined, mockClient);
    const result = await apiWithClient.llmCompress(['test observation']);
    expect(result).toHaveProperty('narrative');
    expect(result.energy).toBe(0.3);
  });

  it('parses LLM JSON response correctly', () => {
    const text = '{"narrative":"test","facts":["a","b"],"concepts":["c"],"energy":0.7}';
    const result = api.parseLLMResponse(text);
    expect(result.narrative).toBe('test');
    expect(result.facts).toEqual(['a', 'b']);
    expect(result.concepts).toEqual(['c']);
    expect(result.energy).toBe(0.7);
  });

  it('handles invalid JSON gracefully', () => {
    const result = api.parseLLMResponse('not json');
    expect(result).toHaveProperty('narrative');
    expect(result.facts).toEqual([]);
  });
});
