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

test('event layer diagnostics sit behind an explicit developer gate', () => {
  const config = read('../src/renderer/mafw/pages/Config.tsx');
  const gate = config.indexOf('mafw-developer-mode');
  const section = config.indexOf('<EventLayerSection');
  assert.ok(gate >= 0);
  assert.ok(section > gate);
});

test('standing panel surfaces per-goal run history errors', () => {
  const source = read('../src/renderer/mafw/components/StandingGoalsPanel.tsx');
  assert.match(source, /setRunsError/);
  assert.match(source, /runsError/);
});
