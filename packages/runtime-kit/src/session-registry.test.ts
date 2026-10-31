import test from 'node:test';
import assert from 'node:assert/strict';
import { createSessionRegistry } from './session-registry.ts';

test('getOrCreate returns the same state for the same session', () => {
  const reg = createSessionRegistry<{ id: string }>();
  const a = reg.getOrCreate('s1', 'C:/proj');
  const b = reg.getOrCreate('s1', 'C:/other');
  assert.equal(a, b);
  assert.equal(a.directory, 'C:/proj');
  assert.equal(a.busy, false);
  assert.deepEqual(a.queue, []);
  assert.equal(a.controller, null);
});

test('finish clears busy and returns queued items FIFO', () => {
  const reg = createSessionRegistry<{ id: string }>();
  reg.getOrCreate('s1', 'C:/proj');
  reg.begin('s1');
  reg.enqueue('s1', { id: 'a' });
  reg.enqueue('s1', { id: 'b' });
  assert.equal(reg.get('s1')!.busy, true);
  assert.deepEqual(reg.finish('s1'), { id: 'a' });
  assert.deepEqual(reg.finish('s1'), { id: 'b' });
  assert.equal(reg.finish('s1'), null);
});

test('attach stores an interrupt controller and clearQueue empties the queue', () => {
  const reg = createSessionRegistry<{ id: string }>();
  reg.getOrCreate('s1', 'C:/proj');
  const controller = { interrupt: () => {} };
  reg.attach('s1', controller);
  assert.equal(reg.get('s1')!.controller, controller);
  reg.enqueue('s1', { id: 'a' });
  reg.clearQueue('s1');
  assert.deepEqual(reg.get('s1')!.queue, []);
  reg.attach('s1', null);
  assert.equal(reg.get('s1')!.controller, null);
});

test('delete removes the session; entries lists everything', () => {
  const reg = createSessionRegistry<{ id: string }>();
  reg.getOrCreate('s1', 'C:/a');
  reg.getOrCreate('s2', 'C:/b');
  assert.deepEqual([...reg.entries()].map(([sid]) => sid), ['s1', 's2']);
  reg.delete('s1');
  assert.equal(reg.get('s1'), undefined);
  assert.deepEqual([...reg.entries()].map(([sid]) => sid), ['s2']);
});

test('init extension fields are applied per session', () => {
  type Extra = { firstPrompt: boolean };
  const reg = createSessionRegistry<{ id: string }, Extra>(() => ({ firstPrompt: true }));
  const s = reg.getOrCreate('s1', 'C:/a');
  assert.equal(s.firstPrompt, true);
  s.firstPrompt = false;
  assert.equal(reg.getOrCreate('s1', 'C:/a').firstPrompt, false);
});
