import { leadBoundaryHook } from '../src/hooks/lead-boundary'

describe('lead boundary hook', () => {
  test('posts user text fire-and-forget and never throws', async () => {
    let url = ''
    let body: any = null
    await leadBoundaryHook({ sessionID: 'ses_lead', text: '换个话题，聊 UI' }, {
      fetchImpl: async (input: any, init: any) => {
        url = String(input)
        body = JSON.parse(init.body)
        return { ok: true, status: 200, json: async () => ({}) } as any
      },
    })
    expect(url).toContain('/api/lead/boundaries/observe')
    expect(body).toMatchObject({ sessionID: 'ses_lead', text: '换个话题，聊 UI' })
  })

  test('swallows network and timeout errors', async () => {
    await expect(leadBoundaryHook({ sessionID: 'ses_lead', text: 'x' }, {
      fetchImpl: async () => { throw new Error('offline') },
    })).resolves.toBeUndefined()
  })
})
