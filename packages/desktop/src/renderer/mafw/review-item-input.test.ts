import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Annotation } from '../../shared/annotation-types';
import { reviewInputsFromAnnotations, reviewItemPromptBlock } from './review-item-input';

const base: Annotation = {
  id: 'ann-1',
  sessionID: 's1',
  rel: 'src/a.ts',
  startLine: 3,
  endLine: 5,
  code: 'x()',
  comment: '这里要改',
  createdAt: 1,
};

test('annotations map to review inputs with source and clientRef, without session-only fields', () => {
  const inputs = reviewInputsFromAnnotations([{
    ...base,
    anchor: { kind: 'quote', quote: '原文' },
    imageDataUrl: 'data:image/png;base64,xxx',
    scopeKey: 'project:x',
    root: 'C:\\x',
    source: { kind: 'project', projectDir: 'C:/repo' },
    contentVersion: 'hash',
  }]);
  assert.deepEqual(inputs, [{
    rel: 'src/a.ts', startLine: 3, endLine: 5, code: 'x()',
    comment: '这里要改', anchor: { kind: 'quote', quote: '原文' },
    source: { kind: 'project', projectDir: 'C:/repo', root: 'C:\\x', contentVersion: 'hash' },
    clientRef: 'ann-1',
  }]);
});

test('empty comments are not persisted as review items', () => {
  assert.deepEqual(reviewInputsFromAnnotations([{ ...base, comment: '   ' }]), []);
});

test('prompt block names each item so the Tech Lead can respond', () => {
  const block = reviewItemPromptBlock([{
    id: 'review_1', podId: 'pod_1', goalId: 'g1', revision: 1,
    status: 'pending', rel: 'src/a.ts', startLine: 3, endLine: 5,
    code: 'x()', comment: '这里要改', anchor: null, response: null,
    originItemId: null, originRevision: null,
    createdAt: '2026-11-11T00:00:00.000Z', updatedAt: '2026-11-11T00:00:00.000Z',
    respondedAt: null, resolvedAt: null,
  }]);
  assert.match(block, /review_1/);
  assert.match(block, /mafw_pod_review_respond/);
  assert.match(block, /src\/a\.ts/);
});
