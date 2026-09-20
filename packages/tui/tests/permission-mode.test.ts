import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PermissionModeStore } from '../src/store/permission-mode.ts';

function makeClient() {
  const calls = [];
  return {
    calls,
    permissions: {
      getMode: async (sid) => (sid === 's-auto' ? { mode: 'auto', autoApprovals: 0, budget: 25 } : { mode: 'read-only', autoApprovals: 0, budget: 25 }),
      setMode: async (sid, mode) => { calls.push({ sid, mode }); },
    },
  };
}

test('缺省 read-only；load 拉取 kv 值', async () => {
  const c = makeClient();
  const s = new PermissionModeStore(c);
  assert.equal(s.get('s-auto'), 'read-only');
  await s.load('s-auto');
  assert.equal(s.get('s-auto'), 'auto');
});

test('toggle 三档循环 read-only → auto → full-access → read-only', async () => {
  const c = makeClient();
  const s = new PermissionModeStore(c);
  const n1 = await s.toggle('s1');
  assert.equal(n1, 'auto');
  assert.equal(s.get('s1'), 'auto');
  const n2 = await s.toggle('s1');
  assert.equal(n2, 'full-access');
  assert.equal(s.get('s1'), 'full-access');
  const n3 = await s.toggle('s1');
  assert.equal(n3, 'read-only');
  assert.equal(s.get('s1'), 'read-only');
  assert.deepEqual(c.calls, [
    { sid: 's1', mode: 'auto' },
    { sid: 's1', mode: 'full-access' },
    { sid: 's1', mode: 'read-only' },
  ]);
});

test('load 到未知值（legacy manual）回退 read-only', async () => {
  const c = makeClient();
  c.permissions.getMode = async () => ({ mode: 'manual', autoApprovals: 0, budget: 25 });
  const s = new PermissionModeStore(c);
  await s.load('s1');
  assert.equal(s.get('s1'), 'read-only');
});

test('load 失败 fail-open 保持缺省', async () => {
  const c = makeClient();
  c.permissions.getMode = async () => { throw new Error('down'); };
  const s = new PermissionModeStore(c);
  await s.load('s1');
  assert.equal(s.get('s1'), 'read-only');
});

test('setMode 失败抛出（toggle 调用方处理）', async () => {
  const c = makeClient();
  c.permissions.setMode = async () => { throw new Error('gateway down'); };
  const s = new PermissionModeStore(c);
  await assert.rejects(() => s.toggle('s1'), /gateway down/);
  assert.equal(s.get('s1'), 'read-only'); // 未切换成功不落内存态
});
