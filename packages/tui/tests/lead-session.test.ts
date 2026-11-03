import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveTuiLeadSession } from '../src/ui/lead-session.ts'

test('explicit --session wins without touching Pod APIs', async () => {
  let called = 0
  const out = await resolveTuiLeadSession({
    lookup: async () => { called++; return null },
    ensureLead: async () => { called++; return { sessionId: 'x' } },
  }, '/p', 'ses_explicit')
  assert.equal(out, 'ses_explicit')
  assert.equal(called, 0)
})

test('Pod project ensures and returns the current Lead session', async () => {
  const calls: string[] = []
  const out = await resolveTuiLeadSession({
    lookup: async (dir) => { calls.push(`lookup:${dir}`); return { pod: { id: 'pod_1' } } },
    ensureLead: async (id) => { calls.push(`ensure:${id}`); return { sessionId: 'ses_lead' } },
  }, '/p')
  assert.equal(out, 'ses_lead')
  assert.deepEqual(calls, ['lookup:/p', 'ensure:pod_1'])
})

test('Pod-less project stays sessionless instead of auto-creating', async () => {
  let ensured = 0
  const out = await resolveTuiLeadSession({
    lookup: async () => { throw new Error('pod not found') },
    ensureLead: async () => { ensured++; return { sessionId: 'x' } },
  }, '/p')
  assert.equal(out, null)
  assert.equal(ensured, 0)
})

test('missing project or failed ensure degrades to sessionless', async () => {
  assert.equal(await resolveTuiLeadSession({
    lookup: async () => ({ pod: { id: 'pod_1' } }),
    ensureLead: async () => ({ sessionId: 'x' }),
  }, null), null)
  assert.equal(await resolveTuiLeadSession({
    lookup: async () => ({ pod: { id: 'pod_1' } }),
    ensureLead: async () => { throw new Error('boom') },
  }, '/p'), null)
})
