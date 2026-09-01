/**
 * P3a: explicit time anchoring — rule-based time window detection on queries
 * + soft recency boost on entries whose created_at falls inside the window.
 * Boost (not filter) per LongMemEval E.4: wrong hard filtering hurts recall.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { detectTimeWindow, applyTimeBoost } from '../../src/recall/time-anchor';

const NOW = new Date('2026-09-01T12:00:00Z');

describe('searchScored time anchoring integration', () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const { HarmonicIndexManager } = require('../../src/core/memory/harmonic-index');

  test('query time expression boosts in-window entries', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-time-'));
    fs.mkdirSync(path.join(dir, 'memory'), { recursive: true });
    const index = new HarmonicIndexManager(dir);
    const mk = (id: string, abstraction: string, created: string) => index.addEntry({
      id, type: 'semantic', primary_abstraction: abstraction, cue_anchors: [],
      memory_value: 'v', energy: 0.8, created_at: created, updated_at: created,
    } as any, 'semantic');

    // Both share the query token "kubernetes" — BM25 ties; date decides.
    mk('old-hit', 'kubernetes cluster setup notes', '2023-01-15T00:00:00Z');
    mk('recent-hit', 'kubernetes cluster setup notes', '2026-08-28T00:00:00Z');

    const results = index.searchScored('recent kubernetes cluster setup notes', 2, { now: NOW.toISOString() } as any);
    expect(results[0].entry.id).toBe('recent-hit');

    // Same query without a time expression → no date preference.
    const plain = index.searchScored('kubernetes cluster setup notes', 2, {});
    expect(plain.map(r => r.entry.id)).toEqual(['old-hit', 'recent-hit']);
  });
});

function within(win: { start: Date; end: Date }, iso: string): boolean {
  const t = new Date(iso).getTime();
  return t >= win.start.getTime() && t <= win.end.getTime();
}

describe('detectTimeWindow', () => {
  test('yesterday (zh/en)', () => {
    const win = detectTimeWindow('我昨天说了什么', NOW)!;
    expect(win).not.toBeNull();
    expect(within(win, '2026-08-31T10:00:00Z')).toBe(true);
    expect(within(win, '2026-08-30T10:00:00Z')).toBe(false);
    expect(within(detectTimeWindow('what did I say yesterday', NOW)!, '2026-08-31T10:00:00Z')).toBe(true);
  });

  test('today / 今天', () => {
    const win = detectTimeWindow('今天天气如何', NOW)!;
    expect(within(win, '2026-09-01T08:00:00Z')).toBe(true);
    expect(within(win, '2026-08-31T08:00:00Z')).toBe(false);
  });

  test('last week / 上周', () => {
    const win = detectTimeWindow('what did I recommend last week', NOW)!;
    expect(within(win, '2026-08-27T00:00:00Z')).toBe(true);
    expect(within(win, '2026-08-20T00:00:00Z')).toBe(false);
  });

  test('N days ago / 最近N天', () => {
    const win = detectTimeWindow('最近 3 天做了什么', NOW)!;
    expect(within(win, '2026-08-31T00:00:00Z')).toBe(true);
    expect(within(win, '2026-08-25T00:00:00Z')).toBe(false);
    expect(within(detectTimeWindow('3 days ago we met', NOW)!, '2026-08-29T00:00:00Z')).toBe(true);
  });

  test('last month / 上个月', () => {
    const win = detectTimeWindow('上个月的账单', NOW)!;
    expect(within(win, '2026-08-15T00:00:00Z')).toBe(true);
    expect(within(win, '2026-07-15T00:00:00Z')).toBe(false);
  });

  test('explicit month + year (en/zh/ISO-ish)', () => {
    expect(within(detectTimeWindow('What did Mel paint in July 2023?', NOW)!, '2023-07-10T00:00:00Z')).toBe(true);
    expect(within(detectTimeWindow('2023年7月的项目', NOW)!, '2023-07-10T00:00:00Z')).toBe(true);
    expect(within(detectTimeWindow('2023-07 记录', NOW)!, '2023-07-10T00:00:00Z')).toBe(true);
    expect(within(detectTimeWindow('7月的旅行', NOW)!, '2026-07-10T00:00:00Z')).toBe(true);
  });

  test('no time expression → null', () => {
    expect(detectTimeWindow('what is my favorite food', NOW)).toBeNull();
  });
});

describe('applyTimeBoost', () => {
  const win = { start: new Date('2026-08-25T00:00:00Z'), end: new Date('2026-09-01T00:00:00Z') };
  const entry = (id: string, created: string) => ({ entry: { id, created_at: created } as any, score: 1 });

  test('entries inside window get boosted, others untouched', () => {
    const scored = [
      entry('in-window', '2026-08-28T00:00:00Z'),
      entry('out-window', '2023-01-01T00:00:00Z'),
    ];
    const boosted = applyTimeBoost(scored, win, 1.5);
    expect(boosted[0].score).toBeCloseTo(1.5);
    expect(boosted[1].score).toBeCloseTo(1);
  });

  test('entry without created_at is untouched', () => {
    const boosted = applyTimeBoost([{ entry: { id: 'nodate' } as any, score: 2 }], win, 1.5);
    expect(boosted[0].score).toBe(2);
  });
});
