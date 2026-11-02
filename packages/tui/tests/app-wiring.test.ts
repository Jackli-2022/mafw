// 接线守卫（Task 12 review）：行为单测覆盖 helper，本文件钉住 app 真的在用它——
// 防止再次出现「helper 有测试但生产调用方为零」（review I2 根因）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const appSource = readFileSync(fileURLToPath(new URL('../src/ui/app.ts', import.meta.url)), 'utf-8')

test('wiring: app 把 chat canonical 事件喂给 ChatStore', () => {
  assert.match(appSource, /dispatchChatEvent\(chatStore, type, data\)/)
})

test('wiring: /agent picker 传入 client.agents.list() 的数组（不读 .items）', () => {
  assert.match(appSource, /showAgentPickerWith\(\{/)
  assert.match(appSource, /load: \(\) => client\.agents\.list\(\)/)
  assert.doesNotMatch(appSource, /agents\.list\(\)[\s\S]{0,80}?\.items \?\? \[\]/)
})

test('wiring: permission.asked 不因 approval.permission（含 list surface）被门控', () => {
  assert.doesNotMatch(
    appSource,
    /async function handlePermissionAsked[\s\S]{0,900}?experience\.gate\('approval\.permission'\)/,
  )
})

test('wiring: permission.replied 用 canonical id 收起待决审批弹窗（review I1）', () => {
  // asked 时登记待决 overlay，replied 时按 canonical id resolve
  assert.match(appSource, /pendingPermissions\.track\(dto\.id,/)
  assert.match(appSource, /type === 'permission\.replied'[\s\S]{0,400}?pendingPermissions\.resolve\(permissionRepliedId\(p\)\)/)
})
