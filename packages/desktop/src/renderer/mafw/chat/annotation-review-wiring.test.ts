import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (path: string) => readFileSync(join(import.meta.dirname, path), 'utf8');

test('ChatPane sends annotations as discussion and marks them after transport', () => {
  const chat = read('../components/ChatPane.tsx');
  assert.match(chat, /peekAnnotations: \(\) => visibleAnnotations\(\)/);
  assert.match(chat, /markAnnotationsDiscussed: \(ownerKey, ids\) =>/);
  assert.doesNotMatch(chat, /persistAnnotations/);
  assert.doesNotMatch(chat, /createReviewItems/);
  assert.doesNotMatch(chat, /reviewItemPromptBlock/);
});

test('send pipeline never persists review items and marks drafts only on success', () => {
  const send = read('./use-send-message.ts');
  assert.match(send, /annotationRefPart/);
  assert.match(send, /markAnnotationsDiscussed\(sid, annotationIDs/);
  assert.match(send, /hasAnnotations/);
  assert.doesNotMatch(send, /persistAnnotations/);
  assert.doesNotMatch(send, /takeAnnotations/);
  assert.doesNotMatch(send, /createReviewItems/);
});
