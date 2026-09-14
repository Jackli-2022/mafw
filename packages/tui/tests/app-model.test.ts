import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AppModel } from '../src/ui/app-model.ts'

test('AppModel is a pure state holder: switchTab / toggleHelp / editing flag', () => {
  const m = new AppModel()
  assert.equal(m.active, 'chat')
  assert.equal(m.editing, false)
  assert.equal(m.helpVisible, false)

  m.switchTab('memory')
  assert.equal(m.active, 'memory')
  m.switchTab('goals')
  assert.equal(m.active, 'goals')

  m.toggleHelp()
  assert.equal(m.helpVisible, true)
  m.toggleHelp()
  assert.equal(m.helpVisible, false)

  m.editing = true
  assert.equal(m.editing, true)
})
