import { createSignal } from 'solid-js'
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
    try {
      const res = await gw.client().sendChatMessage(text)
      if (res.ok && res.body) {
        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let content = ''
        setMessages(prev => [...prev, { role: 'assistant', content: '', timestamp: new Date().toISOString() }])
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          const lines = decoder.decode(value, { stream: true }).split('\n')
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6))
                if (data.type === 'text' && data.content) content += data.content
                setMessages(prev => {
                  const next = [...prev]
                  const last = { ...next[next.length - 1], content }
                  next[next.length - 1] = last
                  return next
                })
              } catch { /* ignore */ }
            }
          }
        }
      }
    } catch (err: any) {
      setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${err.message}`, timestamp: new Date().toISOString() }])
    } finally { setLoading(false) }
  }

  return (
    <div class="flex flex-col h-full">
      <h2 class="text-13 font-medium mb-4 shrink-0" style="color: var(--text-strong)">Chat</h2>
      <div class="flex-1 overflow-auto space-y-3 mb-3 pr-2">
        {messages().map((msg, i) => (
          <div class={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div class="max-w-[70%] rounded-lg px-3.5 py-2 text-13 leading-5" style={{
              background: msg.role === 'user' ? 'var(--accent-bg)' : 'var(--bg-layer-01)',
              border: msg.role === 'user' ? '0.5px solid rgba(118,152,253,0.2)' : '0.5px solid var(--border-base)',
              color: msg.role === 'user' ? 'var(--text-strong)' : 'var(--text-base)',
            }}>{msg.content}</div>
          </div>
        ))}
        {loading() && (
          <div class="flex justify-start">
            <div class="rounded-lg px-3.5 py-2" style="background: var(--bg-layer-01); border: 0.5px solid var(--border-base)">
              <div class="flex gap-1">
                <div class="w-1.5 h-1.5 rounded-full" style="background: var(--text-muted); animation: blink 1s infinite" />
                <div class="w-1.5 h-1.5 rounded-full" style="background: var(--text-muted); animation: blink 1s infinite 0.2s" />
                <div class="w-1.5 h-1.5 rounded-full" style="background: var(--text-muted); animation: blink 1s infinite 0.4s" />
              </div>
            </div>
          </div>
        )}
      </div>
      <div class="flex gap-2 shrink-0">
        <input
          type="text"
          value={input()}
          onInput={e => setInput(e.currentTarget.value)}
          onKeyDown={e => e.key === 'Enter' && sendMessage()}
          placeholder="Type a message..."
          disabled={loading()}
          class="input-base flex-1 h-7 px-2.5 text-13"
        />
        <button onClick={sendMessage} disabled={loading() || !input().trim()} class="btn btn-primary">Send</button>
      </div>
      <style>{`@keyframes blink { 0%,100% { opacity: 0.3 } 50% { opacity: 1 } }`}</style>
    </div>
  )
}
