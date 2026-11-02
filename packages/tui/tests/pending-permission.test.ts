// 待决审批 overlay 的外部销账（review I1）：permission.replied 带 canonical id 时
// 收起本地弹窗；id 不匹配/无 id 时不误关。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PendingPermissionStore, permissionRepliedId } from '../src/store/pending-permission.ts'

test('permissionRepliedId：canonical id 优先，requestID/requestId 兜底，无 id → undefined', () => {
  assert.equal(permissionRepliedId({ id: 'canon' }), 'canon')
  assert.equal(permissionRepliedId({ id: 'canon', requestID: 'legacy' }), 'canon')
  assert.equal(permissionRepliedId({ requestID: 'legacy' }), 'legacy')
  assert.equal(permissionRepliedId({ requestId: 'pi_1' }), 'pi_1')
  assert.equal(permissionRepliedId({}), undefined)
  assert.equal(permissionRepliedId(null), undefined)
  assert.equal(permissionRepliedId('p1'), undefined)
})

test('resolve：同 id → 关闭弹窗并清空；异 id / 无待决 → 不关闭', () => {
  const store = new PendingPermissionStore()
  const closed: string[] = []
  store.track('p1', () => closed.push('p1'))
  assert.equal(store.currentId, 'p1')

  assert.equal(store.resolve('other'), false)
  assert.equal(store.resolve(undefined), false)
  assert.deepEqual(closed, [])
  assert.equal(store.currentId, 'p1')

  assert.equal(store.resolve('p1'), true)
  assert.deepEqual(closed, ['p1'])
  assert.equal(store.currentId, null)
  // 已收起后再来同 id replied → 不重复关闭
  assert.equal(store.resolve('p1'), false)
  assert.deepEqual(closed, ['p1'])
})

test('clear：本地答复后清掉追踪，避免 later replied 二次 hide', () => {
  const store = new PendingPermissionStore()
  const closed: string[] = []
  store.track('p1', () => closed.push('p1'))
  store.clear('p1')
  assert.equal(store.currentId, null)
  assert.equal(store.resolve('p1'), false)
  assert.deepEqual(closed, [])

  // clear 不误清别的请求
  store.track('p2', () => closed.push('p2'))
  store.clear('other')
  assert.equal(store.currentId, 'p2')
})

test('close 抛错 fail-open（事件链不被弹窗异常打断）', () => {
  const store = new PendingPermissionStore()
  store.track('p1', () => { throw new Error('tui gone') })
  assert.equal(store.resolve('p1'), true)
  assert.equal(store.currentId, null)
})
