import { test } from 'node:test'
import assert from 'node:assert/strict'
import { GoalsTab, formatGoalSessions } from '../src/ui/goals-tab.ts'
import { historyItemsToTurns } from '../src/store/chat-store.ts'
import type { GoalsStore } from '../src/store/goals-store.ts'

test('historyItemsToTurns maps wire items to renderable turns', () => {
  const turns = historyItemsToTurns([
    { info: { id: 'm1', role: 'user', time: { created: 1 } }, parts: [{ id: 'p1', messageID: 'm1', type: 'text', text: '问' }] },
    { info: { id: 'm2', role: 'assistant' }, parts: [{ id: 'p2', messageID: 'm2', type: 'text', text: '答' }] },
  ])
  assert.equal(turns.length, 2)
  assert.equal(turns[0].role, 'user')
  assert.equal(turns[0].parts[0].text, '问')
  assert.equal(turns[1].role, 'assistant')
})

test('formatGoalSessions renders phase/loop and title when present', () => {
  const lines = formatGoalSessions([
    { sessionID: 'ses_plan', phase: 'PLANNING', loop: 1, title: 'plan worker' },
    { sessionID: 'ses_exec', phase: 'EXECUTING', loop: 2 },
  ])
  const clean = lines.map(l => l.replace(/\x1b\[[0-9;]*m/g, '')).join('\n')
  assert.ok(clean.includes('PLANNING'))
  assert.ok(clean.includes('plan worker'))
  assert.ok(clean.includes('EXECUTING'))
  assert.ok(clean.includes('ses_plan'))
})

function fakeTui() {
  const overlays: any[] = []
  const listeners: any[] = []
  return {
    overlays,
    listeners,
    showOverlay(component: any, _opts?: any) {
      overlays.push(component)
      return { hide() { component.hidden = true }, focus() {}, isFocused: () => false, setHidden() {}, isHidden: () => false, unfocus() {} }
    },
    addInputListener(fn: any) { listeners.push(fn); return () => {} },
    requestRender() {},
  }
}

function fakeClient() {
  const calls: string[] = []
  return {
    calls,
    goals: {
      get: async (_id: string) => null,
      control: async () => {},
      sessions: async (goalId: string) => {
        calls.push(`goals.sessions:${goalId}`)
        return [
          { sessionID: 'ses_plan', phase: 'PLANNING', loop: 1, title: 'plan worker' },
        ]
      },
    },
    questions: { reply: async () => {}, reject: async () => {} },
    session: {
      messages: async (p: any) => {
        calls.push(`messages:${p.path.id}`)
        return {
          data: [
            { info: { id: 'm1', role: 'user' }, parts: [{ id: 'p1', messageID: 'm1', type: 'text', text: '计划内容' }] },
          ],
          nextCursor: null,
        }
      },
    },
  }
}

function makeTab() {
  const tui = fakeTui() as any
  const client = fakeClient() as any
  const store = { rows: [], questions: [], start: () => {}, stop: () => {} } as unknown as GoalsStore
  const tab = new GoalsTab({ tui, store, client, setStatus: () => {} })
  return { tab, tui, client }
}

test('openGoalSessions fetches sessions and shows overlay', async () => {
  const { tab, tui, client } = makeTab()
  await tab.openGoalSessions('g1')
  assert.ok(client.calls.includes('goals.sessions:g1'))
  assert.ok(tui.overlays.length >= 1, '弹出 sessions overlay')
})

test('selecting a session opens its transcript (messages fetched)', async () => {
  const { tab, tui, client } = makeTab()
  await tab.openGoalSessions('g1')
  const wrap = tui.overlays.at(-1)
  assert.ok(wrap, 'sessions overlay（ClickableSelectList 包装）已挂')
  await wrap.list.onSelect({ value: 'ses_plan', label: 'plan worker' })
  assert.ok(client.calls.includes('messages:ses_plan'), '取 session 消息')
  const transcript = tui.overlays.at(-1)
  assert.notEqual(transcript, wrap, 'transcript overlay 已弹出')
})
