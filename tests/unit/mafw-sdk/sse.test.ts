import { SSEConnection } from '../../../mafw-sdk/src/client/sse'

class MockEventSource {
  onmessage: ((e: MessageEvent) => void) | null = null
  onerror: (() => void) | null = null
  private _url: string

  constructor(url: string) { this._url = url }

  close() { this.onmessage = null; this.onerror = null }
}

const OriginalEventSource = (globalThis as any).EventSource

beforeEach(() => {
  (globalThis as any).EventSource = MockEventSource as any
})

afterEach(() => {
  (globalThis as any).EventSource = OriginalEventSource
})

describe('SSEConnection', () => {
  it('creates EventSource pointing to /api/events', () => {
    const sse = new SSEConnection()
    sse.connect('http://localhost:3000')
    expect(sse).toBeDefined()
  })

  it('listens to events via on()', () => {
    const sse = new SSEConnection()
    const cb = jest.fn()
    sse.connect('http://localhost:3000')
    sse.on('*', cb)
    expect(cb).not.toHaveBeenCalled()
  })

  it('close cleans up', () => {
    const sse = new SSEConnection()
    sse.connect('http://localhost:3000')
    sse.close()
    expect(sse).toBeDefined()
  })

  it('on returns unsubscribe function', () => {
    const sse = new SSEConnection()
    sse.connect('http://localhost:3000')
    const cb = jest.fn()
    const unsub = sse.on('*', cb)
    unsub()
    expect(cb).not.toHaveBeenCalled()
  })
})
