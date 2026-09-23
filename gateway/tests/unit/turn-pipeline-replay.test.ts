import { priorKnowledgeFor, priorKnowledgeBlock } from '../../src/recall/turn-pipeline';
import { HarmonicIndexManager } from '../../src/core/memory/harmonic-index';
import { HarmonicUnit } from '../../src/core/memory/harmonic-types';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

function unit(id: string, abstraction: string, sessionId: string, type = 'semantic'): HarmonicUnit {
  const now = new Date().toISOString();
  return { id, type, primary_abstraction: abstraction, cue_anchors: ['kubernetes', 'deploy'], memory_value: abstraction, energy: 0.8, created_at: now, updated_at: now, source_session_id: sessionId } as HarmonicUnit;
}

describe('priorKnowledgeFor', () => {
  test('召回跨会话相关记忆，排除本会话与 episodic', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'replay-'));
    fs.mkdirSync(path.join(dir, 'memory'), { recursive: true });
    const index = new HarmonicIndexManager(dir);
    index.addEntry(unit('a', 'kubernetes deployment rollout steps', 'other-session'), 'semantic');
    index.addEntry(unit('b', 'kubernetes deployment narrative', 'other-session', 'episodic'), 'episodic');
    index.addEntry(unit('c', 'kubernetes deployment current', 's1'), 'semantic');
    const out = priorKnowledgeFor(index, 's1', 'kubernetes deployment', 5);
    const ids = out.map(e => e.id);
    expect(ids).toContain('a');
    expect(ids).not.toContain('b');
    expect(ids).not.toContain('c');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('k<=0 或空 query 返回空', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'replay-'));
    const index = new HarmonicIndexManager(dir);
    expect(priorKnowledgeFor(index, 's1', 'q', 0)).toEqual([]);
    expect(priorKnowledgeFor(index, 's1', '  ', 5)).toEqual([]);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('priorKnowledgeBlock', () => {
  test('渲染 id + 摘要，超预算截断', () => {
    const entries = [
      { id: 'm1', primary_abstraction: 'first' },
      { id: 'm2', primary_abstraction: 'second' },
    ] as any;
    const block = priorKnowledgeBlock(entries, 1000);
    expect(block).toContain('m1');
    expect(block).toContain('reconcile');
    const tiny = priorKnowledgeBlock(entries, 12);
    expect(tiny === '' || (tiny.includes('m1') && !tiny.includes('m2'))).toBe(true);
  });

  test('空数组返回空串', () => {
    expect(priorKnowledgeBlock([], 1000)).toBe('');
  });
});
