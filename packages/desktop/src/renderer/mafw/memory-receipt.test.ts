import { describe, expect, test } from 'bun:test'
import {
  buildMemoryReceiptView,
  relativeReceiptTime,
  typeLabel,
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

describe('typeLabel', () => {
  test('maps memory types to plain words', () => {
    expect(typeLabel('semantic')).toBe('事实')
    expect(typeLabel('procedural')).toBe('做法')
    expect(typeLabel('global')).toBe('通用')
    expect(typeLabel('episodic')).toBe('往事')
    expect(typeLabel('unknown')).toBe('记忆')
  })
})

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

describe('buildMemoryReceiptView', () => {
  test('builds the pill, groups memories and T1, and exposes the filtered line', () => {
    const view = buildMemoryReceiptView(dto(), NOW)
    expect(view.pill).toBe('想起了 1 件事')
    expect(view.sub).toBe('1 段摘要')
    expect(view.statusCopy).toBe('')
    expect(view.memories).toHaveLength(2)
    expect(view.memories[0]).toMatchObject({ label: '事实', text: '用户偏好 TDD 先行', neighbor: false })
    expect(view.memories[1]).toMatchObject({ label: '做法', neighbor: true })
    expect(view.t1).toHaveLength(1)
    expect(view.t1[0].excerpt).toBe('元信息怎么展示')
    expect(view.filteredLine).toBe('已过滤 2 段工具 / 子代理输出')
  })

  test('uses status copy for weak and empty recall', () => {
    expect(buildMemoryReceiptView(dto({ status: 'low-confidence' }), NOW).statusCopy)
      .toBe('有点印象，但不确定')
    expect(buildMemoryReceiptView(dto({ status: 'no-memory', memories: [], t1: [], counts: { memories: 0, t1: 0 } }), NOW).statusCopy)
      .toBe('没找到相关记忆')
  })

  test('hides the summary segment when there is no T1', () => {
    const view = buildMemoryReceiptView(dto({ t1: [], counts: { memories: 1, t1: 0 }, filteredT1: 0 }), NOW)
    expect(view.sub).toBe('')
    expect(view.filteredLine).toBe('')
  })

  test('does not expose raw pointer ids in display strings', () => {
    const view = buildMemoryReceiptView(dto(), NOW)
    const rendered = JSON.stringify({ ...view, memories: view.memories.map(({ id, ...rest }) => rest) })
    expect(rendered).not.toContain('#mem-')
  })
})
