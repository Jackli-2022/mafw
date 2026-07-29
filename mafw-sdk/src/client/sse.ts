type SSEListener = (data: any) => void

export class SSEConnection {
  private es: EventSource | null = null
  private listeners = new Map<string, Set<SSEListener>>()

  connect(baseUrl: string): void {
    this.close()
    this.es = new EventSource(`${baseUrl}/api/events`)

    this.es.onmessage = (e: MessageEvent) => {
      let parsed: any
      try { parsed = JSON.parse(e.data) } catch { return }
      const event = parsed?.data || parsed
      const type = event?.type || '*'
      this.notify('*', event)
      if (type !== '*') this.notify(type, event)
    }

    this.es.onerror = () => {} // auto-reconnect
  }

  on(event: string, cb: SSEListener): () => void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set())
    this.listeners.get(event)!.add(cb)
    return () => this.listeners.get(event)?.delete(cb)
  }

  close(): void {
    this.es?.close()
    this.es = null
    this.listeners.clear()
  }

  private notify(event: string, data: any): void {
    this.listeners.get(event)?.forEach(cb => cb(data))
  }
}
