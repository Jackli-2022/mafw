export interface ChatPart {
  id: string
  type: string
  text: string
  state?: 'running' | 'completed' | 'error'
  toolName?: string
}

export interface ChatTurn {
  messageID: string
  role: 'user' | 'assistant'
  parts: ChatPart[]
  done: boolean
}

export interface SessionApi {
  messages(p: { path: { id: string }; query?: { limit?: number; before?: string } }): Promise<{
    data: HistoryItem[]
    nextCursor: string | null
  }>
  promptAsync(p: { path: { id: string }; body: { parts: Record<string, unknown>[] } }): Promise<void>
  abort(p: { path: { id: string } }): Promise<void>
}

/** GET /api/sessions/:id/messages 的 item 形态（gateway index.ts:4196 / desktop loadOlder 同源）。 */
export interface HistoryItem {
  info?: { id?: string; role?: string; time?: { created?: number } }
  role?: string
  id?: string
  parts?: any[]
}

export interface ChatStoreDeps {
  session: SessionApi
  sessionID: string
  onChange: () => void
  onError?: (message: string) => void
}

export class ChatStore {
  readonly turns: ChatTurn[] = []
  streaming = false
  private cursor: string | null = null
  private byMessage = new Map<string, ChatTurn>()
  private deps: ChatStoreDeps

  constructor(deps: ChatStoreDeps) {
    this.deps = deps
  }

  async loadHistory(limit = 50): Promise<void> {
    try {
      const res = await this.deps.session.messages({ path: { id: this.deps.sessionID }, query: { limit } })
      this.cursor = res.nextCursor ?? null
      this.turns.length = 0
      this.byMessage.clear()
      for (const item of res.data ?? []) this.appendHistoryItem(item)
      this.deps.onChange()
    } catch (err: any) {
      this.deps.onError?.(err?.message ?? String(err))
    }
  }

  /** 返回新加载的 turn 数，0 = 没有更早历史。 */
  async loadOlder(): Promise<number> {
    if (!this.cursor) return 0
    try {
      const res = await this.deps.session.messages({
        path: { id: this.deps.sessionID },
        query: { limit: 50, before: this.cursor },
      })
      this.cursor = res.nextCursor ?? null
      const older: ChatTurn[] = []
      const map = new Map<string, ChatTurn>()
      for (const item of res.data ?? []) {
        const info = item.info ?? item
        const mid = info.id ?? `older-${older.length}`
        let t = map.get(mid)
        if (!t) {
          t = { messageID: mid, role: info.role === 'user' ? 'user' : 'assistant', parts: [], done: true }
          map.set(mid, t)
          older.push(t)
        }
        for (const p of item.parts ?? []) t.parts.push(historyPart(p))
      }
      this.turns.unshift(...older)
      for (const t of older) this.byMessage.set(t.messageID, t)
      this.deps.onChange()
      return older.length
    } catch (err: any) {
      this.deps.onError?.(err?.message ?? String(err))
      return 0
    }
  }

  async send(text: string): Promise<void> {
    if (this.streaming) return
    const mid = `local-${Date.now()}`
    const turn: ChatTurn = {
      messageID: mid,
      role: 'user',
      parts: [{ id: `${mid}-p`, type: 'text', text }],
      done: true,
    }
    this.turns.push(turn)
    this.streaming = true
    this.deps.onChange()
    try {
      await this.deps.session.promptAsync({
        path: { id: this.deps.sessionID },
        body: { parts: [{ type: 'text', text }] },
      })
    } catch (err: any) {
      this.streaming = false
      this.deps.onError?.(err?.message ?? String(err))
      this.deps.onChange()
    }
  }

  async abort(): Promise<void> {
    try {
      await this.deps.session.abort({ path: { id: this.deps.sessionID } })
    } catch (err: any) {
      this.deps.onError?.(err?.message ?? String(err))
    }
    this.streaming = false
    this.deps.onChange()
  }

  applyEvent(type: string, data: any): void {
    if (type === 'message.part.updated') {
      const part = data?.properties?.part
      if (!part) return
      if (part.sessionID && part.sessionID !== this.deps.sessionID) return
      this.applyPart(part)
      this.deps.onChange()
    } else if (type === 'session.idle') {
      this.streaming = false
      const last = this.turns.at(-1)
      if (last && last.role === 'assistant') last.done = true
      this.deps.onChange()
    }
  }

  private applyPart(part: any): void {
    let turn = this.byMessage.get(part.messageID)
    if (!turn) {
      turn = { messageID: part.messageID, role: 'assistant', parts: [], done: false }
      this.byMessage.set(part.messageID, turn)
      this.turns.push(turn)
    }
    const cp = livePart(part)
    const idx = turn.parts.findIndex((p) => p.id === cp.id)
    if (idx >= 0) turn.parts[idx] = cp
    else turn.parts.push(cp)
  }

  private appendHistoryItem(item: HistoryItem): void {
    const info = item.info ?? item
    const mid = info.id ?? `hist-${this.turns.length}`
    const turn: ChatTurn = {
      messageID: mid,
      role: info.role === 'user' ? 'user' : 'assistant',
      parts: (item.parts ?? []).map(historyPart),
      done: true,
    }
    this.turns.push(turn)
    this.byMessage.set(mid, turn)
  }
}

function historyPart(p: any): ChatPart {
  if (p.type === 'tool') {
    const st = p.state?.status
    const cmd = String(p.state?.input?.command ?? p.state?.input?.description ?? p.tool ?? '')
    const out = st === 'running' ? '' : String(p.state?.output ?? '')
    return {
      id: p.id,
      type: 'tool',
      toolName: p.tool,
      state: st === 'completed' ? 'completed' : st === 'error' ? 'error' : st === 'running' ? 'running' : 'completed',
      text: out ? `${cmd}\n${out}` : cmd,
    }
  }
  return { id: p.id, type: p.type ?? 'text', text: String(p.text ?? ''), state: 'completed' }
}

function livePart(part: any): ChatPart {
  if (part.type === 'tool') {
    const st = part.state?.status
    const cmd = String(part.state?.input?.command ?? part.state?.input?.description ?? part.tool ?? '')
    const out = st === 'completed' || st === 'error' ? String(part.state?.output ?? '') : ''
    return {
      id: part.id,
      type: 'tool',
      toolName: part.tool,
      state: st === 'completed' ? 'completed' : st === 'error' ? 'error' : 'running',
      text: out ? `${cmd}\n${out}` : cmd,
    }
  }
  return { id: part.id, type: part.type ?? 'text', text: String(part.text ?? '') }
}
