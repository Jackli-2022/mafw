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
  /** busy 期间排队、尚未发送的本地 user turn（渲染为待发状态）。 */
  queued?: boolean
}

export interface SessionApi {
  messages(p: { path: { id: string }; query?: { limit?: number; before?: string } }): Promise<{
    data: HistoryItem[]
    nextCursor: string | null
  }>
  promptAsync(p: { path: { id: string }; body: { parts: Record<string, unknown>[]; model?: { providerID: string; modelID: string }; agent?: string } }): Promise<void>
  abort(p: { path: { id: string } }): Promise<void>
  revert?(p: { path: { id: string }; body: { messageID: string; partID?: string } }): Promise<void>
  unrevert?(p: { path: { id: string } }): Promise<void>
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
  /** /model 选择结果；返回 null/undefined 用会话默认模型。 */
  getModel?: () => { providerID: string; modelID: string } | null | undefined
  /** /plan /build /agent 选择结果；返回 null/undefined 用 runtime 默认 agent（切片 3）。 */
  getAgent?: () => string | null | undefined
}

export class ChatStore {
  readonly turns: ChatTurn[] = []
  streaming = false
  private _sessionID: string
  private cursor: string | null = null
  private byMessage = new Map<string, ChatTurn>()
  private queuedTurns: ChatTurn[] = []
  private deps: ChatStoreDeps

  constructor(deps: ChatStoreDeps) {
    this.deps = deps
    this._sessionID = deps.sessionID
  }

  get sessionID(): string { return this._sessionID }

  constructorDeps(): ChatStoreDeps { return this.deps }

  async loadHistory(limit = 50): Promise<void> {
    try {
      const res = await this.deps.session.messages({ path: { id: this._sessionID }, query: { limit } })
      this.cursor = res.nextCursor ?? null
      this.turns.length = 0
      this.byMessage.clear()
      this.queuedTurns = []
      for (const item of res.data ?? []) this.appendHistoryItem(item)
      this.deps.onChange()
    } catch (err: any) {
      this.deps.onError?.(err?.message ?? String(err))
    }
  }

  /** 切换会话：清空本地状态并按新 sessionID 重载历史。 */
  async switchSession(sessionID: string): Promise<void> {
    this._sessionID = sessionID
    this.cursor = null
    this.streaming = false
    this.turns.length = 0
    this.byMessage.clear()
    this.queuedTurns = []
    this.deps.onChange()
    await this.loadHistory()
  }

  /** 返回新加载的 turn 数，0 = 没有更早历史。 */
  async loadOlder(): Promise<number> {
    if (!this.cursor) return 0
    try {
      const res = await this.deps.session.messages({
        path: { id: this._sessionID },
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
        for (const p of item.parts ?? []) {
          const hp = historyPart(p)
          if (hp) t.parts.push(hp)
        }
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
    const trimmed = text.trim()
    if (!trimmed) return
    if (this.streaming) {
      const turn: ChatTurn = {
        messageID: `queued-${Date.now()}-${this.queuedTurns.length}`,
        role: 'user',
        parts: [{ id: `q-${Date.now()}`, type: 'text', text: trimmed }],
        done: true,
        queued: true,
      }
      this.queuedTurns.push(turn)
      this.turns.push(turn)
      this.deps.onChange()
      return
    }
    await this.deliver(trimmed)
  }

  private async deliver(text: string, reuseTurn?: ChatTurn): Promise<void> {
    const mid = reuseTurn?.messageID ?? `local-${Date.now()}`
    let turn = reuseTurn
    if (turn) {
      turn.queued = undefined
    } else {
      turn = {
        messageID: mid,
        role: 'user',
        parts: [{ id: `${mid}-p`, type: 'text', text }],
        done: true,
      }
      this.turns.push(turn)
      this.byMessage.set(mid, turn)
    }
    this.streaming = true
    this.deps.onChange()
    try {
      const model = this.deps.getModel?.()
      const agent = this.deps.getAgent?.() || undefined
      await this.deps.session.promptAsync({
        path: { id: this._sessionID },
        body: { parts: [{ type: 'text', text }], ...(model ? { model } : {}), ...(agent ? { agent } : {}) },
      })
    } catch (err: any) {
      this.streaming = false
      this.deps.onError?.(err?.message ?? String(err))
      this.deps.onChange()
    }
  }

  /** idle 后自动续发排队消息（每次一条，下一条等下一个 idle）。 */
  private flushQueue(): void {
    if (this.streaming || this.queuedTurns.length === 0) return
    const next = this.queuedTurns.shift()!
    void this.deliver(next.parts[0]?.text ?? '', next)
  }

  /** 排队中的消息数。 */
  get queuedCount(): number { return this.queuedTurns.length }

  /** 排队消息文本（/queue overlay 渲染用）。 */
  get queuedTexts(): string[] { return this.queuedTurns.map((t) => t.parts[0]?.text ?? '') }

  /** 收回全部排队消息（Claude Up-take-back 语义）：返回文本数组并从 turns 一并移除。 */
  takeBackAll(): string[] {
    const texts = this.queuedTurns.map((t) => t.parts[0]?.text ?? '')
    for (const t of this.queuedTurns) {
      const idx = this.turns.indexOf(t)
      if (idx >= 0) this.turns.splice(idx, 1)
    }
    this.queuedTurns = []
    this.deps.onChange()
    return texts
  }

  /** 丢弃第 i 条排队消息（0 = 最早）；返回其文本，越界返回 null。 */
  dropQueuedAt(i: number): string | null {
    const t = this.queuedTurns[i]
    if (!t) return null
    this.queuedTurns.splice(i, 1)
    const idx = this.turns.indexOf(t)
    if (idx >= 0) this.turns.splice(idx, 1)
    this.deps.onChange()
    return t.parts[0]?.text ?? ''
  }

  async abort(): Promise<void> {
    try {
      await this.deps.session.abort({ path: { id: this._sessionID } })
    } catch (err: any) {
      this.deps.onError?.(err?.message ?? String(err))
    }
    this.streaming = false
    this.deps.onChange()
  }

  /** /undo：回退到最后一条已持久化的 user 消息（连带其后的回复）。 */
  async undo(): Promise<string | null> {
    const lastUser = [...this.turns].reverse().find((t) =>
      t.role === 'user' && !t.queued && !t.messageID.startsWith('local-') && !t.messageID.startsWith('queued-'))
    if (!lastUser) return '没有可回退的消息（本地未持久化的消息不算）'
    if (!this.deps.session.revert) return '当前 runtime 不支持 revert'
    try {
      await this.deps.session.revert({ path: { id: this._sessionID }, body: { messageID: lastUser.messageID } })
      await this.loadHistory()
      return null
    } catch (err: any) {
      return `undo 失败: ${err?.message ?? String(err)}`
    }
  }

  /** /redo：恢复上一次 revert（opencode-only；pi runtime 无 unrevert）。 */
  async redo(): Promise<string | null> {
    if (!this.deps.session.unrevert) return '当前 runtime 不支持 unrevert'
    try {
      await this.deps.session.unrevert({ path: { id: this._sessionID } })
      await this.loadHistory()
      return null
    } catch (err: any) {
      return `redo 失败: ${err?.message ?? String(err)}`
    }
  }

  applyEvent(type: string, data: any): void {
    if (type === 'message.part.updated') {
      const part = data?.properties?.part
      if (!part) return
      if (part.sessionID && part.sessionID !== this._sessionID) return
      this.applyPart(part)
      this.deps.onChange()
    } else if (type === 'session.idle') {
      this.finalizeTurn()
    } else if (type === 'message.complete') {
      // gateway Mode A 广播把 session.idle 翻译成 message.complete（带顶层 sessionID）
      const sid = data?.sessionID
      if (!sid || sid === this._sessionID) this.finalizeTurn()
    }
  }

  private finalizeTurn(): void {
    this.streaming = false
    const last = this.turns.at(-1)
    if (last && last.role === 'assistant') last.done = true
    this.deps.onChange()
    this.flushQueue()
  }

  private applyPart(part: any): void {
    const cp = livePart(part)
    if (!cp) return
    let turn = this.byMessage.get(part.messageID)
    if (!turn) {
      turn = { messageID: part.messageID, role: 'assistant', parts: [], done: false }
      this.byMessage.set(part.messageID, turn)
      this.turns.push(turn)
    }
    const idx = turn.parts.findIndex((p) => p.id === cp.id)
    if (idx >= 0) turn.parts[idx] = cp
    else turn.parts.push(cp)
  }

  private appendHistoryItem(item: HistoryItem): void {
    const info = item.info ?? item
    const mid = info.id ?? `hist-${this.turns.length}`
    const parts = (item.parts ?? [])
      .map(historyPart)
      .filter((p): p is ChatPart => p !== null)
    const turn: ChatTurn = {
      messageID: mid,
      role: info.role === 'user' ? 'user' : 'assistant',
      parts,
      done: true,
    }
    this.turns.push(turn)
    this.byMessage.set(mid, turn)
  }
}

/** wire 历史消息 → 渲染用 turns（goal transcript 下钻复用；过滤注入块）。 */
export function historyItemsToTurns(items: HistoryItem[]): ChatTurn[] {
  const turns: ChatTurn[] = []
  const byId = new Map<string, ChatTurn>()
  for (const item of items ?? []) {
    const info = item.info ?? item
    const mid = info.id ?? `t-${turns.length}`
    let t = byId.get(mid)
    if (!t) {
      t = { messageID: mid, role: info.role === 'user' ? 'user' : 'assistant', parts: [], done: true }
      byId.set(mid, t)
      turns.push(t)
    }
    for (const p of item.parts ?? []) {
      const hp = historyPart(p)
      if (hp) t.parts.push(hp)
    }
  }
  return turns
}

/** 系统注入块（boundary recall / 便签板 / goal 快照等）会在 manager 会话历史里持久化，渲染时过滤。 */
const INJECTION_TAGS = ['<recall>', '<note-board>', '<goal-snapshot>', '<user-profile>', '<memory-guide>']
function isInjectionBlock(text: string): boolean {
  const t = text.trimStart()
  return INJECTION_TAGS.some((tag) => t.startsWith(tag))
}

function historyPart(p: any): ChatPart | null {
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
  const text = String(p.text ?? '')
  if (isInjectionBlock(text)) return null
  return { id: p.id, type: p.type ?? 'text', text, state: 'completed' }
}

function livePart(part: any): ChatPart | null {
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
  const text = String(part.text ?? '')
  if (isInjectionBlock(text)) return null
  return { id: part.id, type: part.type ?? 'text', text }
}
