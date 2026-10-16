/**
 * distinct_from（S4 pattern separation）持久化契约：
 * route-write 的 separate 分支写入该标记（"与这些相似条目刻意保持区分，勿合并"），
 * 此前它既不入 OKF frontmatter 也不进 index → 写后即丢、无消费者。
 * 修复：OKF 往返 + index entry 携带 + consolidation 候选池尊重该标记。
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { buildOKF } from '../../../src/memory/okf-writer';
import { parseOKF } from '../../../src/memory/okf-parser';
import { HarmonicIndexManager } from '../../../src/core/memory/harmonic-index';
import { HarmonicUnit } from '../../../src/core/memory/harmonic-types';

const unit = (over: Partial<HarmonicUnit> = {}): HarmonicUnit => ({
  id: 'mem_d1',
  type: 'semantic',
  primary_abstraction: 'distinct pair marker',
  cue_anchors: ['distinct'],
  memory_value: 'value',
  energy: 0.8,
  created_at: '2026-10-13T00:00:00Z',
  updated_at: '2026-10-13T00:00:00Z',
  ...over,
});

describe('distinct_from persistence', () => {
  test('buildOKF writes the marker and parseOKF round-trips it', () => {
    const u = unit({ distinct_from: ['mem_other'] });
    const okf = buildOKF(u);
    expect(okf).toContain('distinct_from');
    const parsed = parseOKF(okf);
    expect(parsed.unit.distinct_from).toEqual(['mem_other']);
  });

  test('absent/empty marker is omitted from frontmatter', () => {
    expect(buildOKF(unit())).not.toContain('distinct_from');
    expect(buildOKF(unit({ distinct_from: [] }))).not.toContain('distinct_from');
  });

  test('addEntry persists distinct_from into the index entry', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-distinct-'));
    fs.mkdirSync(path.join(dir, 'memory'), { recursive: true });
    const mgr = new HarmonicIndexManager(dir);
    mgr.addEntry(unit({ distinct_from: ['mem_other'] }), 'semantic');
    const entry = mgr.getIndex().entries.find((e) => e.id === 'mem_d1') as any;
    expect(entry.distinct_from).toEqual(['mem_other']);
  });
});
