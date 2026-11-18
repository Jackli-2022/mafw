import test from 'node:test';
import assert from 'node:assert/strict';
import { StreamWindow } from './flow.ts';

test('takes and credits within the initial window', () => {
  const window = new StreamWindow(100);
  assert.equal(window.available(), 100);
  assert.equal(window.take(40), true);
  assert.equal(window.available(), 60);
  assert.equal(window.take(61), false);
  assert.equal(window.available(), 60);

  window.credit(20);
  assert.equal(window.available(), 80);
});

test('rejects credit that overflows the initial window', () => {
  const window = new StreamWindow(100);
  assert.throws(() => window.credit(101), /window/i);
});
