import { describe, expect, test } from 'bun:test'
import {
  buildMemoryReceiptView,
  relativeReceiptTime,
  splitMemoryText,
} from './memory-receipt'

const NOW = Date.parse('2026-11-18T12:00:00.000Z')

function dto(over: Record<string, unknown> = {}) {
  return {
    version: 1,
    status: 'inject',
    tookMs: 12,
    createdAt: '2026-11-18T11:59:00.000Z',
    updatedAt: '2026-11-18T11:59:00.000Z',
    topic: { title: 'Lead 外部事件回执卡片设计', hasRelated: true },
    memories: [
      {
        id: 'mem_a', type: 'semantic', abstraction: '用户偏好 TDD 先行',
        date: '2026-11-16T00:00:00.000Z', available: true,
      },
      {
        id: 'mem_b', type: 'procedural', abstraction: '合入后先核验',
        date: '2026-11-10T00:00:00.000Z', available: true, neighborOf: 'mem_a',
      },
    ],
    t1: [
      { traceId: 't1t_a', excerpt: '元信息怎么展示', available: true, source: 'user' },
    ],
    filteredT1: 2,
    counts: { memories: 1, t1: 1 },
    ...over,
  } as any
}

describe('relativeReceiptTime', () => {
  test('formats minutes, hours, days and dates', () => {
    expect(relativeReceiptTime('2026-11-18T11:59:30.000Z', NOW)).toBe('刚刚')
    expect(relativeReceiptTime('2026-11-18T11:58:00.000Z', NOW)).toBe('2 分钟前')
    expect(relativeReceiptTime('2026-11-18T09:00:00.000Z', NOW)).toBe('3 小时前')
    expect(relativeReceiptTime('2026-11-16T12:00:00.000Z', NOW)).toBe('2 天前')
    expect(relativeReceiptTime('2026-10-01T00:00:00.000Z', NOW)).toBe('10 月 1 日')
    expect(relativeReceiptTime(null, NOW)).toBe('')
  })
})

describe('splitMemoryText', () => {
  test('splits at a natural Chinese delimiter', () => {
    expect(splitMemoryText('MAFW 中复用既有代码前必须核对签名与副作用语义：SessionWorktreeManager 会 checkout 主仓'))
      .toEqual({
        title: 'MAFW 中复用既有代码前必须核对签名与副作用语义',
        body: 'SessionWorktreeManager 会 checkout 主仓',
      })
    expect(splitMemoryText('MAFW 会话收尾遗留未提交改动会被 checkout 静默丢失，收尾必须立即 commit'))
      .toEqual({
        title: 'MAFW 会话收尾遗留未提交改动会被 checkout 静默丢失',
        body: '收尾必须立即 commit',
      })
  })

  test('keeps short text as the title and leaves the body empty', () => {
    expect(splitMemoryText('参考外部方案先盘点后改')).toEqual({
      title: '参考外部方案先盘点后改',
      body: '',
    })
    expect(splitMemoryText('Review artifact double-encoding goal failure')).toEqual({
      title: 'Review artifact double-encoding goal failure',
      body: '',
    })
  })

  test('clips long unpunctuated text into a title plus the rest', () => {
    const view = splitMemoryText('MAFW 调研报告只存在当日会话输出中即丢失且仅靠记住教训无法阻止复发并且下一轮还会重复同样的错误而且继续在下一次会话里再丢一遍')
    expect(view.title.endsWith('…')).toBe(true)
    expect(view.title.length).toBeLessThanOrEqual(47)
    expect(view.body.length).toBeGreaterThan(0)
  })
})

describe('buildMemoryReceiptView', () => {
  test('builds a quiet trigger, separates primary from neighbors, and exposes T1', () => {
    const view = buildMemoryReceiptView(dto(), NOW)
    expect(view.pill).toBe('想起 1 件旧事')
    expect(view.header).toBe('想起的 1 件旧事')
    expect(view.latestLabel).toBe('2 天前')
    expect(view.statusCopy).toBe('')
    expect(view.primary).toHaveLength(1)
    expect(view.primary[0]).toMatchObject({ title: '用户偏好 TDD 先行', body: '', meta: '2 天前' })
    expect(view.neighbors).toHaveLength(1)
    expect(view.neighbors[0].title).toBe('合入后先核验')
    expect(view.neighborLabel).toBe('还有 1 条顺带想起')
    expect(view.t1).toHaveLength(1)
    expect(view.t1[0].excerpt).toBe('元信息怎么展示')
    expect(view.filteredLine).toBe('已过滤 2 段工具 / 子代理输出')
  })

  test('pill and card header count only primary memories, never neighbors', () => {
    const primary = Array.from({ length: 3 }, (_, i) => ({
      id: `mem_p${i}`, type: 'semantic', abstraction: `主记忆 ${i}`,
      date: '2026-11-16T00:00:00.000Z', available: true,
    }))
    const neighbors = Array.from({ length: 4 }, (_, i) => ({
      id: `mem_n${i}`, type: 'semantic', abstraction: `邻居 ${i}`,
      date: '2026-11-10T00:00:00.000Z', available: true, neighborOf: 'mem_p0',
    }))
    const view = buildMemoryReceiptView(dto({
      memories: [...primary, ...neighbors],
      t1: [],
      filteredT1: 0,
      counts: { memories: 3, t1: 0 },
    }), NOW)
    expect(view.pill).toBe('想起 3 件旧事')
    expect(view.header).toBe('想起的 3 件旧事')
    expect(view.primary).toHaveLength(3)
    expect(view.neighbors).toHaveLength(4)
    expect(view.neighborLabel).toBe('还有 4 条顺带想起')
  })

  test('uses status copy for weak and empty recall', () => {
    expect(buildMemoryReceiptView(dto({ status: 'low-confidence' }), NOW).statusCopy)
      .toBe('有点印象，但不确定')
    expect(buildMemoryReceiptView(dto({ status: 'no-memory', memories: [], t1: [], counts: { memories: 0, t1: 0 } }), NOW).statusCopy)
      .toBe('没找到相关记忆')
  })

  test('hides the neighbor line when there is no neighbor', () => {
    const view = buildMemoryReceiptView(dto({
      memories: [{
        id: 'mem_a', type: 'semantic', abstraction: '用户偏好 TDD 先行',
        date: '2026-11-16T00:00:00.000Z', available: true,
      }],
      t1: [],
      counts: { memories: 1, t1: 0 },
      filteredT1: 0,
    }), NOW)
    expect(view.neighborLabel).toBe('')
    expect(view.filteredLine).toBe('')
  })

  test('does not expose raw pointer ids in display strings', () => {
    const view = buildMemoryReceiptView(dto(), NOW)
    const rendered = JSON.stringify({ ...view, primary: view.primary.map(({ id, ...rest }) => rest) })
    expect(rendered).not.toContain('#mem-')
  })
})
