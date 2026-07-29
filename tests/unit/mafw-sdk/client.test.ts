import { MafwClient } from '../../../mafw-sdk/src/client/client'

const BASE = 'http://test:3000'

function mockFetch(status: number, body: any, ok = status >= 200 && status < 300): void {
  globalThis.fetch = jest.fn().mockResolvedValue({
    ok,
    status,
    statusText: status === 404 ? 'Not Found' : status === 500 ? 'Internal Server Error' : 'OK',
    json: jest.fn().mockResolvedValue(body),
    headers: new Headers({ 'content-type': 'application/json' }),
  } as any)
}

afterEach(() => { jest.restoreAllMocks() })

describe('MafwClient constructor', () => {
  it('defaults to localhost:3000', () => {
    const c = new MafwClient()
    expect(c.baseUrl).toBe('http://localhost:3000')
  })

  it('accepts custom URL', () => {
    const c = new MafwClient('http://custom:5000')
    expect(c.baseUrl).toBe('http://custom:5000')
  })
})

describe('session namespace', () => {
  it('list sends GET /api/sessions', async () => {
    mockFetch(200, { sessions: [{ id: 's1' }] })
    const c = new MafwClient(BASE)
    const res = await c.session.list()
    expect(res).toHaveLength(1)
    expect(res[0].id).toBe('s1')
    expect(globalThis.fetch).toHaveBeenCalledWith(`${BASE}/api/sessions`, expect.anything())
  })

  it('list with projectID sends query param', async () => {
    mockFetch(200, { sessions: [] })
    const c = new MafwClient(BASE)
    await c.session.list('proj-1')
    expect(globalThis.fetch).toHaveBeenCalledWith(`${BASE}/api/sessions?projectID=proj-1`, expect.anything())
  })

  it('create sends POST /api/session', async () => {
    mockFetch(200, { id: 's2', projectID: '.', directory: '.', title: 'test', time: { created: 1, updated: 1 } })
    const c = new MafwClient(BASE)
    const res = await c.session.create({ directory: '/test' })
    expect(res.id).toBe('s2')
    const call = (globalThis.fetch as jest.Mock).mock.calls[0]
    expect(call[0]).toBe(`${BASE}/api/session`)
    expect(call[1].method).toBe('POST')
    expect(JSON.parse(call[1].body)).toMatchObject({ directory: '/test' })
  })

  it('messages sends GET /api/sessions/{id}/messages with limit', async () => {
    mockFetch(200, { data: [] })
    const c = new MafwClient(BASE)
    await c.session.messages('sid-1', 50)
    expect(globalThis.fetch).toHaveBeenCalledWith(`${BASE}/api/sessions/sid-1/messages?limit=50`, expect.anything())
  })

  it('delete sends DELETE /api/session/{id}', async () => {
    mockFetch(200, {})
    const c = new MafwClient(BASE)
    await c.session.delete({ sessionID: 'sid-1' })
    expect(globalThis.fetch).toHaveBeenCalledWith(`${BASE}/api/session/sid-1`, expect.objectContaining({ method: 'DELETE' }))
  })

  it('returns empty array on missing sessions field', async () => {
    mockFetch(200, {})
    const c = new MafwClient(BASE)
    const res = await c.session.list()
    expect(res).toEqual([])
  })
})

describe('project namespace', () => {
  it('list sends GET /api/projects', async () => {
    mockFetch(200, { projects: [{ id: 'p1', worktree: '/proj' }] })
    const c = new MafwClient(BASE)
    const res = await c.project.list()
    expect(res).toHaveLength(1)
    expect(res[0].id).toBe('p1')
  })

  it('current returns project object', async () => {
    mockFetch(200, { project: { id: 'p1', worktree: '/proj', mafwDir: '/proj/.mafw' } })
    const c = new MafwClient(BASE)
    const res = await c.project.current()
    expect(res).not.toBeNull()
    expect(res!.worktree).toBe('/proj')
  })

  it('current returns null when no project', async () => {
    mockFetch(200, { project: null })
    const c = new MafwClient(BASE)
    const res = await c.project.current()
    expect(res).toBeNull()
  })

  it('setCurrent sends POST /register', async () => {
    mockFetch(200, {})
    const c = new MafwClient(BASE)
    await c.project.setCurrent('/my/proj')
    const call = (globalThis.fetch as jest.Mock).mock.calls[0]
    expect(call[0]).toBe(`${BASE}/register`)
    expect(call[1].method).toBe('POST')
    expect(JSON.parse(call[1].body)).toMatchObject({ projectDir: '/my/proj', mafwDir: '/my/proj/.mafw' })
  })
})

describe('goals namespace', () => {
  it('list sends GET /api/goals', async () => {
    mockFetch(200, { goals: [{ goalId: 'g1', phase: 'PLANNING', loop: 1, currentWave: 0, totalWaves: 3 }] })
    const c = new MafwClient(BASE)
    const res = await c.goals.list()
    expect(res).toHaveLength(1)
    expect(res[0].goalId).toBe('g1')
  })

  it('control sends POST /control', async () => {
    mockFetch(200, {})
    const c = new MafwClient(BASE)
    await c.goals.control({ goalId: 'g1', action: 'PAUSE' })
    const call = (globalThis.fetch as jest.Mock).mock.calls[0]
    expect(call[0]).toBe(`${BASE}/control`)
    expect(JSON.parse(call[1].body)).toMatchObject({ goalId: 'g1', action: 'PAUSE' })
  })
})

describe('memory namespace', () => {
  it('search sends GET /api/memory/search with query', async () => {
    mockFetch(200, { results: [] })
    const c = new MafwClient(BASE)
    await c.memory.search({ query: 'test' })
    expect(globalThis.fetch).toHaveBeenCalledWith(expect.stringContaining('/api/memory/search?query=test'), expect.anything())
  })

  it('search with topK and goalId', async () => {
    mockFetch(200, { results: [] })
    const c = new MafwClient(BASE)
    await c.memory.search({ query: 'x', topK: 5, goalId: 'g1' })
    expect(globalThis.fetch).toHaveBeenCalledWith(expect.stringContaining('topK=5'), expect.anything())
    expect(globalThis.fetch).toHaveBeenCalledWith(expect.stringContaining('goalId=g1'), expect.anything())
  })

  it('mergedSearch sends GET /api/memory/merged-search', async () => {
    mockFetch(200, { results: [] })
    const c = new MafwClient(BASE)
    await c.memory.mergedSearch({ query: 'test', maxFacts: 3 })
    expect(globalThis.fetch).toHaveBeenCalledWith(expect.stringContaining('/api/memory/merged-search?query=test'), expect.anything())
  })

  it('delete sends DELETE /api/memory/{id}', async () => {
    mockFetch(200, {})
    const c = new MafwClient(BASE)
    await c.memory.delete('mem-1')
    expect(globalThis.fetch).toHaveBeenCalledWith(`${BASE}/api/memory/mem-1`, expect.objectContaining({ method: 'DELETE' }))
  })
})

describe('approvals namespace', () => {
  it('list sends GET /api/approvals', async () => {
    mockFetch(200, { approvals: [{ id: 'a1', goalId: 'g1', question: '?', status: 'pending', createdAt: '' }] })
    const c = new MafwClient(BASE)
    const res = await c.approvals.list()
    expect(res).toHaveLength(1)
    expect(res[0].id).toBe('a1')
  })

  it('respond sends POST /api/approvals/{id}/respond', async () => {
    mockFetch(200, {})
    const c = new MafwClient(BASE)
    await c.approvals.respond('a1', 'approve')
    expect(globalThis.fetch).toHaveBeenCalledWith(`${BASE}/api/approvals/a1/respond`, expect.objectContaining({ method: 'POST' }))
  })
})

describe('triage namespace', () => {
  it('list sends GET /api/triage', async () => {
    mockFetch(200, { items: [{ id: 't1', summary: 'test', automationId: 'a1', severity: 'high', state: 'PENDING_CONFIRMATION', discoveredAt: '' }] })
    const c = new MafwClient(BASE)
    const res = await c.triage.list()
    expect(res).toHaveLength(1)
    expect(res[0].id).toBe('t1')
  })

  it('dismiss sends POST /api/triage/{id}/dismiss', async () => {
    mockFetch(200, {})
    const c = new MafwClient(BASE)
    await c.triage.dismiss('t1')
    expect(globalThis.fetch).toHaveBeenCalledWith(`${BASE}/api/triage/t1/dismiss`, expect.objectContaining({ method: 'POST' }))
  })
})

describe('automations namespace', () => {
  it('list sends GET /api/automations', async () => {
    mockFetch(200, { rules: [{ id: 'r1', enabled: true }] })
    const c = new MafwClient(BASE)
    const res = await c.automations.list()
    expect(res).toHaveLength(1)
    expect(res[0].id).toBe('r1')
  })

  it('toggle sends PUT /api/automations/{id}', async () => {
    mockFetch(200, {})
    const c = new MafwClient(BASE)
    await c.automations.toggle('r1', false)
    expect(globalThis.fetch).toHaveBeenCalledWith(`${BASE}/api/automations/r1`, expect.objectContaining({ method: 'PUT' }))
    const body = JSON.parse((globalThis.fetch as jest.Mock).mock.calls[0][1].body)
    expect(body).toMatchObject({ enabled: false })
  })
})

describe('chat namespace', () => {
  it('send calls POST /api/chat', async () => {
    mockFetch(200, { sessionID: 's1' })
    const c = new MafwClient(BASE)
    const res = await c.chat.send('hello')
    expect(res.sessionID).toBe('s1')
    const body = JSON.parse((globalThis.fetch as jest.Mock).mock.calls[0][1].body)
    expect(body).toMatchObject({ message: 'hello' })
  })

  it('sendEnriched calls POST /api/chat/enriched', async () => {
    mockFetch(200, { sessionID: 's2' })
    const c = new MafwClient(BASE)
    await c.chat.sendEnriched('hi')
    expect(globalThis.fetch).toHaveBeenCalledWith(`${BASE}/api/chat/enriched`, expect.anything())
  })
})

describe('config namespace', () => {
  it('get calls GET /api/config', async () => {
    mockFetch(200, { server: { port: 3000 } })
    const c = new MafwClient(BASE)
    const res = await c.config.get()
    expect(res.server.port).toBe(3000)
  })
})

describe('error handling', () => {
  it('throws on HTTP 404', async () => {
    mockFetch(404, { error: 'not found' }, false)
    const c = new MafwClient(BASE)
    await expect(c.project.list()).rejects.toThrow('HTTP 404')
  })

  it('throws on HTTP 500', async () => {
    mockFetch(500, { error: 'server error' }, false)
    const c = new MafwClient(BASE)
    await expect(c.project.list()).rejects.toThrow('HTTP 500')
  })

  it('returns empty array on missing results field', async () => {
    mockFetch(200, {})
    const c = new MafwClient(BASE)
    const res = await c.memory.search({ query: 'x' })
    expect(res).toEqual([])
  })
})
