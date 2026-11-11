import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (path: string) => readFileSync(join(import.meta.dirname, path), 'utf8');

test('review item section uses V2 primitives and theme tokens', () => {
  const component = read('components/PodReviewItems.tsx');
  const css = read('mafw.css');

  assert.match(component, /ButtonV2/);
  assert.match(component, /reviewStatusLabel/);
  assert.match(component, /确认解决/);
  assert.match(component, /重新打开/);
  assert.doesNotMatch(component, /<button/);
  assert.doesNotMatch(component, /<input/);
  assert.doesNotMatch(component, /\stitle=/);
  assert.match(css, /\.mafw-pod-review\s*\{[^}]*var\(--/);
});
