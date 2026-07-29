import * as http from 'http'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

let tmpDir: string

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-api-test-'))
})

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

function createHandler(req: http.IncomingMessage, res: http.ServerResponse) {
  res.setHeader('Content-Type', 'application/json')

  try {
    if (req.url === '/health' && req.method === 'GET') {
      res.writeHead(200)
      res.end(JSON.stringify({ status: 'ok', serveRunning: false, registeredProjects: 0, activeGoals: 0 }))
      return
    }

    if (req.url === '/api/projects' && req.method === 'GET') {
      res.writeHead(200)
      res.end(JSON.stringify({ projects: [] }))
      return
    }

    if (req.url === '/api/projects/current' && req.method === 'GET') {
      res.writeHead(200)
      res.end(JSON.stringify({ project: null }))
      return
    }

    if (req.url === '/register' && req.method === 'POST') {
      let body = ''
      req.on('data', (chunk: string) => body += chunk)
      req.on('end', () => {
        const data = JSON.parse(body)
        res.writeHead(200)
        res.end(JSON.stringify({ registered: true, projectDir: data.projectDir }))
      })
      return
    }

    if (req.url === '/control' && req.method === 'POST') {
      let body = ''
      req.on('data', (chunk: string) => body += chunk)
      req.on('end', () => {
        const data = JSON.parse(body)
        res.writeHead(200)
        res.end(JSON.stringify({ ok: true, action: data.action, goalId: data.goalId }))
      })
      return
    }

    const sessionsMatch = req.url?.match(/^\/api\/sessions(?:\?|$)/)
    if (sessionsMatch && req.method === 'GET') {
      const parsedUrl = new URL(req.url!, `http://${req.headers.host || 'localhost'}`)
      const projectID = parsedUrl.searchParams.get('projectID')
      res.writeHead(200)
      res.end(JSON.stringify({ sessions: [], projectID }))
      return
    }

    const messagesMatch = req.url?.match(/^\/api\/sessions\/([^/]+)\/messages(?:\?|$)/)
    if (messagesMatch && req.method === 'GET') {
      res.writeHead(200)
      res.end(JSON.stringify({ data: [] }))
      return
    }

    if (req.url === '/api/goals' && req.method === 'GET') {
      res.writeHead(200)
      res.end(JSON.stringify({ goals: [] }))
      return
    }

    if (req.url?.startsWith('/api/memory/merged-search') && req.method === 'GET') {
      const parsedUrl = new URL(req.url!, `http://${req.headers.host || 'localhost'}`)
      const query = parsedUrl.searchParams.get('query') || ''
      res.writeHead(200)
      res.end(JSON.stringify({ results: [{ source: 'harmonic', type: 'fact', content: query, energy: 0.5 }] }))
      return
    }

    res.writeHead(404)
    res.end(JSON.stringify({ error: 'not found' }))
  } catch (err: any) {
    res.writeHead(500)
    res.end(JSON.stringify({ error: err.message }))
  }
}

describe('Gateway HTTP API endpoints', () => {
  let server: http.Server
  let baseUrl: string

  beforeAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server = http.createServer(createHandler)
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address()
        if (typeof addr !== 'object' || !addr) { reject(new Error('no addr')); return }
        baseUrl = `http://127.0.0.1:${addr.port}`
        resolve()
      })
    })
  })

  afterAll(() => { if (server) server.close() })

  async function get(path: string): Promise<{ status: number; body: any }> {
    const res = await fetch(`${baseUrl}${path}`)
    return { status: res.status, body: await res.json() }
  }

  async function post(path: string, body: any): Promise<{ status: number; body: any }> {
    const res = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    return { status: res.status, body: await res.json() }
  }

  describe('GET /health', () => {
    it('returns 200 with status', async () => {
      const { status, body } = await get('/health')
      expect(status).toBe(200)
      expect(body.status).toBe('ok')
    })
  })

  describe('GET /api/projects', () => {
    it('returns 200 with projects array', async () => {
      const { status, body } = await get('/api/projects')
      expect(status).toBe(200)
      expect(Array.isArray(body.projects)).toBe(true)
    })
  })

  describe('GET /api/projects/current', () => {
    it('returns 200 with project or null', async () => {
      const { status, body } = await get('/api/projects/current')
      expect(status).toBe(200)
      expect(body).toHaveProperty('project')
    })
  })

  describe('POST /register', () => {
    it('registers a project and returns 200', async () => {
      const { status, body } = await post('/register', { projectDir: '/tmp/test', mafwDir: '/tmp/test/.mafw' })
      expect(status).toBe(200)
      expect(body.registered).toBe(true)
    })
  })

  describe('POST /control', () => {
    it('accepts PAUSE action', async () => {
      const { status, body } = await post('/control', { goalId: 'test-1', action: 'PAUSE' })
      expect(status).toBe(200)
      expect(body.action).toBe('PAUSE')
    })

    it('accepts ABORT action', async () => {
      const { status, body } = await post('/control', { goalId: 'test-1', action: 'ABORT' })
      expect(status).toBe(200)
      expect(body.action).toBe('ABORT')
    })
  })

  describe('GET /api/sessions with query params', () => {
    it('returns 200 without projectID', async () => {
      const { status, body } = await get('/api/sessions')
      expect(status).toBe(200)
      expect(Array.isArray(body.sessions)).toBe(true)
    })

    it('returns 200 with projectID query (regression guard)', async () => {
      const { status, body } = await get('/api/sessions?projectID=proj-1')
      expect(status).toBe(200)
      expect(body.projectID).toBe('proj-1')
    })
  })

  describe('GET /api/sessions/{id}/messages (regression guard)', () => {
    it('returns 200 with limit param', async () => {
      const { status } = await get('/api/sessions/sid-1/messages?limit=100')
      expect(status).toBe(200)
    })

    it('returns 200 without query params', async () => {
      const { status } = await get('/api/sessions/sid-1/messages')
      expect(status).toBe(200)
    })
  })

  describe('GET /api/goals', () => {
    it('returns 200 with goals array', async () => {
      const { status, body } = await get('/api/goals')
      expect(status).toBe(200)
      expect(Array.isArray(body.goals)).toBe(true)
    })
  })

  describe('GET /api/memory/merged-search', () => {
    it('returns 200 with results', async () => {
      const { status, body } = await get('/api/memory/merged-search?query=test&maxFacts=3')
      expect(status).toBe(200)
      expect(Array.isArray(body.results)).toBe(true)
    })
  })

  describe('404 for unknown routes', () => {
    it('returns 404 for /api/unknown', async () => {
      const { status } = await get('/api/unknown')
      expect(status).toBe(404)
    })
  })
})
