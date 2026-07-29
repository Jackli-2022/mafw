import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { T1Store } from '../../src/memory/t1-store';

describe('T1Store', () => {
  let tmpDir: string;
  let store: T1Store;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 't1-test-'));
    fs.mkdirSync(path.join(tmpDir, 'memory', 'tier1'), { recursive: true });
    store = new T1Store(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes observation as JSONL', () => {
    store.append({ content: 'test observation', type: 'tool_use', loopNum: 1, timestamp: 100 });
    const spiralFiles = fs.readdirSync(path.join(tmpDir, 'memory', 'tier1', 'default'));
    expect(spiralFiles.length).toBe(1);
    expect(spiralFiles[0]).toMatch(/^spiral-\d+\.jsonl$/);
    const content = fs.readFileSync(path.join(tmpDir, 'memory', 'tier1', 'default', spiralFiles[0]), 'utf-8');
    const lines = content.trim().split('\n');
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]);
    expect(parsed.content).toBe('test observation');
    expect(parsed.type).toBe('tool_use');
  });

  it('appends multiple observations as separate JSONL lines', () => {
    store.appendBatch([
      { content: 'obs1', type: 'tool_use' },
      { content: 'obs2', type: 'file_edit' },
      { content: 'obs3', type: 'error' },
    ]);
    const spiralFiles = fs.readdirSync(path.join(tmpDir, 'memory', 'tier1', 'default'));
    expect(spiralFiles.length).toBe(1);
    const content = fs.readFileSync(path.join(tmpDir, 'memory', 'tier1', 'default', spiralFiles[0]), 'utf-8');
    const lines = content.trim().split('\n');
    expect(lines).toHaveLength(3);
  });

  it('stores observations per goalId in separate directories', () => {
    store.append({ content: 'goal-a obs' }, 'goal-a');
    store.append({ content: 'goal-b obs' }, 'goal-b');
    const goalADir = path.join(tmpDir, 'memory', 'tier1', 'goal-a');
    const goalBDir = path.join(tmpDir, 'memory', 'tier1', 'goal-b');
    expect(fs.existsSync(goalADir)).toBe(true);
    expect(fs.existsSync(goalBDir)).toBe(true);
    expect(store.getCount('goal-a')).toBe(1);
    expect(store.getCount('goal-b')).toBe(1);
  });

  it('tracks observation count', () => {
    expect(store.getCount()).toBe(0);
    store.append({ content: 'a' });
    store.append({ content: 'b' });
    expect(store.getCount()).toBe(2);
    store.append({ content: 'c' }, 'other');
    expect(store.getCount()).toBe(2);
    expect(store.getCount('other')).toBe(1);
  });

  it('loads existing counts from disk on init', () => {
    store.append({ content: 'x' });
    store.append({ content: 'y' });
    const store2 = new T1Store(tmpDir);
    expect(store2.getCount()).toBe(2);
  });

  it('readBySession returns matching observations', () => {
    store.append({ content: 'session1 obs', sessionID: 'sess-1' });
    store.append({ content: 'session2 obs', sessionID: 'sess-2' });
    store.append({ content: 'session1 again', sessionID: 'sess-1' });
    const s1 = store.readBySession('sess-1');
    expect(s1).toHaveLength(2);
    expect(s1[0].content).toBe('session1 obs');
  });

  it('hasSession returns true/false', () => {
    expect(store.hasSession('sess-1')).toBe(false);
    store.append({ content: 'x', sessionID: 'sess-1' });
    expect(store.hasSession('sess-1')).toBe(true);
  });

  it('clearSession removes only matching session', () => {
    store.append({ content: 'sess1', sessionID: 'sess-1' });
    store.append({ content: 'sess2', sessionID: 'sess-2' });
    store.clearSession('sess-1');
    expect(store.readBySession('sess-1')).toHaveLength(0);
    expect(store.readBySession('sess-2')).toHaveLength(1);
  });

  it('readAll returns all observations', () => {
    store.append({ content: 'first', type: 'tool_use' });
    store.append({ content: 'second', type: 'error' });
    const all = store.readAll();
    expect(all).toHaveLength(2);
    expect(all[0].content).toBe('first');
    expect(all[1].content).toBe('second');
  });

  it('readAll returns empty array for unknown goal', () => {
    expect(store.readAll('nonexistent')).toEqual([]);
  });

  it('clear removes all spiral files and resets count', () => {
    store.append({ content: 'a' });
    store.append({ content: 'b' });
    store.clear();
    expect(store.getCount()).toBe(0);
    const dir = path.join(tmpDir, 'memory', 'tier1', 'default');
    const files = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
    expect(files.filter(f => f.endsWith('.jsonl'))).toHaveLength(0);
  });

  it('rotates to new spiral file when current exceeds 1000 lines', () => {
    for (let i = 0; i < 1001; i++) {
      store.append({ content: `obs-${i}` });
    }
    const dir = path.join(tmpDir, 'memory', 'tier1', 'default');
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.jsonl'));
    expect(files.length).toBe(2);
  });

  it('handles goalId passed in observation object', () => {
    const obs = { content: 'test', goalId: 'from-obs' };
    store.append(obs);
    expect(store.getCount('from-obs')).toBe(1);
    expect(fs.existsSync(path.join(tmpDir, 'memory', 'tier1', 'from-obs'))).toBe(true);
  });
});
