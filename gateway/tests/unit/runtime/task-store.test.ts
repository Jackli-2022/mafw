import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { TaskStore } from '../../../src/runtime/task-store';
import type { TaskEntity } from '../../../src/runtime/task-service';

const task = (id: string): TaskEntity => ({
  id, kind: 'shell', parentSessionID: 'p1', shellID: 'sh1', title: 't',
  status: 'working', createdAt: 1, updatedAt: 1,
});

describe('TaskStore', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-task-store-')); });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('saves atomically and loads tasks', () => {
    const store = new TaskStore(dir);
    store.save(task('t1'));
    expect(store.loadAll()).toEqual([task('t1')]);
    expect(fs.existsSync(path.join(dir, 't1.json.tmp'))).toBe(false);
  });

  it('skips corrupt/invalid files instead of throwing', () => {
    const store = new TaskStore(dir);
    store.save(task('t1'));
    fs.writeFileSync(path.join(dir, 'bad.json'), '{broken', 'utf-8');
    fs.writeFileSync(path.join(dir, 'unknown.json'), JSON.stringify({ id: 'x', kind: 'nope' }), 'utf-8');
    expect(store.loadAll().map(t => t.id)).toEqual(['t1']);
  });

  it('returns empty when the directory is missing', () => {
    expect(new TaskStore(path.join(dir, 'missing')).loadAll()).toEqual([]);
  });
});
