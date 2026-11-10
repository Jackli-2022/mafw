import { leadWorkingSetHook } from '../src/hooks/lead-working-set'

const response = (body: any, ok = true, status = 200) => ({
  ok,
  status,
  json: async () => body,
}) as any

describe('lead working-set hook', () => {
  test('injects one synthetic part', async () => {
    const output = {
      messages: [{
        info: { role: 'user', sessionID: 'ses_lead' },
        parts: [{ type: 'text', text: '继续 SQLite 迁移' }],
      }],
    }
    await leadWorkingSetHook({ sessionID: 'ses_lead' }, output, {
      fetchImpl: async () => response({
        blocks: [{ kind: 'recalled-topic', text: '<recalled-topic>…</recalled-topic>', tokens: 10 }],
      }),
    })
    const parts = output.messages[0].parts as any[]
    expect(parts).toHaveLength(2)
    expect(parts[1]).toMatchObject({ synthetic: true })
    expect(parts[1].text).toContain('<recalled-topic')
  })

  test('skips non-200, empty blocks and aborted fetches', async () => {
    const output = {
      messages: [{
        info: { role: 'user', sessionID: 'ses_lead' },
        parts: [{ type: 'text', text: 'hello' }],
      }],
    }

    await leadWorkingSetHook({ sessionID: 'ses_lead' }, output, {
      fetchImpl: async () => response({}, false, 503),
    })
    expect(output.messages[0].parts).toHaveLength(1)

    await leadWorkingSetHook({ sessionID: 'ses_lead' }, output, {
      fetchImpl: async () => response({ blocks: [] }),
    })
    expect(output.messages[0].parts).toHaveLength(1)

    await leadWorkingSetHook({ sessionID: 'ses_lead' }, output, {
      fetchImpl: (_url: any, init: any) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
      }),
    })
    expect(output.messages[0].parts).toHaveLength(1)
  })

  test('does not inject the same session+query twice', async () => {
    const output = {
      messages: [{
        info: { role: 'user', sessionID: 'ses_dedup' },
        parts: [{ type: 'text', text: '同一个问题' }],
      }],
    }
    let calls = 0
    const deps = {
      fetchImpl: async () => {
        calls += 1
        return response({ blocks: [{ text: '<recalled-topic>x</recalled-topic>' }] })
      },
    }
    await leadWorkingSetHook({ sessionID: 'ses_dedup' }, output, deps)
    await leadWorkingSetHook({ sessionID: 'ses_dedup' }, output, deps)
    expect(calls).toBe(1)
    expect(output.messages[0].parts).toHaveLength(2)
  })
})
