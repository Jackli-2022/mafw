import { test } from 'node:test'
import assert from 'node:assert/strict'
import chalk from 'chalk'
import { visibleWidth } from '@earendil-works/pi-tui'
import { StatusBar, formatTokens, formatDuration } from '../src/ui/status-bar.ts'

chalk.level = 3

test('formatTokens compacts numbers', () => {
  assert.equal(formatTokens(0), '0')
  assert.equal(formatTokens(999), '999')
  assert.equal(formatTokens(1234), '1.2K')
  assert.equal(formatTokens(12_400), '12.4K')
  assert.equal(formatTokens(1_250_000), '1.3M')
})

test('formatDuration renders s / m+s', () => {
  assert.equal(formatDuration(15_000), '15s')
  assert.equal(formatDuration(930_000), '15m 30s')
  assert.equal(formatDuration(3_600_000), '60m')
})

test('status bar renders usage fields (model/tokens/cost/duration)', () => {
  const bar = new StatusBar()
  bar.setState({
    project: 'demo', session: 'ses_abc123def', conn: 'ok',
    usage: { model: 'mimo-v2.5', tokens: 12_400, costUsd: 0.06, durationMs: 930_000 },
  })
  const clean = bar.render(120)[0].replace(/\x1b\[[0-9;]*m/g, '')
  assert.ok(clean.includes('mimo-v2.5'), '模型名')
  assert.ok(clean.includes('12.4K'), 'token 数')
  assert.ok(clean.includes('$0.06'), '成本')
  assert.ok(clean.includes('15m 30s'), '时长')
  assert.ok(visibleWidth(bar.render(120)[0]) <= 120)
})

test('status bar without usage fields still renders base info', () => {
  const bar = new StatusBar()
  bar.setState({ project: 'demo', session: 'ses_x', conn: 'ok' })
  const clean = bar.render(100)[0].replace(/\x1b\[[0-9;]*m/g, '')
  assert.ok(clean.includes('demo'))
  assert.ok(clean.includes('connected'))
  assert.ok(!clean.includes('$'), '无成本字段时不渲染 $')
})

test('status bar truncates to narrow width without error', () => {
  const bar = new StatusBar()
  bar.setState({
    project: 'a-very-long-project-name', session: 'ses_long', conn: 'ok',
    usage: { model: 'some-very-long-model-name', tokens: 123_456, costUsd: 1.23, durationMs: 120_000 },
  })
  const lines = bar.render(40)
  assert.equal(lines.length, 1)
  assert.ok(visibleWidth(lines[0]) <= 40)
})

test('status bar shows queued count, stash badge, and per-prompt timer', () => {
  const bar = new StatusBar()
  bar.setState({
    project: 'demo', session: 's', conn: 'ok', busy: true, queued: 2, stashed: 3,
    usage: { model: 'm', tokens: 1000, costUsd: 0.01, durationMs: 930_000, promptMs: 12_000 },
  })
  const clean = bar.render(120)[0].replace(/\x1b\[[0-9;]*m/g, '')
  assert.ok(clean.includes('busy'))
  assert.ok(clean.includes('queued 2'), '排队计数')
  assert.ok(clean.includes('📌3'), 'stash 徽标')
  assert.ok(clean.includes('12s'), 'per-prompt 计时')
  assert.ok(clean.includes('15m 30s'), '会话总时长')
})
