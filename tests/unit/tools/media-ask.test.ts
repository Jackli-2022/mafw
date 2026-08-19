import { mediaAskTool } from '../../../src/tools/media-ask'

const TASK_A = '11111111-1111-4111-8111-111111111111'
const CTX_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const TASK_B = '22222222-2222-4222-8222-222222222222'

function mockGateway(handlers: Record<string, (params: any) => any>) {
  const calls: Array<{ method: string; params: any }> = []
  const fetchMock = jest.fn(async (url: unknown, init?: any) => {
    const body = JSON.parse(init.body)
    calls.push({ method: body.method, params: body.params })
    const handler = handlers[body.method]
    if (!handler) return { ok: false, status: 500, json: async () => ({}) }
    const result = handler(body.params)
    return { ok: true, json: async () => ({ jsonrpc: '2.0', result }) }
  })
  global.fetch = fetchMock as unknown as typeof fetch
  return { calls, fetchMock }
}

function ctx(): { abort: AbortSignal } {
  return { abort: new AbortController().signal }
}

describe('mediaAskTool', () => {
  afterEach(() => {
    delete (global as any).fetch
  })

  test('schema: question required; taskID/mediaPath optional (at least one)', () => {
    expect(mediaAskTool.args.taskID.parse(TASK_A)).toBe(TASK_A)
    expect(mediaAskTool.args.question.parse('分析缺陷')).toBe('分析缺陷')
    // taskID and mediaPath are optional (either may be provided)
    expect(() => mediaAskTool.args.taskID.parse(undefined)).not.toThrow()
    expect(() => mediaAskTool.args.mediaPath.parse(undefined)).not.toThrow()
    // question is required
    expect(() => mediaAskTool.args.question.parse(undefined)).toThrow()
  })

  test('missing both taskID and mediaPath returns an explicit error result (no throw)', async () => {
    const result = await mediaAskTool.execute({ question: 'q' }, ctx()) as any
    expect(result.title).toBe('Media Agent 调用失败')
    expect(result.output).toContain('缺少参数')
  })

  test('mediaPath creates a task first, then asks the question via SendMessage', async () => {
    const { calls } = mockGateway({
      SendMessage: (params: any) => ({
        task: {
          id: TASK_B,
          contextId: CTX_A,
          status: { state: 'TASK_STATE_COMPLETED', message: { parts: [{ text: '图片主体为蓝色仪表盘' }] } },
        },
      }),
    })
    // data: URL short-circuits the fs read in mediaDataFromSource
    const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
    const result = await mediaAskTool.execute({ mediaPath: dataUrl, question: '这个界面是什么？' }, ctx()) as any

    // 1st SendMessage creates the task with the media, 2nd sends the question
    expect(calls.length).toBe(2)
    expect(calls[0].params.message.parts[0].raw).toBeDefined()
    expect(calls[1].params.message.referenceTaskIds).toEqual([TASK_B])
    expect(calls[1].params.message.parts[0].text).toBe('这个界面是什么？')
    expect(result.output).toContain('蓝色仪表盘')
    expect(result.metadata.taskID).toBe(TASK_B)
    expect(result.metadata.newTaskID).toBe(TASK_B)
  })

  test('mediaPath with a video file derives video/mp4', async () => {
    const fs = require('fs')
    const os = require('os')
    const path = require('path')
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ask-test-'))
    const file = path.join(dir, 'clip.mp4')
    fs.writeFileSync(file, Buffer.from('fake-mp4'))
    const { calls } = mockGateway({
      SendMessage: (params: any) => ({
        task: { id: TASK_B, contextId: CTX_A, status: { state: 'TASK_STATE_COMPLETED', message: { parts: [{ text: 'ok' }] } } },
      }),
    })
    const result = await mediaAskTool.execute({ mediaPath: file, question: 'q' }, ctx()) as any
    expect(calls[0].params.message.parts[0].mediaType).toBe('video/mp4')
    expect(result.metadata.taskID).toBe(TASK_B)
    fs.rmSync(dir, { recursive: true, force: true })
  })

  test('executes GetTask then SendMessage with referenceTaskIds and returns answer + newTaskID', async () => {
    const { calls } = mockGateway({
      GetTask: (params: any) => ({ id: params.id, contextId: CTX_A }),
      SendMessage: (params: any) => ({
        task: {
          id: TASK_B,
          contextId: CTX_A,
          status: { state: 'TASK_STATE_COMPLETED', message: { parts: [{ text: '图片主体为白色机器人' }] } },
        },
      }),
    })
    const result = await mediaAskTool.execute({ taskID: TASK_A, question: '这是什么？' }, ctx()) as any

    expect(calls.length).toBe(2)
    expect(calls[0].method).toBe('GetTask')
    expect(calls[0].params.id).toBe(TASK_A)
    expect(calls[1].method).toBe('SendMessage')
    expect(calls[1].params.message.contextId).toBe(CTX_A)
    expect(calls[1].params.message.referenceTaskIds).toEqual([TASK_A])
    expect(calls[1].params.message.parts[0].text).toBe('这是什么？')
    expect(calls[1].params.message.role).toBe(1)

    expect(result.output).toContain('白色机器人')
    expect(result.output).toContain(TASK_B)
    expect(result.metadata.taskID).toBe(TASK_A)
    expect(result.metadata.newTaskID).toBe(TASK_B)
  })

  test('GetTask TaskNotFound returns an explicit error result (no throw)', async () => {
    const { calls } = mockGateway({
      GetTask: () => {
        throw new Error('GetTask failed')
      },
    })
    // emulate JSON-RPC error response for TaskNotFound
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        jsonrpc: '2.0',
        error: { code: -32001, message: 'Task not found: missing' },
      }),
    })) as unknown as typeof fetch

    const result = await mediaAskTool.execute({ taskID: 'missing', question: 'q' }, ctx()) as any
    expect(result.title).toBe('Media Agent 不可用')
    expect(result.output).toContain('Task not found')
    expect(calls.length).toBe(0)
  })

  test('a FAILED media task returns the failure text', async () => {
    mockGateway({
      GetTask: (params: any) => ({ id: params.id, contextId: CTX_A }),
      SendMessage: () => ({
        task: {
          id: TASK_B,
          contextId: CTX_A,
          status: { state: 'TASK_STATE_FAILED', message: { parts: [{ text: '图片分析失败：上传错误' }] } },
        },
      }),
    })
    const result = await mediaAskTool.execute({ taskID: TASK_A, question: 'q' }, ctx()) as any
    expect(result.title).toBe('Media Agent 分析失败')
    expect(result.output).toContain('上传错误')
  })

  test('gateway unreachable returns a non-throwing error result', async () => {
    global.fetch = jest.fn(async () => { throw new Error('ECONNREFUSED') }) as unknown as typeof fetch
    const result = await mediaAskTool.execute({ taskID: TASK_A, question: 'q' }, ctx()) as any
    expect(result.title).toBe('Media Agent 不可用')
    expect(result.output).toContain('ECONNREFUSED')
    expect(result.output).toContain('稍后重试')
  })

  test('abort signal is propagated to fetch', async () => {
    const signals: unknown[] = []
    global.fetch = jest.fn(async (_url: unknown, init?: any) => {
      signals.push(init?.signal)
      return { ok: true, json: async () => ({ jsonrpc: '2.0', result: { id: TASK_A, contextId: CTX_A } }) }
    }) as unknown as typeof fetch
    const aborter = new AbortController()
    await mediaAskTool.execute({ taskID: TASK_A, question: 'q' }, { abort: aborter.signal })
    // two A2A calls (GetTask + SendMessage), each with a merged signal
    expect(signals.length).toBe(2)
    expect((signals[0] as AbortSignal).aborted).toBe(false)
    aborter.abort()
    expect((signals[0] as AbortSignal).aborted).toBe(true)
    expect((signals[1] as AbortSignal).aborted).toBe(true)
  })
})
