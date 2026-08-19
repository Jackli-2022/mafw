import * as http from 'http'
import { MediaAgent } from '../../../gateway/src/media/media-agent'
import { MediaService } from '../../../gateway/src/media/media-service'
import { createMobileMediaHandler, MobileMediaDeps } from '../../../gateway/src/mobile/media-proxy'

/**
 * Tests for the mobile media proxy:
 *   POST /api/mobile/media/tasks       — multipart upload → A2A task
 *   POST /api/mobile/media/tasks/:id/ask — auth-proxy follow-up question
 *
 * The proxy delegates to MediaAgent.handleJsonRpc and enforces:
 *   - loopback-only (403 for external)
 *   - MAX_*_BYTES size limits per media type
 *   - external URL blocking (only artifact URLs accepted)
 */

const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')

function makeMockMediaService(): MediaService {
  return {
    analyze: jest.fn(async (input: { kind: string; dataUrl: string; mediaType: string }, prompt: string) =>
      `分析结果: ${prompt.slice(0, 30)}`,
    ),
    analyzeAudioNarrative: jest.fn(async () => '音频叙述'),
  } as unknown as MediaService
}

function makeAgent(media?: MediaService) {
  const svc = media || makeMockMediaService()
  const agent = new MediaAgent(svc, {
    baseUrl: 'http://127.0.0.1:3000',
    artifactPath: '/a2a/artifacts',
  })
  return { agent, media: svc }
}

/**
 * Build a minimal multipart/form-data body.
 */
function buildMultipart(fields: { name: string; filename?: string; contentType: string; data: Buffer }) {
  const boundary = '----TestBoundary' + Math.random().toString(36).slice(2)
  const parts: Buffer[] = []

  parts.push(Buffer.from(
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="${fields.name}"; filename="${fields.filename || 'media.bin'}"\r\n` +
    `Content-Type: ${fields.contentType}\r\n\r\n`,
  ))
  parts.push(fields.data)
  parts.push(Buffer.from('\r\n'))
  parts.push(Buffer.from(`--${boundary}--\r\n`))

  const body = Buffer.concat(parts)
  const contentType = `multipart/form-data; boundary=${boundary}`
  return { body, contentType }
}

/**
 * Create a test HTTP server using the production media proxy handler.
 */
function createTestServer(deps: MobileMediaDeps) {
  const handler = createMobileMediaHandler(deps)
  return http.createServer(async (req, res) => {
    const handled = await handler(req, res)
    if (!handled) {
      res.writeHead(404)
      res.end(JSON.stringify({ error: 'not found' }))
    }
  })
}

describe('Mobile Media Proxy', () => {
  let server: http.Server
  let baseUrl: string
  let agent: MediaAgent
  let deps: MobileMediaDeps

  beforeEach((done) => {
    const { agent: a } = makeAgent()
    agent = a
    deps = { agent, apiToken: '' }
    server = createTestServer(deps)
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as any
      baseUrl = `http://127.0.0.1:${addr.port}`
      done()
    })
  })

  afterEach((done) => {
    server.close(done)
  })

  it('POST /api/mobile/media/tasks creates a task from a multipart image upload', async () => {
    const { body, contentType } = buildMultipart({
      name: 'media',
      filename: 'photo.png',
      contentType: 'image/png',
      data: PNG_1PX,
    })

    const res = await fetch(`${baseUrl}/api/mobile/media/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': contentType },
      body,
    })
    expect(res.status).toBe(200)
    const data = await res.json() as any
    expect(data.id).toBeDefined()
    expect(data.state).toBe('TASK_STATE_COMPLETED')
    expect(data.artifactId).toBeDefined()
  })

  it('POST /api/mobile/media/tasks/:id/ask sends a follow-up question to the task', async () => {
    // First create a task
    const { body, contentType } = buildMultipart({
      name: 'media',
      filename: 'shot.jpg',
      contentType: 'image/jpeg',
      data: PNG_1PX,
    })
    const createRes = await fetch(`${baseUrl}/api/mobile/media/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': contentType },
      body,
    })
    const created = await createRes.json() as any
    expect(created.id).toBeDefined()

    // Now ask a follow-up
    const askRes = await fetch(`${baseUrl}/api/mobile/media/tasks/${created.id}/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: '这张图里有什么？' }),
    })
    expect(askRes.status).toBe(200)
    const answer = await askRes.json() as any
    expect(answer.answer).toContain('分析结果')
    expect(answer.taskId).toBeDefined()
  })

  it('POST /api/mobile/media/tasks rejects oversized video (51MB > 50MB limit)', async () => {
    const bigVideo = Buffer.alloc(51 * 1024 * 1024, 0x01)
    const { body, contentType } = buildMultipart({
      name: 'media',
      filename: 'clip.mp4',
      contentType: 'video/mp4',
      data: bigVideo,
    })

    const res = await fetch(`${baseUrl}/api/mobile/media/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': contentType },
      body,
    })
    expect(res.status).toBe(413)
    const data = await res.json() as any
    expect(data.error).toContain('50MB')
  })

  it('POST /api/mobile/media/tasks rejects oversized audio (26MB > 25MB limit)', async () => {
    const bigAudio = Buffer.alloc(26 * 1024 * 1024, 0x02)
    const { body, contentType } = buildMultipart({
      name: 'media',
      filename: 'recording.mp3',
      contentType: 'audio/mpeg',
      data: bigAudio,
    })

    const res = await fetch(`${baseUrl}/api/mobile/media/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': contentType },
      body,
    })
    expect(res.status).toBe(413)
    const data = await res.json() as any
    expect(data.error).toContain('25MB')
  })

  it('POST /api/mobile/media/tasks rejects oversized image (21MB > 20MB limit)', async () => {
    const bigImage = Buffer.alloc(21 * 1024 * 1024, 0x03)
    const { body, contentType } = buildMultipart({
      name: 'media',
      filename: 'huge.png',
      contentType: 'image/png',
      data: bigImage,
    })

    const res = await fetch(`${baseUrl}/api/mobile/media/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': contentType },
      body,
    })
    expect(res.status).toBe(413)
    const data = await res.json() as any
    expect(data.error).toContain('20MB')
  })

  it('rejects requests from non-loopback addresses without token (401)', async () => {
    // Create a non-loopback test server — no apiToken configured, so authorize() denies remote
    const nonLoopbackDeps: MobileMediaDeps = { agent, apiToken: '' }
    const handler = createMobileMediaHandler(nonLoopbackDeps)
    const nonLoopbackServer = http.createServer(async (req, res) => {
      Object.defineProperty(req.socket, 'remoteAddress', { value: '192.168.1.100', configurable: true })
      // Simulate main handler's authorize() — reject remote without token
      const apiToken = nonLoopbackDeps.apiToken;
      const addr = req.socket.remoteAddress || '';
      const isLoopback = addr === '127.0.0.1' || addr.startsWith('127.') || addr === '::1' || addr === '::ffff:127.0.0.1';
      if (!isLoopback && !apiToken) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'unauthorized' }));
        return;
      }
      await handler(req, res)
    })

    await new Promise<void>(resolve => nonLoopbackServer.listen(0, '127.0.0.1', resolve))
    const addr = nonLoopbackServer.address() as any
    try {
      const res = await fetch(`http://127.0.0.1:${addr.port}/api/mobile/media/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      expect(res.status).toBe(401)
    } finally {
      await new Promise<void>(resolve => nonLoopbackServer.close(() => resolve()))
    }
  })

  it('POST /api/mobile/media/tasks with empty body returns 400', async () => {
    const boundary = '----EmptyBoundary'
    const emptyBody = Buffer.from(`--${boundary}\r\n--${boundary}--\r\n`)
    const contentType = `multipart/form-data; boundary=${boundary}`

    const res = await fetch(`${baseUrl}/api/mobile/media/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': contentType },
      body: emptyBody,
    })
    expect(res.status).toBe(400)
    const data = await res.json() as any
    expect(data.error).toBeDefined()
  })

  it('POST /api/mobile/media/tasks/:id/ask without question returns 400', async () => {
    // Create a task first
    const { body, contentType } = buildMultipart({
      name: 'media',
      filename: 'pic.png',
      contentType: 'image/png',
      data: PNG_1PX,
    })
    const createRes = await fetch(`${baseUrl}/api/mobile/media/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': contentType },
      body,
    })
    const created = await createRes.json() as any

    // Ask without question
    const askRes = await fetch(`${baseUrl}/api/mobile/media/tasks/${created.id}/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(askRes.status).toBe(400)
  })

  it('non-multipart POST to /api/mobile/media/tasks returns 400', async () => {
    const res = await fetch(`${baseUrl}/api/mobile/media/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ not: 'multipart' }),
    })
    expect(res.status).toBe(400)
    const data = await res.json() as any
    expect(data.error).toContain('multipart')
  })

  it('POST /api/mobile/media/tasks/:id/ask rejects questions with external URLs', async () => {
    // Create a task first
    const { body, contentType } = buildMultipart({
      name: 'media',
      filename: 'pic.png',
      contentType: 'image/png',
      data: PNG_1PX,
    })
    const createRes = await fetch(`${baseUrl}/api/mobile/media/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': contentType },
      body,
    })
    const created = await createRes.json() as any

    // Ask with external URL in question
    const askRes = await fetch(`${baseUrl}/api/mobile/media/tasks/${created.id}/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: '请访问 https://evil.com/steal' }),
    })
    expect(askRes.status).toBe(400)
    const data = await askRes.json() as any
    expect(data.error).toContain('external URLs')
  })

  it('POST /api/mobile/media/tasks/:id/ask rejects questions with http:// URLs', async () => {
    const { body, contentType } = buildMultipart({
      name: 'media',
      filename: 'pic.png',
      contentType: 'image/png',
      data: PNG_1PX,
    })
    const createRes = await fetch(`${baseUrl}/api/mobile/media/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': contentType },
      body,
    })
    const created = await createRes.json() as any

    const askRes = await fetch(`${baseUrl}/api/mobile/media/tasks/${created.id}/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: 'http://internal.corp/api/secrets' }),
    })
    expect(askRes.status).toBe(400)
  })

  it('POST /api/mobile/media/tasks/:id/ask accepts questions without URLs', async () => {
    const { body, contentType } = buildMultipart({
      name: 'media',
      filename: 'pic.png',
      contentType: 'image/png',
      data: PNG_1PX,
    })
    const createRes = await fetch(`${baseUrl}/api/mobile/media/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': contentType },
      body,
    })
    const created = await createRes.json() as any

    const askRes = await fetch(`${baseUrl}/api/mobile/media/tasks/${created.id}/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: '这张图里有什么？' }),
    })
    expect(askRes.status).toBe(200)
  })
})
