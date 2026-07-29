import { createSignal, onCleanup } from 'solid-js'

export interface SSEEvent {
  type: string
  activeNodeId?: string
  phase?: string
  content?: string
  message?: string
}

export function useGatewaySSE(baseUrl: string) {
  const [connected, setConnected] = createSignal(false)
  const [activeNodeId, setActiveNodeId] = createSignal<string | null>(null)
  const [currentPhase, setCurrentPhase] = createSignal<string | null>(null)
  const [lastMessage, setLastMessage] = createSignal<string>('')
  let eventSource: EventSource | null = null

  function connect() {
    if (eventSource) eventSource.close()
    eventSource = new EventSource(`${baseUrl}/api/events`)

    eventSource.onopen = () => setConnected(true)
    eventSource.onerror = () => {
      setConnected(false)
      eventSource?.close()
      setTimeout(connect, 3000)
    }
    eventSource.onmessage = (e) => {
      try {
        const data: SSEEvent = JSON.parse(e.data)
        if (data.activeNodeId) setActiveNodeId(data.activeNodeId)
        if (data.phase) setCurrentPhase(data.phase)
        if (data.content) setLastMessage(data.content)
        if (data.message) setLastMessage(data.message)
      } catch { /* ignore */ }
    }
  }

  function disconnect() {
    eventSource?.close()
    eventSource = null
    setConnected(false)
  }

  onCleanup(() => disconnect())

  return { connected, activeNodeId, currentPhase, lastMessage, connect, disconnect }
}
