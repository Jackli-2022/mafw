export type SSECallback = (data: any) => void

export class SSEConnection {
  private eventSource: EventSource | null = null
  private listeners: Map<string, Set<SSECallback>> = new Map()
  private _connected = false

  get connected(): boolean {
    return this._connected
  }

  connect(baseUrl: string): void {
    if (this.eventSource) return
    this.eventSource = new EventSource(`${baseUrl}/api/events`)
    this.eventSource.onopen = () => { this._connected = true }
    this.eventSource.onerror = () => {
      this._connected = false
      // EventSource auto-reconnects
    }
    this.eventSource.onmessage = (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data)
        const type = data.type || 'message'
        const set = this.listeners.get(type)
        if (set) for (const cb of set) cb(data)
        const wildcard = this.listeners.get('*')
        if (wildcard) for (const cb of wildcard) cb(data)
      } catch {
        // ignore parse errors
      }
    }
  }

  disconnect(): void {
    this.eventSource?.close()
    this.eventSource = null
    this._connected = false
  }

  on(eventType: string, cb: SSECallback): () => void {
    if (!this.listeners.has(eventType)) {
      this.listeners.set(eventType, new Set())
    }
    this.listeners.get(eventType)!.add(cb)
    return () => {
      this.listeners.get(eventType)?.delete(cb)
    }
  }

  /** For testing: emit an event without a real SSE connection */
  emit(event: any): void {
    const type = event.type || 'message'
    const set = this.listeners.get(type)
    if (set) for (const cb of set) cb(event)
    const wildcard = this.listeners.get('*')
    if (wildcard) for (const cb of wildcard) cb(event)
  }
}
