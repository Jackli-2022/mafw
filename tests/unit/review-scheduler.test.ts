import * as fs from 'fs';
import * as path from 'path';
import os from 'os';
import { HarmonicIndexManager } from '../../gateway/src/core/memory/harmonic-index';
import { ReviewScheduler, getNextInterval } from '../../gateway/src/core/memory/review-scheduler';

describe('getNextInterval', () => {
  it('returns 1 for reviewCount 0', () => {
    expect(getNextInterval(0)).toBe(1);
  });

  it('returns 2 for reviewCount 1', () => {
    expect(getNextInterval(1)).toBe(2);
  });

  it('returns 4 for reviewCount 2', () => {
    expect(getNextInterval(2)).toBe(4);
  });

  it('returns 8 for reviewCount 3', () => {
    expect(getNextInterval(3)).toBe(8);
  });

  it('returns 16 for reviewCount 4', () => {
    expect(getNextInterval(4)).toBe(16);
  });
});

describe('ReviewScheduler', () => {
  let tmpDir: string;
  let memoryDir: string;
  let scheduler: ReviewScheduler;

  function writeIndex(entries: any[]) {
    const idx = { version: 1, updated_at: new Date().toISOString(), entries };
    fs.writeFileSync(
      path.join(memoryDir, '.harmonic_index.json'),
      JSON.stringify(idx, null, 2),
      'utf-8'
    );
  }

  function createScheduler() {
    const manager = new HarmonicIndexManager(tmpDir);
    scheduler = new ReviewScheduler(manager, tmpDir);
    return scheduler;
  }

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-test-'));
    memoryDir = path.join(tmpDir, 'memory');
    fs.mkdirSync(memoryDir, { recursive: true });
  });

  afterEach(() => {
    if (scheduler) scheduler.stop();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates review tasks for overdue entries', () => {
    const now = new Date();
    writeIndex([{
      id: 'mem_overdue',
      primary_abstraction: 'JWT token config',
      cue_anchors: ['jwt'],
      type: 'semantic',
      tier: 'tier3',
      energy: 0.8
    }]);

    const s = createScheduler();
    (s as any).now = () => now.getTime();
    (s as any).calcDaysSince = () => 3;
    s['tick']();

    const queue = s.getReviewQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0].unitId).toBe('mem_overdue');
    expect(queue[0].primaryAbstraction).toBe('JWT token config');
  });

  it('skips entries with energy < 0.5', () => {
    writeIndex([{
      id: 'mem_low_energy',
      primary_abstraction: 'Old config',
      cue_anchors: ['old'],
      type: 'semantic',
      tier: 'tier3',
      energy: 0.3
    }]);

    const s = createScheduler();
    s['tick']();

    const queue = s.getReviewQueue();
    expect(queue).toHaveLength(0);
  });

  it('limits queue to top 3 by overdue', () => {
    const now = new Date();
    const entries = [];
    for (let i = 0; i < 5; i++) {
      entries.push({
        id: `mem_${i}`,
        primary_abstraction: `Entry ${i}`,
        cue_anchors: [],
        type: 'semantic',
        tier: 'tier3',
        energy: 0.9
      });
    }
    writeIndex(entries);

    const s = createScheduler();
    (s as any).now = () => now.getTime();
    (s as any).calcDaysSince = (entry: any) => {
      const idx = parseInt(entry.id.split('_')[1]);
      return 10 + idx;
    };
    s['tick']();

    const queue = s.getReviewQueue();
    expect(queue).toHaveLength(3);
    expect(queue[0].overdue).toBeGreaterThanOrEqual(queue[1].overdue);
    expect(queue[1].overdue).toBeGreaterThanOrEqual(queue[2].overdue);
  });

  it('writes review queue to .review_queue.json', () => {
    const now = new Date();
    writeIndex([{
      id: 'mem_file',
      primary_abstraction: 'File test',
      cue_anchors: [],
      type: 'semantic',
      tier: 'tier3',
      energy: 0.9
    }]);

    const s = createScheduler();
    (s as any).now = () => now.getTime();
    (s as any).calcDaysSince = () => 3;
    s['tick']();

    const queuePath = path.join(memoryDir, '.review_queue.json');
    expect(fs.existsSync(queuePath)).toBe(true);
    const content = JSON.parse(fs.readFileSync(queuePath, 'utf-8'));
    expect(content).toHaveLength(1);
    expect(content[0].unitId).toBe('mem_file');
  });
});
