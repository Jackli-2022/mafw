import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { mediaUploadTool } from '../../../src/tools/media-upload'

const TASK = '11111111-1111-4111-8111-111111111111'
const CTX = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const PNG_1PX_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

function ctx(): { abort: AbortSignal } {
  return { abort: new AbortController().signal }
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

describe('mediaUploadTool', () => {
  afterEach(() => {
    delete (global as any).fetch
  })

  test('schema requires mediaPath; question optional', () => {
    expect(mediaUploadTool.args.mediaPath.parse('C:\\a.mp4')).toBe('C:\\a.mp4')
    expect(() => mediaUploadTool.args.mediaPath.parse(undefined)).toThrow()
    expect(mediaUploadTool.args.question.parse(undefined)).toBeUndefined()
    expect(mediaUploadTool.args.question.parse('q')).toBe('q')
  })

  test('uploads a local PNG, returns a pointer with taskID/contextID', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'upload-test-'))
    const file = path.join(dir, 'shot.png')
    fs.writeFileSync(file, Buffer.from(PNG_1PX_B64, 'base64'))
    const fetchMock = mockA2A()

    const result = await mediaUploadTool.execute({ mediaPath: file }, ctx()) as any
    const init = fetchMock.mock.calls[0][1] as any
    const body = JSON.parse(init.body)
    expect(body.method).toBe('SendMessage')
    expect(body.params.message.parts[0].raw).toBe(PNG_1PX_B64)
    expect(body.params.message.parts[0].mediaType).toBe('image/png')

    expect(result.output).toContain('taskID: ' + TASK)
    expect(result.output).toContain('contextID: ' + CTX)
    expect(result.output).toContain('mafw_media_ask')
    expect(result.metadata.taskID).toBe(TASK)
    expect(result.metadata.contextID).toBe(CTX)
    fs.rmSync(dir, { recursive: true, force: true })
  })

  test('uploads a video file with video/mp4 mediaType', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'upload-test-'))
    const file = path.join(dir, 'clip.mp4')
    fs.writeFileSync(file, Buffer.from('fake-mp4-bytes'))
    const fetchMock = mockA2A()

    const result = await mediaUploadTool.execute({ mediaPath: file, question: '视频内容？' }, ctx()) as any
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.params.message.parts[0].mediaType).toBe('video/mp4')
    expect(body.params.message.parts[1].text).toBe('视频内容？')
    expect(result.output).toContain('taskID: ' + TASK)
    fs.rmSync(dir, { recursive: true, force: true })
  })

  test('uploads an audio file with audio/mpeg mediaType', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'upload-test-'))
    const file = path.join(dir, 'note.mp3')
    fs.writeFileSync(file, Buffer.from('fake-mp3-bytes'))
    const fetchMock = mockA2A()

    const result = await mediaUploadTool.execute({ mediaPath: file }, ctx()) as any
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.params.message.parts[0].mediaType).toBe('audio/mpeg')
    expect(result.output).toContain('taskID: ' + TASK)
    fs.rmSync(dir, { recursive: true, force: true })
  })

  test('rejects non-media extensions', async () => {
    const result = await mediaUploadTool.execute({ mediaPath: 'C:\\file.txt' }, ctx()) as any
    expect(result.title).toBe('上传失败')
    expect(result.output).toContain('不支持的媒体格式')
  })

  test('missing file returns an explicit error', async () => {
    const result = await mediaUploadTool.execute({ mediaPath: 'C:\\no\\such\\image.png' }, ctx()) as any
    expect(result.title).toBe('上传失败')
    expect(result.output).toContain('ENOENT')
  })

  test('a FAILED task returns the failure text with taskID', async () => {
    mockA2A({
      status: { state: 'TASK_STATE_FAILED', message: { parts: [{ text: '图片分析失败：上传错误' }] } },
    })
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'upload-test-'))
    const file = path.join(dir, 'shot.png')
    fs.writeFileSync(file, Buffer.from(PNG_1PX_B64, 'base64'))
    const result = await mediaUploadTool.execute({ mediaPath: file }, ctx()) as any
    expect(result.title).toBe('Media Agent 分析失败')
    expect(result.output).toContain('上传错误')
    expect(result.metadata.taskID).toBe(TASK)
    fs.rmSync(dir, { recursive: true, force: true })
  })

  test('gateway unreachable returns a non-throwing error', async () => {
    global.fetch = jest.fn(async () => { throw new Error('ECONNREFUSED') }) as unknown as typeof fetch
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'upload-test-'))
    const file = path.join(dir, 'shot.png')
    fs.writeFileSync(file, Buffer.from(PNG_1PX_B64, 'base64'))
    const result = await mediaUploadTool.execute({ mediaPath: file }, ctx()) as any
    expect(result.title).toBe('上传失败')
    expect(result.output).toContain('ECONNREFUSED')
    fs.rmSync(dir, { recursive: true, force: true })
  })
})
