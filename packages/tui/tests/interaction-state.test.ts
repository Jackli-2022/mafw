import { test } from 'node:test'
import assert from 'node:assert/strict'
import { InteractionStateMachine } from '../src/ui/interaction-state.ts'

test('mode derivation: overlay > busy > prompt', () => {
  const m = new InteractionStateMachine()
  assert.equal(m.mode, 'prompt')
  m.update({ overlayOpen: false, streaming: true })
  assert.equal(m.mode, 'busy')
  m.update({ overlayOpen: true, streaming: true })
  assert.equal(m.mode, 'overlay', 'overlay 压过 busy')
  m.update({ overlayOpen: true, streaming: false })
  assert.equal(m.mode, 'overlay')
  m.update({ overlayOpen: false, streaming: false })
  assert.equal(m.mode, 'prompt')
})

test('onChange fires only on mode transitions', () => {
  const m = new InteractionStateMachine()
  const changes: string[] = []
  m.onChange = (mode) => changes.push(mode)
  m.update({ overlayOpen: false, streaming: false })
  assert.deepEqual(changes, [], '同态不触发')
  m.update({ overlayOpen: false, streaming: true })
  assert.deepEqual(changes, ['busy'])
  m.update({ overlayOpen: false, streaming: true })
  assert.deepEqual(changes, ['busy'], '重复 busy 不触发')
  m.update({ overlayOpen: true, streaming: true })
  assert.deepEqual(changes, ['busy', 'overlay'])
})

test('is() helper queries', () => {
  const m = new InteractionStateMachine()
  assert.ok(m.is('prompt'))
  m.update({ overlayOpen: true, streaming: false })
  assert.ok(m.is('overlay'))
  assert.ok(!m.is('prompt'))
})
