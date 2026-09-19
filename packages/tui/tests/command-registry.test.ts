import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  COMMAND_REGISTRY, resolveCommand, autocompleteItems, helpLines, COMMAND_CATEGORIES,
} from '../src/ui/command-registry.ts'

test('registry has unique names, every command has description + category', () => {
  const names = COMMAND_REGISTRY.map((c) => c.name)
  assert.equal(new Set(names).size, names.length, '名字唯一')
  for (const c of COMMAND_REGISTRY) {
    assert.ok(c.description.length > 0, `${c.name} 有描述`)
    assert.ok(COMMAND_CATEGORIES.includes(c.category), `${c.name} category 合法`)
  }
})

test('current command surface is fully covered', () => {
  const names = COMMAND_REGISTRY.map((c) => c.name).sort()
  assert.deepEqual(names, ['btw', 'compact', 'copy', 'diff', 'editor', 'exit', 'export', 'focus', 'fork', 'help', 'model', 'new', 'older', 'permissions', 'queue', 'redo', 'rename', 'sessions', 'status', 'undo', 'usage', 'verbose', 'waitwhat'])
})

test('resolveCommand resolves aliases and exact names; unknown → null', () => {
  assert.equal(resolveCommand('sessions'), 'sessions')
  assert.equal(resolveCommand('resume'), 'sessions', '别名')
  assert.equal(resolveCommand('switch'), 'sessions')
  assert.equal(resolveCommand('clear'), 'new')
  assert.equal(resolveCommand('nope'), null)
})

test('destructive commands are flagged', () => {
  const destructive = COMMAND_REGISTRY.filter((c) => c.destructive).map((c) => c.name).sort()
  assert.deepEqual(destructive, ['compact', 'new', 'redo', 'undo'])
})

test('autocompleteItems mirrors registry (name + description)', () => {
  const items = autocompleteItems()
  assert.equal(items.length, COMMAND_REGISTRY.length)
  assert.ok(items.every((i) => i.description.length > 0))
  assert.ok(items.some((i) => i.name === 'sessions'))
})

test('helpLines groups by category and covers every command', () => {
  const lines = helpLines()
  const joined = lines.join('\n')
  for (const c of COMMAND_REGISTRY) {
    assert.ok(joined.includes(`/${c.name}`), `/${c.name} 出现在 help`)
  }
  // 只断言非空分类（空分类如『自定义』无可渲染命令，不出现标题）
  for (const cat of COMMAND_CATEGORIES) {
    if (!COMMAND_REGISTRY.some((c) => c.category === cat)) continue
    assert.ok(joined.includes(cat), `分类 ${cat} 有标题`)
  }
  // 破坏性命令带标记（行尾 ⚠）
  const clean = joined.replace(/\x1b\[[0-9;]*m/g, '')
  assert.ok(/\/undo.*⚠/.test(clean), 'undo 行带 ⚠')
  assert.ok(!/\/older.*⚠/.test(clean), 'older 无 ⚠')
})

test('immediate commands (busy 时不排队立即执行) are flagged', () => {
  const immediate = COMMAND_REGISTRY.filter((c) => c.immediate).map((c) => c.name).sort()
  assert.deepEqual(immediate, ['compact', 'copy', 'diff', 'editor', 'exit', 'export', 'focus', 'fork', 'help', 'model', 'older', 'permissions', 'queue', 'rename', 'sessions', 'status', 'usage', 'verbose', 'waitwhat'])
})

test('autocompleteItems includes argumentHint from extra commands', () => {
  const items = autocompleteItems([
    { name: 'goal', description: '提交 Goal', category: '自定义', gateway: true, argumentHint: '<目标>' },
  ])
  assert.equal(items.find((i) => i.name === 'goal')?.description, '提交 Goal <目标>')
})

test('autocompleteItems dedupes by name (local wins on collision)', () => {
  const items = autocompleteItems([
    { name: 'btw', description: '重复条目', category: '自定义', gateway: true },
  ])
  assert.equal(items.filter((i) => i.name === 'btw').length, 1)
  assert.equal(items.find((i) => i.name === 'btw')?.description, COMMAND_REGISTRY.find((c) => c.name === 'btw')?.description)
})

test('helpLines renders extra gateway commands', () => {
  const lines = helpLines([
    { name: 'goal', description: '提交 Goal', category: '自定义', gateway: true },
  ])
  assert.ok(lines.join('\n').includes('/goal'))
})
