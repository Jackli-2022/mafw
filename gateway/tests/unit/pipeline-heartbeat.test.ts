/**
 * Pipeline heartbeat (arXiv:2609.05510: no enumerated failure mode may pass
 * unrecorded). Records last-run / last-success / counts per background
 * pipeline and flags pipelines that stopped producing successes.
 */
import { PipelineHeartbeat, HeartbeatKv, PipelineRunRecord } from '../../src/recall/pipeline-heartbeat';

const HOUR = 3600_000;

function memKv(): HeartbeatKv & { store: Map<string, PipelineRunRecord> } {
  const store = new Map<string, PipelineRunRecord>();
  return {
    store,
    get: (name) => store.get(name) ?? null,
    set: (name, rec) => { store.set(name, rec); },
  };
}

function fixedClock(start: number) {
  let now = start;
  return { now: () => now, advance: (ms: number) => { now += ms; } };
}

describe('PipelineHeartbeat', () => {
  test('records last run and last success on ok', () => {
    const kv = memKv();
    const clock = fixedClock(Date.parse('2026-09-23T00:00:00Z'));
    const hb = new PipelineHeartbeat(kv, { now: clock.now, intervals: { decay: 24 * HOUR } });

    hb.record('decay', { ok: true, counts: { decayed: 5 } });

    const snap = hb.snapshot(['decay'])[0];
    expect(snap.ok).toBe(true);
    expect(snap.lastRunAt).toBe('2026-09-23T00:00:00.000Z');
    expect(snap.lastSuccessAt).toBe('2026-09-23T00:00:00.000Z');
    expect(snap.lastCounts).toEqual({ decayed: 5 });
    expect(snap.stale).toBe(false);
  });

  test('failure keeps the previous lastSuccessAt', () => {
    const kv = memKv();
    const clock = fixedClock(Date.parse('2026-09-23T00:00:00Z'));
    const hb = new PipelineHeartbeat(kv, { now: clock.now, intervals: { decay: 24 * HOUR } });

    hb.record('decay', { ok: true });
    clock.advance(HOUR);
    hb.record('decay', { ok: false, error: 'boom' });

    const snap = hb.snapshot(['decay'])[0];
    expect(snap.ok).toBe(false);
    expect(snap.error).toBe('boom');
    expect(snap.lastSuccessAt).toBe('2026-09-23T00:00:00.000Z');
  });

  test('flags stale when no success within 2× the interval', () => {
    const kv = memKv();
    const clock = fixedClock(Date.parse('2026-09-23T00:00:00Z'));
    const hb = new PipelineHeartbeat(kv, { now: clock.now, intervals: { decay: 24 * HOUR } });

    hb.record('decay', { ok: true });
    clock.advance(24 * HOUR);
    expect(hb.snapshot(['decay'])[0].stale).toBe(false);
    clock.advance(24 * HOUR + 1);
    expect(hb.snapshot(['decay'])[0].stale).toBe(true);
  });

  test('never stale when the pipeline was never run (no false alarm before first run)', () => {
    const kv = memKv();
    const clock = fixedClock(Date.parse('2026-09-23T00:00:00Z'));
    const hb = new PipelineHeartbeat(kv, { now: clock.now, intervals: { decay: 24 * HOUR } });

    const snap = hb.snapshot(['decay'])[0];
    expect(snap.lastRunAt).toBeUndefined();
    expect(snap.stale).toBe(false);
  });

  test('pipeline without a configured interval is never stale', () => {
    const kv = memKv();
    const clock = fixedClock(Date.parse('2026-09-23T00:00:00Z'));
    const hb = new PipelineHeartbeat(kv, { now: clock.now, intervals: {} });

    hb.record('ad-hoc', { ok: true });
    clock.advance(1000 * HOUR);
    expect(hb.snapshot(['ad-hoc'])[0].stale).toBe(false);
  });

  test('sweep warns once per stale episode and clears after a success', () => {
    const kv = memKv();
    const clock = fixedClock(Date.parse('2026-09-23T00:00:00Z'));
    const warnings: string[] = [];
    const hb = new PipelineHeartbeat(kv, {
      now: clock.now,
      intervals: { decay: 24 * HOUR },
      onWarn: (m) => warnings.push(m),
    });

    hb.record('decay', { ok: true });
    clock.advance(3 * 24 * HOUR);

    expect(hb.sweep(['decay'])).toEqual(['decay']);
    expect(warnings).toHaveLength(1);
    // second sweep: already warned, no repeat
    expect(hb.sweep(['decay'])).toEqual([]);
    expect(warnings).toHaveLength(1);

    // recovery clears the warned state; a later stall warns again
    hb.record('decay', { ok: true });
    clock.advance(3 * 24 * HOUR);
    expect(hb.sweep(['decay'])).toEqual(['decay']);
    expect(warnings).toHaveLength(2);
  });
});
