import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PermissionModeStore } from '../src/store/permission-mode.ts';

function makeClient() {
  const calls = [];
  return {
    calls,
    permissions: {
      getMode: async (sid) => (sid === 's-auto' ? { mode: 'auto', autoApprovals: 0, budget: 25 } : { mode: 'manual', autoApprovals: 0, budget: 25 }),
      setMode: async (sid, mode) => { calls.push({ sid, mode }); },
    },
  };
}

test('缺省 manual；load 拉取 kv 值', async () => {
  const c = makeClient();
  const s = new PermissionModeStore(c);
  assert.equal(s.get('s-auto'), 'manual');
  await s.load('s-auto');
  assert.equal(s.get('s-auto'), 'auto');
});

test('toggle 切换并 setMode', async () => {
  const c = makeClient();
  const s = new PermissionModeStore(c);
  const next = await s.toggle('s1');
  assert.equal(next, 'auto');
  assert.equal(s.get('s1'), 'auto');
  assert.deepEqual(c.calls, [{ sid: 's1', mode: 'auto' }]);
  const next2 = await s.toggle('s1');
  assert.equal(next2, 'manual');
  assert.deepEqual(c.calls, [{ sid: 's1', mode: 'auto' }, { sid: 's1', mode: 'manual' }]);
});

test('load 失败 fail-open 保持缺省', async () => {
  const c = makeClient();
  c.permissions.getMode = async () => { throw new Error('down'); };
  const s = new PermissionModeStore(c);
  await s.load('s1');
  assert.equal(s.get('s1'), 'manual');
});

test('setMode 失败抛出（toggle 调用方处理）', async () => {
  const c = makeClient();
  c.permissions.setMode = async () => { throw new Error('gateway down'); };
  const s = new PermissionModeStore(c);
  await assert.rejects(() => s.toggle('s1'), /gateway down/);
  assert.equal(s.get('s1'), 'manual'); // 未切换成功不落内存态
});
