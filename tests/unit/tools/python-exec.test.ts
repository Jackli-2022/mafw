import { pythonExecTool } from '../../../src/tools/python-exec'
import { pythonRestartTool } from '../../../src/tools/python-restart'

function ctx(sessionID = 'ses-1'): { sessionID: string; abort: AbortSignal } {
  return { sessionID, abort: new AbortController().signal }
}

function mockGateway(response: any, status = 200) {
  const fetchMock = jest.fn(async (_url: unknown, init?: any) => {
    return { ok: status < 400, status, json: async () => response }
  })
  global.fetch = fetchMock as unknown as typeof fetch
  return fetchMock
}

describe('pythonExecTool', () => {
  afterEach(() => {
    delete (global as any).fetch
  })

  test('schema requires code', () => {
    expect(pythonExecTool.args.code.parse('print(1)')).toBe('print(1)')
    expect(() => pythonExecTool.args.code.parse(undefined)).toThrow()
  })

  test('posts to /api/python/execute with sessionID and returns stdout/result', async () => {
    const fetchMock = mockGateway({
      stdout: 'hello\n', stderr: '', result: '42', status: 'ok', durationMs: 10, truncated: false, attachments: [],
    })
    const r = await pythonExecTool.execute({ code: 'print("hello")\n42' }, ctx('ses-x')) as any
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('/api/python/execute')
    const body = JSON.parse((init as any).body)
    expect(body.sessionID).toBe('ses-x')
    expect(body.code).toContain('print("hello")')
    expect(r.output).toContain('hello')
    expect(r.output).toContain('42')
  })

  test('an error result returns traceback tail', async () => {
    mockGateway({
      stdout: '', stderr: '', status: 'error',
      error: { ename: 'ZeroDivisionError', evalue: 'division by zero', traceback: ['File "x", line 1', '  1/0', 'ZeroDivisionError: division by zero'] },
      durationMs: 5, truncated: false, attachments: [],
    })
    const r = await pythonExecTool.execute({ code: '1/0' }, ctx()) as any
    expect(r.title).toBe('Python 执行出错')
    expect(r.output).toContain('ZeroDivisionError')
    expect(r.output).toContain('状态保留')
  })

  test('kernel restart notice is surfaced', async () => {
    mockGateway({
      stdout: '', stderr: '', status: 'ok', result: '', kernelRestarted: true, durationMs: 5, truncated: false, attachments: [],
    })
    const r = await pythonExecTool.execute({ code: 'x=1' }, ctx()) as any
    expect(r.output).toContain('内核已重启')
  })

  test('matplotlib attachment is carried in structured metadata', async () => {
    mockGateway({
      stdout: '', stderr: '', status: 'ok', result: '', durationMs: 5, truncated: false,
      attachments: [{ mimeType: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==' }],
    })
    const r = await pythonExecTool.execute({ code: 'plt.show()' }, ctx()) as any
    expect(r.output).toContain('[生成 1 张图片]')
    expect(r.metadata.python.images.length).toBe(1)
    expect(r.metadata.python.images[0].mimeType).toBe('image/png')
    expect(r.metadata.python.images[0].data).toContain('iVBORw0KG')
  })

  test('gateway unreachable returns a non-throwing error', async () => {
    global.fetch = jest.fn(async () => { throw new Error('ECONNREFUSED') }) as unknown as typeof fetch
    const r = await pythonExecTool.execute({ code: '1' }, ctx()) as any
    expect(r.title).toBe('Python 内核不可用')
    expect(r.output).toContain('mafw_python_restart')
  })
})

describe('pythonRestartTool', () => {
  afterEach(() => {
    delete (global as any).fetch
  })

  test('posts restart with sessionID', async () => {
    const fetchMock = mockGateway({ ok: true })
    const r = await pythonRestartTool.execute({}, ctx('ses-r')) as any
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('/api/python/restart')
    const body = JSON.parse((init as any).body)
    expect(body.sessionID).toBe('ses-r')
    expect(r.output).toContain('已重启')
  })

  test('failure is explicit', async () => {
    mockGateway({ error: 'boom' }, 500)
    const r = await pythonRestartTool.execute({}, ctx()) as any
    expect(r.title).toBe('内核重启失败')
  })
})
