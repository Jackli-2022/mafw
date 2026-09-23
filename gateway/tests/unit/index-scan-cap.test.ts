import { formatIndexForScan } from '../../src/recall/index-scan';
import { HarmonicIndexManager } from '../../src/core/memory/harmonic-index';
import { HarmonicUnit } from '../../src/core/memory/harmonic-types';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

function unit(id: string, abstraction: string): HarmonicUnit {
  const now = new Date().toISOString();
  return { id, type: 'semantic', primary_abstraction: abstraction, cue_anchors: [], memory_value: abstraction, energy: 0.8, created_at: now, updated_at: now } as HarmonicUnit;
}

describe('formatIndexForScan budget cap', () => {
  test('超过 maxChars 时按预算截断（保留最近条目）', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-cap-'));
    fs.mkdirSync(path.join(dir, 'memory'), { recursive: true });
    const index = new HarmonicIndexManager(dir);
    for (let i = 0; i < 200; i++) index.addEntry(unit('m' + i, 'entry number ' + i + ' with some words'), 'semantic');
    const capped = formatIndexForScan(index, 2000);
    expect(capped.length).toBeLessThanOrEqual(2000 + 20); // + header slack
    expect(capped).toContain('m199'); // most recent kept
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('maxChars<=0 关闭 cap（全量）', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-cap-'));
    fs.mkdirSync(path.join(dir, 'memory'), { recursive: true });
    const index = new HarmonicIndexManager(dir);
    for (let i = 0; i < 200; i++) index.addEntry(unit('m' + i, 'entry number ' + i), 'semantic');
    const full = formatIndexForScan(index, 0);
    expect(full.length).toBeGreaterThan(2000);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
