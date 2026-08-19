import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { T1Store } from '../../gateway/src/core/memory/t1-store';
import { T1ToT2Compressor } from '../../gateway/src/core/memory/t1-to-t2-compressor';
import { CompressionPipeline } from '../../gateway/src/core/compression/compression-pipeline';
import { HarmonicIndexManager } from '../../gateway/src/core/memory/harmonic-index';
import { ObservationService, SESSION_TIMEOUT_MS } from '../../gateway/src/core/memory/observation-service';

describe('ObservationService', () => {
  let tmpDir: string;
  let store: T1Store;
  let service: ObservationService;

  beforeEach(async () => {
        global.fetch = jest.fn(async () => { throw new Error('ECONNREFUSED (test)') }) as unknown as typeof fetch;
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'obs-svc-'));
    fs.mkdirSync(path.join(tmpDir, 'memory'), { recursive: true });
    store = new T1Store(tmpDir);
    const pipeline = new CompressionPipeline({ baseDir: tmpDir });
    const index = new HarmonicIndexManager(tmpDir);
    const compressor = new T1ToT2Compressor(store, pipeline, index, tmpDir);
    service = new ObservationService({ t1Store: store, compressor });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('captures user input to T1 with turnID=1', () => {
    service.captureUserInput('sess-1', 'implement JWT auth with RS256');
    const tier1Dir = path.join(tmpDir, 'memory', 'tier1', 'default');
    const files = fs.readdirSync(tier1Dir).filter(f => f.endsWith('.jsonl'));
    expect(files.length).toBe(1);
    const lines = fs.readFileSync(path.join(tier1Dir, files[0]), 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]);
    expect(parsed.source).toBe('user_input');
    expect(parsed.content).toContain('JWT');
    expect(parsed.sessionID).toBe('sess-1');
    expect(parsed.turnID).toBe(1);
    expect(parsed.energy).toBe(0.8);
  });

  it('assigns same turnID to tool results and reply within same turn', () => {
    service.captureUserInput('sess-1', 'first prompt');
    service.captureToolResult('sess-1', 'Bash', 'npm test passed');
    service.captureAssistantReply('sess-1', 'Here is the fix');
    const all = store.readBySession('sess-1');
    expect(all).toHaveLength(3);
    for (const obs of all) {
      expect(obs.turnID).toBe(1);
    }
  });

  it('increments turnID on each user input', () => {
    service.captureUserInput('sess-1', 'prompt 1');
    service.captureAssistantReply('sess-1', 'reply 1');
    service.captureUserInput('sess-1', 'prompt 2');
    service.captureToolResult('sess-1', 'Bash', 'output 2');
    service.captureAssistantReply('sess-1', 'reply 2');
    const all = store.readBySession('sess-1');
    const turn1 = all.filter(o => o.turnID === 1);
    const turn2 = all.filter(o => o.turnID === 2);
    expect(turn1).toHaveLength(2);
    expect(turn2).toHaveLength(3);
  });

  it('captures user input to T1', () => {
    service.captureUserInput('sess-1', 'implement JWT auth with RS256');
    const lines = store.readBySession('sess-1');
    expect(lines).toHaveLength(1);
    expect(lines[0].sessionID).toBe('sess-1');
    expect(lines[0].energy).toBe(0.8);
  });

  it('captures assistant reply to T1', () => {
    service.captureAssistantReply('sess-1', 'Here is the JWT implementation...');
    const lines = store.readBySession('sess-1');
    expect(lines).toHaveLength(1);
    expect(lines[0].source).toBe('assistant_reply');
    expect(lines[0].energy).toBe(0.75);
  });

  it('captures tool result to T1', () => {
    service.captureToolResult('sess-1', 'Bash', 'npm test passed', 'npm run test', undefined, 1);
    const lines = store.readBySession('sess-1');
    expect(lines).toHaveLength(1);
    expect(lines[0].source).toBe('tool_result');
    expect(lines[0].toolName).toBe('Bash');
    expect(lines[0].loopNum).toBe(1);
    expect(lines[0].energy).toBe(0.7);
  });

  it('truncates long content', () => {
    const long = 'x'.repeat(5000);
    service.captureUserInput('sess-1', long);
    const lines = store.readBySession('sess-1');
    expect(lines[0].content.length).toBeLessThan(2500);
    expect(lines[0].content).toContain('[truncated]');
  });

  it('captures tool result with args and output', () => {
    service.captureToolResult('sess-1', 'Read', 'file contents here', 'src/foo.ts');
    const lines = store.readBySession('sess-1');
    expect(lines[0].content).toContain('[Read]');
    expect(lines[0].content).toContain('src/foo.ts');
    expect(lines[0].content).toContain('file contents here');
  });

  it('skips empty user input', () => {
    service.captureUserInput('sess-1', '');
    expect(store.readBySession('sess-1')).toHaveLength(0);
  });

  it('skips empty assistant reply', () => {
    service.captureAssistantReply('sess-1', '');
    expect(store.readBySession('sess-1')).toHaveLength(0);
  });

  it('skips empty tool result', () => {
    service.captureToolResult('sess-1', 'Bash', '', '');
    expect(store.readBySession('sess-1')).toHaveLength(0);
  });

  it('endSession compresses session within timeout', async () => {
    for (let i = 0; i < 3; i++) {
      service.captureUserInput('sess-1', `prompt ${i}`);
      service.captureToolResult('sess-1', 'Bash', `output ${i}`);
      service.captureAssistantReply('sess-1', `reply ${i}`);
    }
    expect(store.hasSession('sess-1')).toBe(true);
    await service.endSession('sess-1');
    // Units are written to OKF files, verify via harmonic index
    const idxPath = path.join(tmpDir, 'memory', '.harmonic_index.json');
    expect(fs.existsSync(idxPath)).toBe(true);
    const idx = JSON.parse(fs.readFileSync(idxPath, 'utf-8'));
    expect(idx.entries.length).toBeGreaterThan(0);
    expect(store.hasSession('sess-1')).toBe(false);
  });

  it('endSession clears session tracking', async () => {
    service.captureUserInput('sess-1', 'hello');
    await service.endSession('sess-1');
    service.captureUserInput('sess-1', 'world');
    service.captureAssistantReply('sess-1', 'reply');
    const all = store.readBySession('sess-1');
    expect(all).toHaveLength(2);
    expect(all[0].turnID).toBe(1);
  });
});
