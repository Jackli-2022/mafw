import { describe, expect, test } from 'bun:test'
import { buildMemoryReceiptView } from './memory-receipt'

const NOW = Date.parse('2026-11-18T12:00:00.000Z')

describe('real recall fixture (2026-11-18)', () => {
  test('shows three memories and one human T1, never tool/subagent noise', () => {
    const view = buildMemoryReceiptView({
      version: 1,
      status: 'inject',
      tookMs: 18,
      createdAt: '2026-11-18T11:58:00.000Z',
      updatedAt: '2026-11-18T11:58:00.000Z',
      topic: { title: 'Lead 外部事件回执卡片设计', hasRelated: true },
      memories: [
        {
          id: 'mem_hr6b9b',
          type: 'semantic',
          abstraction: '汇报只讲组装结构与改动点，精简不上无关细节步骤',
          date: '2026-11-18T00:00:00.000Z',
          available: true,
        },
        {
          id: 'mem_4bb01b',
          type: 'semantic',
          abstraction: '用户对 desktop 工具卡折叠/摘要的信息密度跨迭代稳定偏好极简计数式呈现',
          date: '2026-11-10T00:00:00.000Z',
          available: true,
          neighborOf: 'mem_hr6b9b',
        },
        {
          id: 'mem_h3qm2x',
          type: 'procedural',
          abstraction: '合入后先核验结果再继续',
          date: '2026-11-09T00:00:00.000Z',
          available: true,
        },
      ],
      t1: [
        { traceId: 't1t_keep', excerpt: '元信息怎么展示', available: true, source: 'user', sessionId: 's1' },
      ],
      filteredT1: 2,
      counts: { memories: 2, t1: 1 },
    }, NOW)

    expect(view.primary).toHaveLength(2)
    expect(view.neighbors).toHaveLength(1)
    expect(view.neighborLabel).toBe('还有 1 条顺带想起')
    expect(view.t1).toHaveLength(1)
    expect(view.t1[0].excerpt).toBe('元信息怎么展示')
    expect(view.filteredLine).toBe('已过滤 2 段工具 / 子代理输出')
    const rendered = JSON.stringify(view)
    expect(rendered).not.toContain('ok | packages')
    expect(rendered).not.toContain('You are a subagent')
  })
})
