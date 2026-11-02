import assert from 'node:assert/strict'
import { test } from 'node:test'
import { invokePanelViewAction } from './plugin-panel-invoke'

test('panel viewAction receives the raw action input, not an {input,sessionID} wrapper', async () => {
  const calls: unknown[][] = []
  const invoke = async (...args: unknown[]) => {
    calls.push(args)
    return { title: 'ok', body: [] }
  }

  await invokePanelViewAction(invoke, 'service-monitor', 'refresh', 'session-1')

  assert.deepEqual(calls, [['service-monitor', 'refresh', {}, 'session-1']])
})

test('panel viewAction omits sessionID when there is no active session', async () => {
  const calls: unknown[][] = []
  const invoke = async (...args: unknown[]) => {
    calls.push(args)
    return { title: 'ok', body: [] }
  }

  await invokePanelViewAction(invoke, 'service-monitor', 'refresh', null)

  assert.deepEqual(calls, [['service-monitor', 'refresh', {}, undefined]])
})
