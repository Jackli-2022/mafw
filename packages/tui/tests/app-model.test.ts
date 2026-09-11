import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AppModel } from '../src/ui/app-model.ts'

test('digit keys switch tabs', () => {
  const m = new AppModel()
  assert.equal(m.active, 'chat')
  m.handleKey('3')
  assert.equal(m.active, 'memory')
  m.handleKey('2')
  assert.equal(m.active, 'goals')
  m.handleKey('4')
  assert.equal(m.active, 'triage')
  m.handleKey('1')
  assert.equal(m.active, 'chat')
})

test('q quits when not editing; ignored while editing', () => {
  const m = new AppModel()
  assert.equal(m.handleKey('q'), 'quit')
  m.editing = true
  assert.equal(m.handleKey('q'), null)
  assert.equal(m.handleKey('1'), null, '编辑态数字键归编辑器')
  m.editing = false
  m.handleKey('2')
  assert.equal(m.active, 'goals')
})

test('ctrl+c always quits even while editing', () => {
  const m = new AppModel()
  m.editing = true
  assert.equal(m.handleKey(''), 'quit') // ctrl+c 裸字节
})

test('? toggles help overlay flag', () => {
  const m = new AppModel()
  m.handleKey('?')
  assert.equal(m.helpVisible, true)
  m.handleKey('?')
  assert.equal(m.helpVisible, false)
})
