import { test } from 'node:test'
import assert from 'node:assert/strict'
import chalk from 'chalk'
import { ConfirmOverlay } from '../src/ui/confirm-overlay.ts'
import { computeRecap, recapLines } from '../src/ui/session-recap.ts'
import type { ChatTurn } from '../src/store/chat-store.ts'

chalk.level = 3

// ── 破坏性命令确认（Hermes 三选） ──

function makeConfirm() {
  const answers: string[] = []
  const overlay = new ConfirmOverlay({
    title: '确认执行 /undo？',
    description: '将移除最后一轮对话',
    onAnswer: (mode) => answers.push(mode),
    requestRender: () => {},
  })
  return { overlay, get answers() { return answers } }
}

test('renders title, description and three options with hints', () => {
  const { overlay } = makeConfirm()
  const clean = overlay.render(60).map(l => l.replace(/\x1b\[[0-9;]*m/g, '')).join('\n')
  assert.ok(clean.includes('/undo'))
  assert.ok(clean.includes('移除最后一轮'))
  assert.ok(clean.includes('本次执行'))
  assert.ok(clean.includes('本会话总是执行'))
  assert.ok(clean.includes('取消'))
})

test('enter answers once by default; a/l/d shortcuts; esc cancels', () => {
  const a = makeConfirm()
  a.overlay.handleInput('\r')
  assert.deepEqual(a.answers, ['once'])

  const b = makeConfirm()
  b.overlay.handleInput('l')
  assert.deepEqual(b.answers, ['always'])

  const c = makeConfirm()
  c.overlay.handleInput('d')
  assert.deepEqual(c.answers, ['cancel'])

  const e = makeConfirm()
  e.overlay.handleInput('\x1b')
  assert.deepEqual(e.answers, ['cancel'], 'Esc = 取消')
})

test('j/k move selection; enter activates selected', () => {
  const h = makeConfirm()
  h.overlay.handleInput('j')
  h.overlay.handleInput('j')
  h.overlay.handleInput('\r')
  assert.deepEqual(h.answers, ['cancel'], '下移两次到取消')
})

// ── /status 本地 recap（零 LLM） ──

const TURNS: ChatTurn[] = [
  { messageID: 'm1', role: 'user', parts: [{ id: 'a', type: 'text', text: '跑一下测试', state: 'completed' }], done: true },
  {
    messageID: 'm2', role: 'assistant', done: true, parts: [
      { id: 'b1', type: 'tool', toolName: 'bash', state: 'completed', text: 'npm test' },
      { id: 'b2', type: 'tool', toolName: 'bash', state: 'completed', text: 'npm run build' },
      { id: 'b3', type: 'tool', toolName: 'read', state: 'completed', text: 'src/a.ts' },
      { id: 'b4', type: 'text', text: '全部通过', state: 'completed' },
    ],
  },
  { messageID: 'm3', role: 'user', parts: [{ id: 'c', type: 'text', text: '好的，提交吧', state: 'completed' }], done: true },
]

test('computeRecap counts turns, tools, top tool, last exchange', () => {
  const r = computeRecap(TURNS)
  assert.equal(r.userTurns, 2)
  assert.equal(r.assistantTurns, 1)
  assert.equal(r.toolCalls, 3)
  assert.deepEqual(r.topTools, [['bash', 2], ['read', 1]])
  assert.ok(r.lastUserPrompt!.includes('提交吧'))
  assert.ok(r.lastAssistantText!.includes('全部通过'))
})

test('computeRecap handles empty turns and queued exclusion', () => {
  const r = computeRecap([])
  assert.equal(r.userTurns, 0)
  assert.equal(r.lastUserPrompt, null)
  const q = computeRecap([{ messageID: 'q1', role: 'user', queued: true, parts: [{ id: 'x', type: 'text', text: 'queued', state: 'completed' }], done: true }])
  assert.equal(q.userTurns, 0, '排队未发送的不计入')
})

test('recapLines renders all sections', () => {
  const lines = recapLines(computeRecap(TURNS), 'ses_abc', 'demo')
  const clean = lines.map(l => l.replace(/\x1b\[[0-9;]*m/g, '')).join('\n')
  assert.ok(clean.includes('会话'), '会话信息')
  assert.ok(clean.includes('demo'))
  assert.ok(clean.includes('轮次'), '轮次统计')
  assert.ok(clean.includes('bash'), '工具 top')
  assert.ok(clean.includes('提交吧'), '最后交互')
})
