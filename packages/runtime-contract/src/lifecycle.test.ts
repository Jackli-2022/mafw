import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isActiveLifecycle,
  isTerminalLifecycle,
  normalizeLifecycle,
  unknownLifecycle,
} from './lifecycle.ts';

const fallback = { observedAt: 1000, epoch: 'epoch-1' };

test('missing lifecycle is unknown, never active', () => {
  const lifecycle = normalizeLifecycle(undefined, fallback);
  assert.equal(lifecycle.phase, 'unknown');
  assert.equal(lifecycle.reason, 'missing-lifecycle');
  assert.equal(lifecycle.observedAt, 1000);
  assert.equal(lifecycle.epoch, 'epoch-1');
  assert.equal(isActiveLifecycle(lifecycle), false);
});

test('valid settled lifecycle keeps outcome and observation', () => {
  const lifecycle = normalizeLifecycle({
    phase: 'settled',
    outcome: 'completed',
    observedAt: 2000,
    terminalAt: 1900,
    revision: 3,
    epoch: 'epoch-2',
    authority: 'runtime',
  }, fallback);
  assert.equal(lifecycle.phase, 'settled');
  assert.equal(lifecycle.outcome, 'completed');
  assert.equal(lifecycle.terminalAt, 1900);
  assert.equal(lifecycle.revision, 3);
  assert.equal(lifecycle.epoch, 'epoch-2');
  assert.equal(lifecycle.authority, 'runtime');
  assert.equal(isTerminalLifecycle(lifecycle), true);
});

test('waiting is not active and keeps what it waits on', () => {
  const lifecycle = normalizeLifecycle({
    phase: 'waiting',
    waitingOn: ['children', 'background'],
    observedAt: 3000,
  }, fallback);
  assert.equal(lifecycle.phase, 'waiting');
  assert.deepEqual(lifecycle.waitingOn, ['children', 'background']);
  assert.equal(isActiveLifecycle(lifecycle), false);
});

test('unknown reasons are preserved; invalid shapes fall back to unknown', () => {
  const flagged = normalizeLifecycle({
    phase: 'unknown',
    reason: 'legacy-no-idle',
    observedAt: 4000,
  }, fallback);
  assert.equal(flagged.phase, 'unknown');
  assert.equal(flagged.reason, 'legacy-no-idle');

  const invalid = normalizeLifecycle({ phase: 'running' }, fallback);
  assert.equal(invalid.phase, 'unknown');
  assert.equal(invalid.reason, 'invalid-phase');

  const settledWithoutOutcome = normalizeLifecycle({ phase: 'settled' }, fallback);
  assert.equal(settledWithoutOutcome.phase, 'unknown');
  assert.equal(settledWithoutOutcome.reason, 'settled-without-outcome');
});

test('dsh continuation states keep waiting distinct from active', () => {
  const dsh = (status: 'running' | 'waiting' | 'settled') => normalizeLifecycle({
    phase: status === 'running' ? 'active' : status === 'waiting' ? 'waiting' : 'settled',
    ...(status === 'settled' ? { outcome: 'completed' as const } : {}),
    ...(status === 'waiting' ? { waitingOn: ['children'] } : {}),
    observedAt: 6000,
  }, fallback);
  assert.equal(dsh('running').phase, 'active');
  assert.equal(dsh('waiting').phase, 'waiting');
  assert.deepEqual(dsh('waiting').waitingOn, ['children']);
  assert.equal(dsh('settled').phase, 'settled');
  assert.equal(dsh('settled').outcome, 'completed');
  assert.equal(isActiveLifecycle(dsh('waiting')), false);
});

test('unknownLifecycle requires an explicit reason and observation', () => {
  const lifecycle = unknownLifecycle({
    observedAt: 5000,
    epoch: 'epoch-3',
    reason: 'runtime-unreachable',
    lastActivityAt: 4500,
  });
  assert.equal(lifecycle.phase, 'unknown');
  assert.equal(lifecycle.reason, 'runtime-unreachable');
  assert.equal(lifecycle.lastActivityAt, 4500);
  assert.equal(lifecycle.authority, 'adapter');
});
