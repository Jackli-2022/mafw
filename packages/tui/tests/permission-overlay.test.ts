import { test } from 'node:test';
import assert from 'node:assert/strict';
import { permissionToItems, shouldShowOverlay } from '../src/ui/overlays.ts';

test('选项含持久允许（第四项）', () => {
  const items = permissionToItems();
  assert.equal(items.length, 4);
  assert.deepEqual(
    items.map((i) => i.value),
    ['once', 'always', 'persist', 'reject'],
  );
});

test('shouldShowOverlay：human 才弹；auto-approve/auto-deny 不弹', () => {
  assert.equal(shouldShowOverlay({ mafwPolicy: { action: 'human' } }), true);
  assert.equal(shouldShowOverlay({ mafwPolicy: { action: 'auto-approve' } }), false);
  assert.equal(shouldShowOverlay({ mafwPolicy: { action: 'auto-deny' } }), false);
  assert.equal(shouldShowOverlay({}), true); // 无富化（旧 gateway）保守弹
});
