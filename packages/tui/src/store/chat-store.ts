import type { ExperienceActionId, MafwMessage, MafwPart } from '@mafw/sdk'

export interface ChatPart {
  id: string
  type: string
  text: string
  state?: 'running' | 'completed' | 'error'
  /** 工具规范名（`canonicalTool ?? tool`）：跨 runtime 聚合与渲染的稳定身份。 */
  tool?: string
}

export interface ChatTurn {
  messageID: string
  role: 'user' | 'assistant'
  parts: ChatPart[]
  done: boolean
  /** busy 期间排队、尚未发送的本地 user turn（渲染为待发状态）。 */
  queued?: boolean
}

/**
 * 会话历史契约（Task 15）：只消费 MAFW flat View DTO。
 *
 * `messages` = `GET /api/sessions/:id/messages`（SDK `session.messages`）；
 * 不再有 `{info,parts}` 双形状，也不做 wire→flat 的客户端兜底。
 */
export interface SessionApi {
  messages(p: { path: { id: string }; query?: { limit?: number; before?: string } }): Promise<{
    data: MafwMessage[]
    nextCursor: string | null
  }>
  promptAsync(p: {
    path: { id: string }
    body: {
      parts: Record<string, unknown>[]
      model?: { providerID: string; modelID: string }
      agent?: string
      delivery?: 'queue' | 'steer' | 'followup'
    }
  }): Promise<void>
  abort(p: { path: { id: string } }): Promise<void>
  revert(p: { path: { id: string }; body: { messageID: string; partID?: string } }): Promise<void>
  unrevert(p: { path: { id: string } }): Promise<void>
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
  /** Experience 门（Task 12）：null = 允许，字符串 = 中性不可用文案（不发请求）。 */
  gate?: (id: ExperienceActionId) => Promise<string | null>
  /** busy 投递语义（与 desktop 同一套 steer/queue/fallback）；缺省 = 本地队列。 */
  busyDelivery?: () => 'steer' | 'queue'
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
      for (const message of res.data ?? []) this.appendMessage(message)
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
      for (const message of res.data ?? []) {
        const mid = message.id ?? `older-${older.length}`
        let turn = map.get(mid)
        if (!turn) {
          turn = {
            messageID: mid,
            role: message.role === 'user' ? 'user' : 'assistant',
            parts: [],
            done: true,
          }
          map.set(mid, turn)
          older.push(turn)
        }
        for (const part of message.content ?? []) {
          const hp = historyPart(part)
          if (hp) turn.parts.push(hp)
        }
      }
      this.turns.unshift(...older)
      for (const turn of older) this.byMessage.set(turn.messageID, turn)
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
      // busy 语义与 desktop 一致：Experience 支持 steer 时直接插话，否则本地队列兜底。
      if (this.deps.busyDelivery?.() === 'steer') {
        await this.deliver(trimmed, undefined, 'steer')
        return
      }
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

  private async deliver(
    text: string,
    reuseTurn?: ChatTurn,
    delivery?: 'steer',
  ): Promise<void> {
    const mid = reuseTurn?.messageID ?? `${delivery === 'steer' ? 'steer' : 'local'}-${Date.now()}`
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
        body: {
          parts: [{ type: 'text', text }],
          ...(model ? { model } : {}),
          ...(agent ? { agent } : {}),
          ...(delivery ? { delivery } : {}),
        },
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

  /** /undo：回退到最后一条已持久化的 user 消息（连带其后的回复）。Experience 门在前。 */
  async undo(): Promise<string | null> {
    const lastUser = [...this.turns].reverse().find((t) => t.role === 'user' && !isTransientTurn(t))
    if (!lastUser) return '没有可回退的消息（本地未持久化的消息不算）'
    const blocked = await this.deps.gate?.('branch.revert')
    if (blocked) return blocked
    try {
      await this.deps.session.revert({ path: { id: this._sessionID }, body: { messageID: lastUser.messageID } })
      await this.loadHistory()
      return null
    } catch (err: any) {
      return `undo 失败: ${err?.message ?? String(err)}`
    }
  }

  /** /redo：恢复上一次回退。Experience 门（branch.unrevert）在前。 */
  async redo(): Promise<string | null> {
    const blocked = await this.deps.gate?.('branch.unrevert')
    if (blocked) return blocked
    try {
      await this.deps.session.unrevert({ path: { id: this._sessionID } })
      await this.loadHistory()
      return null
    } catch (err: any) {
      return `redo 失败: ${err?.message ?? String(err)}`
    }
  }

  applyEvent(type: string, data: any): void {
    if (type === 'part.updated') {
      const part = data?.properties?.part
      if (!part) return
      if (part.sessionID && part.sessionID !== this._sessionID) return
      this.applyPart(part)
      this.deps.onChange()
    } else if (type === 'part.delta') {
      // 流式增量（opencode ≥1.18 / pi）：{messageID, partID, field:'text'|'reasoning', delta}
      const props = data?.properties ?? {}
      const sid = props.sessionID ?? data?.sessionID
      if (sid && sid !== this._sessionID) return
      const field = props.field
      if (field !== 'text' && field !== 'reasoning') return
      if (typeof props.messageID !== 'string' || !props.messageID) return
      if (typeof props.partID !== 'string' || !props.partID) return
      if (typeof props.delta !== 'string' || !props.delta) return
      this.applyDelta(props.messageID, props.partID, props.delta, field)
      this.deps.onChange()
    } else if (type === 'message.updated') {
      // 消息快照（pi message_start/message_end、opencode message.updated）：
      // assistant 用终态 content 覆盖流式累积（text/reasoning 同 id 替换，不追加）；
      // user 回合由本地乐观 turn / 历史承担，不在此重复建 turn。
      const message = data?.properties?.message
      if (this.applyMessageSnapshot(message)) this.deps.onChange()
    } else if (type === 'turn.completed' || type === 'turn.failed' || type === 'turn.aborted') {
      // v2：回合终态三元组（原 session.idle/message.complete 双轨合并；Mode A 改写已删）
      const sid = data?.sessionID
      if (!sid || sid === this._sessionID) this.finalizeTurn()
    }
  }

  private finalizeTurn(): void {
    this.streaming = false
    // 终态结束的是「最后一个 assistant 回合」——排队中的本地 user turn 可能排在其后，
    // 只认 turns.at(-1) 会让真正在跑的 assistant turn 永远停在 pending。
    for (let i = this.turns.length - 1; i >= 0; i--) {
      const t = this.turns[i]
      if (t.role !== 'assistant') continue
      t.done = true
      break
    }
    this.deps.onChange()
    this.flushQueue()
  }

  /**
   * message.updated → turn 快照合并（只认 assistant）：content 非空时按 part 列表
   * 覆盖（历史/终态是权威，流式累积只补空白），空骨架（message_start）不建空 part。
   * 返回 true = 有变化（调用方触发 onChange）。
   */
  private applyMessageSnapshot(message: any): boolean {
    if (!message || message.role !== 'assistant') return false
    if (typeof message.id !== 'string' || !message.id) return false
    if (message.sessionID && message.sessionID !== this._sessionID) return false
    const parts = (Array.isArray(message.content) ? message.content : [])
      .map(historyPart)
      .filter((p: ChatPart | null): p is ChatPart => p !== null)
    let turn = this.byMessage.get(message.id)
    if (!turn) {
      turn = { messageID: message.id, role: 'assistant', parts: [], done: false }
      this.byMessage.set(message.id, turn)
      this.turns.push(turn)
    }
    if (parts.length > 0) turn.parts = parts
    return true
  }

  private applyPart(part: MafwPart): void {
    // 非渲染 part（step 边界/压缩标记/data-* 带外数据）不建回合：pi/opencode 的
    // step-start/step-finish 无文本，建 turn 会得到幽灵 pending 回合并把真正在流的
    // assistant turn 挤出 last 位置。
    if (NON_RENDERABLE_PART_TYPES.has(part.type) || String(part.type).startsWith('data-')) return
    const cp = livePart(part)
    if (!cp) return
    let turn = this.byMessage.get(part.messageID ?? '')
    if (!turn) {
      turn = { messageID: part.messageID ?? `live-${part.id}`, role: 'assistant', parts: [], done: false }
      this.byMessage.set(turn.messageID, turn)
      this.turns.push(turn)
    }
    const idx = turn.parts.findIndex((p) => p.id === cp.id)
    if (idx >= 0) turn.parts[idx] = cp
    else turn.parts.push(cp)
  }

  /**
   * 流式增量累积（part.delta）：按 messageID 建/取 turn，按 partID+类型累积文本。
   * type 是身份的一部分（同一 partID 可能被 text/reasoning 两条流复用，
   * 只按 id 合并会把答案追加进折叠的推理块——与 desktop `applyPartDelta` 同语义）。
   */
  private applyDelta(messageID: string, partID: string, delta: string, field: 'text' | 'reasoning'): void {
    let turn = this.byMessage.get(messageID)
    if (!turn) {
      turn = { messageID, role: 'assistant', parts: [], done: false }
      this.byMessage.set(messageID, turn)
      this.turns.push(turn)
    }
    const idx = turn.parts.findIndex((p) => p.id === partID && p.type === field)
    if (idx >= 0) {
      const cur = turn.parts[idx]
      turn.parts[idx] = { ...cur, text: cur.text + delta }
    } else {
      turn.parts.push({ id: partID, type: field, text: delta })
    }
  }

  private appendMessage(message: MafwMessage): void {
    const mid = message.id ?? `hist-${this.turns.length}`
    const parts = (message.content ?? [])
      .map(historyPart)
      .filter((p): p is ChatPart => p !== null)
    const turn: ChatTurn = {
      messageID: mid,
      role: message.role === 'user' ? 'user' : 'assistant',
      parts,
      done: true,
    }
    this.turns.push(turn)
    this.byMessage.set(mid, turn)
  }
}

/** flat 历史消息 → 渲染用 turns（goal transcript 下钻复用；过滤注入块）。 */
export function historyToTurns(messages: MafwMessage[]): ChatTurn[] {
  const turns: ChatTurn[] = []
  const byId = new Map<string, ChatTurn>()
  for (const message of messages ?? []) {
    const mid = message.id ?? `t-${turns.length}`
    let turn = byId.get(mid)
    if (!turn) {
      turn = {
        messageID: mid,
        role: message.role === 'user' ? 'user' : 'assistant',
        parts: [],
        done: true,
      }
      byId.set(mid, turn)
      turns.push(turn)
    }
    for (const part of message.content ?? []) {
      const hp = historyPart(part)
      if (hp) turn.parts.push(hp)
    }
  }
  return turns
}

/** 系统注入块（boundary recall / 便签板 / goal 快照等）会在 manager 会话历史里持久化，渲染时过滤。 */
const INJECTION_TAGS = ['<recall>', '<note-board>', '<goal-snapshot>', '<user-profile>', '<memory-guide>']

/** 不承载可渲染内容的 part 类型（step 边界 / 压缩标记）；data-* 另行按前缀跳过。 */
const NON_RENDERABLE_PART_TYPES = new Set(['step-start', 'step-finish', 'compaction'])
function isInjectionBlock(text: string): boolean {
  const t = text.trimStart()
  return INJECTION_TAGS.some((tag) => t.startsWith(tag))
}

/** 本地未持久化的 user turn（乐观/排队/插话）不参与 /undo 回退目标。 */
function isTransientTurn(turn: ChatTurn): boolean {
  return turn.queued === true || /^(local|queued|steer)-/.test(turn.messageID)
}

function toolIdentity(part: Record<string, any>): string {
  return String(part.canonicalTool ?? part.tool ?? 'tool')
}

function toolSummary(part: Record<string, any>): string {
  const state = part.state ?? {}
  const input = state.input && typeof state.input === 'object' ? state.input : {}
  return String(input.command ?? input.description ?? part.tool ?? '')
}

function toolState(status: unknown, fallback: ChatPart['state']): ChatPart['state'] {
  if (status === 'completed') return 'completed'
  if (status === 'error') return 'error'
  if (status === 'running') return 'running'
  if (status === 'pending') return 'running'
  return fallback
}

export function historyPart(p: MafwPart | Record<string, any>): ChatPart | null {
  const part = p as Record<string, any>
  if (part.type === 'tool') {
    const status = part.state?.status
    const summary = toolSummary(part)
    const output = status === 'running' || status === 'pending'
      ? ''
      : String(part.state?.output ?? part.state?.error ?? '')
    return {
      id: String(part.id),
      type: 'tool',
      tool: toolIdentity(part),
      state: toolState(status, 'completed'),
      text: output ? `${summary}\n${output}` : summary,
    }
  }
  const text = String(part.text ?? '')
  if (isInjectionBlock(text)) return null
  return { id: String(part.id), type: part.type ?? 'text', text, state: 'completed' }
}

export function livePart(part: MafwPart | Record<string, any>): ChatPart | null {
  const p = part as Record<string, any>
  if (p.type === 'tool') {
    const summary = toolSummary(p)
    const output = p.state?.status === 'completed' || p.state?.status === 'error'
      ? String(p.state?.output ?? p.state?.error ?? '')
      : ''
    return {
      id: String(p.id),
      type: 'tool',
      tool: toolIdentity(p),
      state: toolState(p.state?.status, 'running'),
      text: output ? `${summary}\n${output}` : summary,
    }
  }
  const text = String(p.text ?? '')
  if (isInjectionBlock(text)) return null
  return { id: String(p.id), type: p.type ?? 'text', text }
}
