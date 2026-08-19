import * as http from 'http'
import { MediaAgent } from '../../../gateway/src/media/media-agent'
import { MediaService } from '../../../gateway/src/media/media-service'
import { createTtsArtifactHandler } from '../../../gateway/src/mobile/tts-artifact'

/**
 * Tests for mobile TTS artifact playback:
 *   GET /api/mobile/tts/artifacts/:id — token-authed artifact bytes for
 *   just_audio playback over LAN/Tailscale (loopback-only /a2a/artifacts
 *   stays untouched).
 *
 * The test server mirrors the production wiring from gateway/src/index.ts:
 * authorize() middleware (Bearer / x-api-token / ?token=, loopback passes)
 * in front of the production handler.
 */

const API_TOKEN = 'test-token-123'
const WAV_BYTES = Buffer.from(
  'UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=',
  'base64',
)

function makeMockMediaService(): MediaService {
  return {
    analyze: jest.fn(async () => '分析结果'),
    analyzeAudioNarrative: jest.fn(async () => '音频叙述'),
  } as unknown as MediaService
}

/** authorize() replicated from gateway/src/index.ts (Bearer/x-api-token/?token=; loopback passes). */
function authorize(req: http.IncomingMessage, apiToken: string): boolean {
  const addr = req.socket.remoteAddress || ''
  const isLoopback = addr === '127.0.0.1' || addr.startsWith('127.') || addr === '::1' || addr === '::ffff:127.0.0.1'
  if (isLoopback) return true
  if (!apiToken) return false
  const h = String(req.headers.authorization || '')
  const bearer = h.startsWith('Bearer ') ? h.slice(7) : ''
  const xToken = String(req.headers['x-api-token'] || '')
  const qToken = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`).searchParams.get('token') || ''
  return bearer === apiToken || xToken === apiToken || qToken === apiToken
}

function createTestServer(opts: { apiToken: string; remoteAddress?: string }) {
  const svc = makeMockMediaService()
  const agent = new MediaAgent(svc, {
    baseUrl: 'http://127.0.0.1:3000',
    artifactPath: '/a2a/artifacts',
  })
  const artifactId = agent.putArtifact(`data:audio/wav;base64,${WAV_BYTES.toString('base64')}`)
  const handler = createTtsArtifactHandler({ agent })
  const server = http.createServer(async (req, res) => {
    if (opts.remoteAddress) {
      Object.defineProperty(req.socket, 'remoteAddress', { value: opts.remoteAddress, configurable: true })
    }
    if (!authorize(req, opts.apiToken)) {
      res.writeHead(401, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'unauthorized' }))
      return
    }
    const handled = await handler(req, res)
    if (!handled) {
      res.writeHead(404)
      res.end(JSON.stringify({ error: 'not found' }))
    }
  })
  return { server, artifactId }
}

async function listen(server: http.Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const addr = server.address() as any
  return `http://127.0.0.1:${addr.port}`
}

describe('Mobile TTS Artifact Playback', () => {
  afterEach(async () => {
    // servers closed in each test
  })

  it('GET /api/mobile/tts/artifacts/:id from non-loopback without token returns 401', async () => {
    const { server, artifactId } = createTestServer({ apiToken: API_TOKEN, remoteAddress: '192.168.1.100' })
    const baseUrl = await listen(server)
    try {
      const res = await fetch(`${baseUrl}/api/mobile/tts/artifacts/${artifactId}`)
      expect(res.status).toBe(401)
      const data = (await res.json()) as any
      expect(data.error).toBe('unauthorized')
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  it('GET /api/mobile/tts/artifacts/:id from non-loopback with Bearer token returns 200 and matching bytes', async () => {
    const { server, artifactId } = createTestServer({ apiToken: API_TOKEN, remoteAddress: '192.168.1.100' })
    const baseUrl = await listen(server)
    try {
      const res = await fetch(`${baseUrl}/api/mobile/tts/artifacts/${artifactId}`, {
        headers: { Authorization: `Bearer ${API_TOKEN}` },
      })
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toBe('audio/wav')
      const bytes = Buffer.from(await res.arrayBuffer())
      expect(bytes.equals(WAV_BYTES)).toBe(true)
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  it('GET /api/mobile/tts/artifacts/:id accepts x-api-token header from non-loopback', async () => {
    const { server, artifactId } = createTestServer({ apiToken: API_TOKEN, remoteAddress: '10.0.0.5' })
    const baseUrl = await listen(server)
    try {
      const res = await fetch(`${baseUrl}/api/mobile/tts/artifacts/${artifactId}`, {
        headers: { 'x-api-token': API_TOKEN },
      })
      expect(res.status).toBe(200)
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  it('GET /api/mobile/tts/artifacts/:id with wrong token returns 401', async () => {
    const { server, artifactId } = createTestServer({ apiToken: API_TOKEN, remoteAddress: '192.168.1.100' })
    const baseUrl = await listen(server)
    try {
      const res = await fetch(`${baseUrl}/api/mobile/tts/artifacts/${artifactId}`, {
        headers: { Authorization: 'Bearer wrong-token' },
      })
      expect(res.status).toBe(401)
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  it('GET /api/mobile/tts/artifacts/:id from loopback without token returns 200 (loopback bypass)', async () => {
    const { server, artifactId } = createTestServer({ apiToken: API_TOKEN })
    const baseUrl = await listen(server)
    try {
      const res = await fetch(`${baseUrl}/api/mobile/tts/artifacts/${artifactId}`)
      expect(res.status).toBe(200)
      const bytes = Buffer.from(await res.arrayBuffer())
      expect(bytes.equals(WAV_BYTES)).toBe(true)
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  it('GET /api/mobile/tts/artifacts/:id with query string still matches and unknown id returns 404', async () => {
    const { server, artifactId } = createTestServer({ apiToken: API_TOKEN, remoteAddress: '192.168.1.100' })
    const baseUrl = await listen(server)
    try {
      const ok = await fetch(`${baseUrl}/api/mobile/tts/artifacts/${artifactId}?x=1`, {
        headers: { Authorization: `Bearer ${API_TOKEN}` },
      })
      expect(ok.status).toBe(200)
      const missing = await fetch(`${baseUrl}/api/mobile/tts/artifacts/nonexistent-id`, {
        headers: { Authorization: `Bearer ${API_TOKEN}` },
      })
      expect(missing.status).toBe(404)
      const data = (await missing.json()) as any
      expect(data.error).toBe('artifact not found')
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })
})
