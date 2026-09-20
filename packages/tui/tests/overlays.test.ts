import { test } from 'node:test'
import assert from 'node:assert/strict'
import { permissionSummary, permissionToItems } from '../src/ui/overlays.ts'

test('permissionSummary shows permission + patterns', () => {
  const s = permissionSummary({ id: 'r1', sessionID: 's', permission: 'bash', patterns: ['rm -rf *'] })
  assert.ok(s.includes('bash'))
  assert.ok(s.includes('rm -rf *'))
})

test('permissionToItems is once/always/persist/persist-tool/reject in order', () => {
  const items = permissionToItems()
  assert.deepEqual(items.map(i => i.value), ['once', 'always', 'persist', 'persist-tool', 'reject'])
})
