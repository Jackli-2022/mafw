import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { mediaIngestHook, makeMediaPointer, isMediaPointerPart } from '../../../src/hooks/media-ingest'

const TASK = '11111111-1111-4111-8111-111111111111'
const CTX = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const PNG_1PX_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

function userMsg(parts: any[]): any {
  return { role: 'user', info: { role: 'user' }, parts }
}

function mockA2A(taskOverrides: Record<string, unknown> = {}) {
  const fetchMock = jest.fn(async (_url: unknown, init?: any) => {
    const body = JSON.parse(init.body)
    return {
      ok: true,
      json: async () => ({
        jsonrpc: '2.0',
        result: {
          task: {
            id: TASK,
            contextId: CTX,
            status: { state: 'TASK_STATE_COMPLETED', message: { parts: [{ text: 'ok' }] } },
            ...taskOverrides,
          },
        },
      }),
    }
  })
  global.fetch = fetchMock as unknown as typeof fetch
  return fetchMock
}

describe('makeMediaPointer / isMediaPointerPart', () => {
  test('pointer format is stable and self-describing', () => {
    const p = makeMediaPointer(TASK, CTX, 'shot.mp4')
    expect(p).toContain(`taskID: ${TASK}`)
    expect(p).toContain(`contextID: ${CTX}`)
    expect(p).toContain('媒体: shot.mp4')
    expect(p).toContain('mafw_media_ask')
    expect(isMediaPointerPart({ text: p })).toBe(true)
    expect(isMediaPointerPart({ text: 'plain text' })).toBe(false)
  })

  test('legacy [视觉附件 pointers stay idempotent', () => {
    const legacy = '[视觉附件 taskID: x contextID: y（图片: a.png），查看这张图片请调用 mafw_vision_ask 工具（taskID 填 x）]'
    expect(isMediaPointerPart({ text: legacy })).toBe(true)
  })
})

describe('mediaIngestHook', () => {
  afterEach(() => {
    delete (global as any).fetch
    delete process.env.VISION_INGEST
    delete process.env.MEDIA_INGEST
  })

  test('replaces an image file part (local path) with a pointer and creates a task', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ingest-test-'))
    const file = path.join(dir, 'shot.png')
    fs.writeFileSync(file, Buffer.from(PNG_1PX_B64, 'base64'))
    const fetchMock = mockA2A()

    const parts: any[] = [
      { id: 'p1', type: 'text', text: 'analyze this image' },
      { id: 'p2', type: 'file', mediaType: 'image/png', filename: 'shot.png', url: file },
    ]
    const messages = [userMsg(parts)]
    await mediaIngestHook({}, { messages })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const init = fetchMock.mock.calls[0][1] as any
    const body = JSON.parse(init.body)
    expect(body.method).toBe('SendMessage')
    const rawPart = body.params.message.parts[0]
    expect(rawPart.raw).toBe(PNG_1PX_B64)
    expect(rawPart.mediaType).toBe('image/png')
    // focus hint = the message's text
    expect(body.params.message.parts[1].text).toBe('analyze this image')

    // the part was replaced in place with a pointer (id preserved)
    expect(parts[1].type).toBe('text')
    expect(parts[1].text).toContain('taskID: ' + TASK)
    expect(parts[1].id).toBe('p2')
    fs.rmSync(dir, { recursive: true, force: true })
  })

  test('accepts video parts and forwards the mediaType', async () => {
    const fetchMock = mockA2A()
    const parts: any[] = [
      { id: 'p1', type: 'file', mediaType: 'video/mp4', filename: 'clip.mp4', url: 'data:video/mp4;base64,QUFB' },
    ]
    const messages = [userMsg(parts)]
    await mediaIngestHook({}, { messages })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const init = fetchMock.mock.calls[0][1] as any
    const body = JSON.parse(init.body)
    expect(body.params.message.parts[0].mediaType).toBe('video/mp4')
    expect(parts[0].text).toContain('taskID: ' + TASK)
  })

  test('accepts audio parts and forwards the mediaType', async () => {
    const fetchMock = mockA2A()
    const parts: any[] = [
      { id: 'p1', type: 'file', mediaType: 'audio/mpeg', filename: 'note.mp3', url: 'data:audio/mpeg;base64,QUFB' },
    ]
    const messages = [userMsg(parts)]
    await mediaIngestHook({}, { messages })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const init = fetchMock.mock.calls[0][1] as any
    const body = JSON.parse(init.body)
    expect(body.params.message.parts[0].mediaType).toBe('audio/mpeg')
    expect(parts[0].text).toContain('taskID: ' + TASK)
  })

  test('accepts a data URL image part', async () => {
    const fetchMock = mockA2A()
    const parts: any[] = [
      { id: 'p1', type: 'file', mediaType: 'image/png', filename: 'paste.png', url: 'data:image/png;base64,' + PNG_1PX_B64 },
    ]
    const messages = [userMsg(parts)]
    await mediaIngestHook({}, { messages })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const init = fetchMock.mock.calls[0][1] as any
    const body = JSON.parse(init.body)
    expect(body.params.message.parts[0].raw).toBe(PNG_1PX_B64)
    expect(parts[0].text).toContain('taskID: ' + TASK)
  })

  test('pointer parts are not ingested again (idempotent)', async () => {
    const fetchMock = mockA2A()
    const parts: any[] = [
      { id: 'p1', type: 'text', text: makeMediaPointer(TASK, CTX, 'a.png') },
      { id: 'p2', type: 'file', mediaType: 'image/png', filename: 'b.png', url: 'data:image/png;base64,' + PNG_1PX_B64 },
    ]
    const messages = [userMsg(parts)]
    await mediaIngestHook({}, { messages })
    // the file part is still ingested (only pointer parts are skipped)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  test('a file that cannot be read becomes an explicit failure note', async () => {
    const fetchMock = mockA2A()
    const parts: any[] = [
      { id: 'p1', type: 'file', mediaType: 'image/png', filename: 'gone.png', url: 'C:\\no\\such\\file.png' },
    ]
    const messages = [userMsg(parts)]
    await mediaIngestHook({}, { messages })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(parts[0].type).toBe('text')
    expect(parts[0].text).toContain('媒体未送达 Media Agent')
  })

  test('gateway unreachable produces a non-blocking failure note', async () => {
    global.fetch = jest.fn(async () => { throw new Error('ECONNREFUSED') }) as unknown as typeof fetch
    const parts: any[] = [
      { id: 'p1', type: 'file', mediaType: 'image/png', filename: 'x.png', url: 'data:image/png;base64,' + PNG_1PX_B64 },
    ]
    const messages = [userMsg(parts)]
    await mediaIngestHook({}, { messages })
    expect(parts[0].type).toBe('text')
    expect(parts[0].text).toContain('媒体未送达 Media Agent')
    expect(parts[0].text).toContain('ECONNREFUSED')
  })

  test('MEDIA_INGEST=off disables ingestion', async () => {
    process.env.MEDIA_INGEST = 'off'
    const fetchMock = mockA2A()
    const parts: any[] = [
      { id: 'p1', type: 'file', mediaType: 'image/png', filename: 'x.png', url: 'data:image/png;base64,' + PNG_1PX_B64 },
    ]
    const messages = [userMsg(parts)]
    await mediaIngestHook({}, { messages })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(parts[0].type).toBe('file')
  })

  test('VISION_INGEST=off still disables ingestion (legacy flag)', async () => {
    process.env.VISION_INGEST = 'off'
    const fetchMock = mockA2A()
    const parts: any[] = [
      { id: 'p1', type: 'file', mediaType: 'image/png', filename: 'x.png', url: 'data:image/png;base64,' + PNG_1PX_B64 },
    ]
    const messages = [userMsg(parts)]
    await mediaIngestHook({}, { messages })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
