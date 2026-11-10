import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');

test('developer event section reads sources and deliveries without session ids', () => {
  const source = read('../src/renderer/mafw/components/EventLayerSection.tsx');
  assert.match(source, /events\.sources/);
  assert.match(source, /events\.deliveries/);
  assert.doesNotMatch(source, /ses_[a-zA-Z0-9]+/);
});
