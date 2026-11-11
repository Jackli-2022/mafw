import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (path: string) => readFileSync(join(import.meta.dirname, path), 'utf8');

test('ChatPane stages annotations as review items only for Goal-bound Tech Lead sends', () => {
  const chat = read('../components/ChatPane.tsx');
  assert.match(chat, /peekAnnotations: \(sid\) => pendingFor\(sid\)/);
  assert.match(chat, /persistAnnotations: async \(items\) =>/);
  assert.match(chat, /createReviewItems\(target\.podId, target\.goalId/);
  assert.match(chat, /reviewInputsFromAnnotations/);
  assert.match(chat, /reviewItemPromptBlock/);
});

test('send pipeline persists before clearing drafts and aborts on failure', () => {
  const send = read('./use-send-message.ts');
  assert.match(send, /peekAnnotations/);
  assert.match(send, /persistAnnotations/);
  assert.match(send, /评审项保存失败/);
  const failure = send.indexOf('评审项保存失败');
  const clear = send.indexOf('takeAnnotations(sid)', failure);
  assert.ok(failure >= 0 && clear > failure, 'annotation persistence must run before takeAnnotations');
});
