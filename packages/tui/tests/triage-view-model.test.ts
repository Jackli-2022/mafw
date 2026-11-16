import { test } from 'node:test'
import assert from 'node:assert/strict'
import { triageView } from '../src/ui/triage-view-model.ts'

// E10j-J1: TUI must render the real wire record (`~/.mafw/triage/*.json`),
// never the retired phantom fields `goalId` / `reason` / `severity` / `createdAt`.
function item(overrides: Record<string, unknown> = {}): any {
  return {
    id: 't1',
    automationId: 'auto-1',
    discoveredAt: '2026-11-16T09:00:00.000Z',
    source: 'axiom-distill',
    summary: {},
    state: 'PENDING_CONFIRMATION',
    userAction: null,
    deadline: '2026-11-20T09:00:00.000Z',
    ...overrides,
  }
}

test('title prefers proposedGoal.title', () => {
  const view = triageView(item({ proposedGoal: { title: 'Goal Title', boundaries: [], estimatedLoops: 3 } }))
  assert.equal(view.title, 'Goal Title')
})

test('title falls back to string summary.title, then id', () => {
  assert.equal(triageView(item({ summary: { title: 'Summary Title' } })).title, 'Summary Title')
  assert.equal(triageView(item({ summary: { title: '   ' } })).title, 't1')
  assert.equal(triageView(item({ summary: { title: 42 } })).title, 't1')
  assert.equal(triageView(item({ summary: {} })).title, 't1')
})

test('meta joins source, discoveredAt and deadline; invalid dates are omitted', () => {
  const valid = triageView(item())
  assert.ok(valid.meta.startsWith('axiom-distill'), valid.meta)
  assert.match(valid.meta, /2026/)
  assert.match(valid.meta, /截止/)

  const invalid = triageView(item({ discoveredAt: 'not-a-date', deadline: 'nope' }))
  assert.equal(invalid.meta, 'axiom-distill')
  assert.ok(!invalid.meta.includes('Invalid Date'), invalid.meta)

  assert.equal(triageView(item({ source: '', discoveredAt: '', deadline: '' })).meta, '')
})

test('badge maps the three wire states to localized labels and tones', () => {
  assert.deepEqual(triageView(item({ state: 'PENDING_CONFIRMATION' })).badge, { label: '待确认', tone: 'warn' })
  assert.deepEqual(triageView(item({ state: 'CONFIRMED' })).badge, { label: '已确认', tone: 'neutral' })
  assert.deepEqual(triageView(item({ state: 'REJECTED' })).badge, { label: '已拒绝', tone: 'danger' })
})

test('badge appends the highest llm suggestion priority', () => {
  const suggestions = [
    { action: 'reject', reason: 'r', priority: 'low', timestamp: '2026-11-16T09:00:00.000Z' },
    { action: 'confirm', reason: 'c', priority: 'high', timestamp: '2026-11-16T09:00:00.000Z' },
    { action: 'reject', reason: 'm', priority: 'medium', timestamp: '2026-11-16T09:00:00.000Z' },
  ]
  const view = triageView(item({ llmSuggestions: suggestions }))
  assert.equal(view.badge.label, '待确认 · 建议确认 high')
  assert.equal(view.badge.tone, 'warn')

  assert.equal(triageView(item({ llmSuggestions: [] })).badge.label, '待确认')
})

test('no phantom fields leak into the view', () => {
  const legacy = item({ severity: 'high', reason: 'legacy reason', goalId: 'legacy-goal' })
  const view = triageView(legacy)
  assert.doesNotMatch(view.title, /legacy/)
  assert.doesNotMatch(view.meta, /legacy/)
  assert.doesNotMatch(view.badge.label, /high/i)
  assert.equal(view.title, 't1')
})
