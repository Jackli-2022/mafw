import { test } from 'node:test'
import assert from 'node:assert/strict'
import { usageLines } from '../src/ui/usage-overlay.ts'

const TOK = { input: 100, output: 50, reasoning: 10, cache: { read: 200, write: 0 } }

test('renders session/project/global KPI rows with real gateway shape', () => {
  const lines = usageLines({
    session: { totalTokens: { input: 900000, output: 300000, reasoning: 50000, cache: { read: 400000, write: 0 } }, totalCost: 0.5678, turnCount: 12 },
    project: { totalTokens: TOK, totalCost: 1.234, turnCount: 40, sessionCount: 3 },
    global: { totalTokens: TOK, totalCost: 9.99, turnCount: 100, sessionCount: 8 },
  })
  const text = lines.join('\n')
  assert.ok(text.includes('本会话'))
  assert.ok(text.includes('1.6M'))        // session 总量 900K+300K+50K+缓存400K = 1.65M
  assert.ok(text.includes('$0.57'))       // session 成本
  assert.ok(text.includes('项目'))
  assert.ok(text.includes('$1.23'))
  assert.ok(text.includes('全局'))
  assert.ok(text.includes('$9.99'))
})

test('missing/null blocks → — placeholders, no throw', () => {
  const lines = usageLines({ session: null, project: null, global: null })
  assert.ok(lines.join('\n').includes('—'))
})

test('empty envelope → no throw', () => {
  assert.ok(usageLines({}).length > 0)
})
