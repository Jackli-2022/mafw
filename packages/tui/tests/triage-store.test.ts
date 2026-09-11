import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TriageStore } from '../src/store/triage-store.ts'

const APPROVAL = { id: 'a1', goalId: 'g', question: 'ok?', status: 'pending', createdAt: '' }
const TRIAGE = { id: 't1', goalId: 'g', reason: 'r', severity: 'high', createdAt: '' }

async function settle() { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() }

test('poll loads approvals + triage; act dispatches to right namespace', async () => {
  const calls: any[] = []
  const store = new TriageStore({
    approvals: {
      list: async () => [APPROVAL],
      respond: async (id: string, d: string) => calls.push(['approval', id, d]),
    } as any,
    triage: {
      list: async () => [TRIAGE],
      confirm: async (id: string) => calls.push(['triage-confirm', id]),
      reject: async (id: string) => calls.push(['triage-reject', id]),
      dismiss: async (id: string) => calls.push(['triage-dismiss', id]),
    } as any,
    onChange: () => {},
    schedule: () => () => {},
  })
  store.start()
  await settle()
  assert.equal(store.approvals.length, 1)
  assert.equal(store.items.length, 1)
  assert.equal(store.items[0].id, 't1')
  await store.act('approval', 'a1', 'approve')
  await store.act('triage', 't1', 'confirm')
  assert.deepEqual(calls, [['approval', 'a1', 'approve'], ['triage-confirm', 't1']])
  store.stop()
})

test('act supports reject and dismiss for triage', async () => {
  const calls: any[] = []
  const store = new TriageStore({
    approvals: { list: async () => [], respond: async () => {} } as any,
    triage: {
      list: async () => [],
      confirm: async () => {},
      reject: async (id: string) => calls.push(['reject', id]),
      dismiss: async (id: string) => calls.push(['dismiss', id]),
    } as any,
    onChange: () => {},
  })
  await store.act('triage', 'x', 'dismiss')
  await store.act('triage', 'y', 'reject')
  assert.deepEqual(calls, [['dismiss', 'x'], ['reject', 'y']])
})

test('poll failure keeps old data', async () => {
  let fail = false
  const store = new TriageStore({
    approvals: { list: async () => { if (fail) throw new Error('down'); return [APPROVAL] }, respond: async () => {} } as any,
    triage: { list: async () => { if (fail) throw new Error('down'); return [TRIAGE] }, confirm: async () => {}, reject: async () => {}, dismiss: async () => {} } as any,
    onChange: () => {},
  })
  store.start()
  await settle()
  assert.equal(store.items.length, 1)
  fail = true
  await store.poll()
  assert.equal(store.items.length, 1)
  store.stop()
})
