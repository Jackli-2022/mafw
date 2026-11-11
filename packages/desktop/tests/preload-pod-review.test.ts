import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const api = readFileSync(new URL('../src/preload/mafw-api.ts', import.meta.url), 'utf8');
const types = readFileSync(new URL('../src/preload/mafw-types.ts', import.meta.url), 'utf8');

test('preload exposes review item methods through the pod namespace', () => {
  for (const method of ['reviewItems', 'createReviewItems', 'resolveReviewItem', 'reopenReviewItem']) {
    assert.match(api, new RegExp(`${method}:`));
  }
  // MafwAPI delegates the pod namespace to the SDK type, so new methods are typed automatically.
  assert.match(types, /pod: PodNamespace/);
  assert.match(api, /acceptResult: \(podID, goalID, body\)/);
});
