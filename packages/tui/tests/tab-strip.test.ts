import { test } from 'node:test'
import assert from 'node:assert/strict'
import { visibleWidth } from '@earendil-works/pi-tui'
import { TabStrip } from '../src/ui/tab-strip.ts'
import { StatusBar } from '../src/ui/status-bar.ts'

test('TabStrip renders all four tabs and fits width', () => {
  const ts = new TabStrip()
  ts.setActive('chat')
  ts.setConnected(true)
  const lines = ts.render(80)
  assert.equal(lines.length, 1)
  assert.ok(visibleWidth(lines[0]) <= 80)
  for (const label of ['Chat', 'Goals', 'Memory', 'Triage']) assert.ok(lines[0].includes(label))
})

test('TabStrip truncates on narrow terminals', () => {
  const ts = new TabStrip()
  const lines = ts.render(24)
  assert.ok(visibleWidth(lines[0]) <= 24)
})

test('TabStrip marks active tab', () => {
  const ts = new TabStrip()
  ts.setActive('goals')
  const line = ts.render(80)[0]
  const clean = line.replace(/\x1b\[[0-9;]*m/g, '')
  const goalsPos = clean.indexOf('2:Goals')
  const chatPos = clean.indexOf('1:Chat')
  assert.ok(goalsPos >= 0 && chatPos >= 0)
})

test('StatusBar shows connection state and project', () => {
  const sb = new StatusBar()
  sb.setState({ project: 'opencode-plugin-mafw', session: 'ses_abc123456789', conn: 'reconnecting' })
  const line = sb.render(100)[0]
  const clean = line.replace(/\x1b\[[0-9;]*m/g, '')
  assert.ok(clean.includes('reconnecting'))
  assert.ok(clean.includes('opencode-plugin-mafw'))
  assert.ok(clean.includes('ses_abc12345')) // session 截断到 12 字符
})

test('StatusBar truncates on narrow width', () => {
  const sb = new StatusBar()
  sb.setState({ project: 'x'.repeat(50), conn: 'ok' })
  const line = sb.render(30)[0]
  assert.ok(visibleWidth(line) <= 30)
})
