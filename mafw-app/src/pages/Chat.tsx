import { createSignal, onCleanup } from 'solid-js'
import { useGateway } from '../gateway/provider'

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  timestamp: string
}

export function ChatPage() {
  const gw = useGateway()
  const [messages, setMessages] = createSignal<ChatMessage[]>([
    { role: 'assistant', content: 'Hello! I can help manage your MAFW goals.', timestamp: new Date().toISOString() },
  ])
  const [input, setInput] = createSignal('')
  const [loading, setLoading] = createSignal(false)

  async function sendMessage() {
    const text = input()
    if (!text.trim() || loading()) return

    setMessages(prev => [...prev, { role: 'user', content: text, timestamp: new Date().toISOString() }])
    setInput('')
    setLoading(true)
    setMessages(prev => [...prev, { role: 'assistant', content: '', timestamp: new Date().toISOString() }])

    const unsubs: (() => void)[] = []
    let content = ''

    try {
      const { id } = await gw.client().session.create({ directory: '.' })
      const stream = await gw.client().event.subscribe()

      stream.on('message_delta', (data: any) => {
        if (data.sessionID !== id) return
        content += data.content || ''
        setMessages(prev => {
          const next = [...prev]
          next[next.length - 1] = { ...next[next.length - 1], content }
          return next
        })
      })

      stream.on('message_complete', (data: any) => {
        if (data.sessionID !== id) return
        for (const u of unsubs) u()
        setLoading(false)
      })

      stream.on('message_error', (data: any) => {
        if (data.sessionID !== id) return
        for (const u of unsubs) u()
        setLoading(false)
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: `Error: ${data.error || 'Unknown error'}`,
          timestamp: new Date().toISOString(),
        }])
      })

      await gw.client().session.promptAsync({ sessionID: id, message: text })
    } catch (err: any) {
      for (const u of unsubs) u()
      setLoading(false)
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `Error: ${err.message}`,
        timestamp: new Date().toISOString(),
      }])
    }

    onCleanup(() => { for (const u of unsubs) u() })
  }

  return (
    <div class="flex flex-col h-full">
      <div class="flex-1 overflow-auto space-y-3 mb-3 pr-2">
        {messages().map((msg, i) => (
          <div class={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div class="max-w-[70%] rounded-lg px-3.5 py-2 text-sm leading-5" style={{
              background: msg.role === 'user' ? 'rgba(118,152,253,0.15)' : 'var(--v2-background-bg-base)',
              border: msg.role === 'user' ? '0.5px solid rgba(118,152,253,0.2)' : '0.5px solid var(--border-border-secondary)',
              color: msg.role === 'user' ? 'var(--text-text-strong)' : 'var(--text-text-base)',
            }}>{msg.content}</div>
          </div>
        ))}
        {loading() && (
          <div class="flex justify-start">
            <div class="rounded-lg px-3.5 py-2" style="background: var(--v2-background-bg-base); border: 0.5px solid var(--border-border-secondary)">
              <div class="flex gap-1">
                <div class="w-1.5 h-1.5 rounded-full" style="background: var(--text-text-muted); animation: blink 1s infinite" />
                <div class="w-1.5 h-1.5 rounded-full" style="background: var(--text-text-muted); animation: blink 1s infinite 0.2s" />
                <div class="w-1.5 h-1.5 rounded-full" style="background: var(--text-text-muted); animation: blink 1s infinite 0.4s" />
              </div>
            </div>
          </div>
        )}
      </div>
      <div class="flex gap-2 shrink-0">
        <input
          value={input()}
          onInput={(e: any) => setInput(e.currentTarget.value)}
          onKeyDown={(e: any) => e.key === 'Enter' && sendMessage()}
          placeholder="Type a message..."
          disabled={loading()}
          class="flex-1 h-8 px-2.5 text-sm rounded-md outline-1 outline-transparent focus:outline-[var(--accent-9)]"
          style={{ background: 'var(--v2-background-bg-base)', color: 'var(--text-text-strong)' }}
        />
        <button onClick={sendMessage} disabled={loading() || !input().trim()} class="h-8 px-3 rounded-md text-sm font-medium border-none cursor-pointer disabled:opacity-40 bg-[var(--accent-9)] text-white hover:bg-[var(--accent-8)]">Send</button>
      </div>
      <style>{`@keyframes blink { 0%,100% { opacity: 0.3 } 50% { opacity: 1 } }`}</style>
    </div>
  )
}
