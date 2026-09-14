import {
  VStack, Container, Editor, CombinedAutocompleteProvider, ScrollView,
  type Component, type Focusable, type TUI, type EditorTheme, type SelectListTheme,
} from '@earendil-works/pi-tui'
import type { ChatStore, ChatTurn } from '../store/chat-store.ts'
import {
  buildBlock, PendingBlock,
  type DisplaySettings, type UpdatableBlock,
} from './blocks.ts'
import { isShellCommand, parseShellCommand, runShell, shellResultToLines } from '../shell-mode.ts'
import { autocompleteItems } from './command-registry.ts'
import { PromptStash } from './prompt-stash.ts'
import { theme } from '../theme.ts'

export function parseSlash(text: string): { cmd: string; args: string } | null {
  const m = text.match(/^\/(\w+)(?:\s+([\s\S]*))?$/)
  return m ? { cmd: m[1], args: m[2] ?? '' } : null
}

export const selectListTheme: SelectListTheme = {
  selectedPrefix: (t) => theme.accent(t),
  selectedText: (t) => theme.accent(t),
  description: (t) => theme.dim(t),
  scrollInfo: (t) => theme.dim(t),
  noMatch: (t) => theme.dim(t),
}

export const editorTheme: EditorTheme = {
  borderColor: (s) => theme.border(s),
  selectList: selectListTheme,
}

/** 预渲染行块（shell 结果 / 用法提示等本地块，跨 rebuild 保留）。 */
class RawLines implements Component {
  private lines: string[]
  constructor(lines: string[]) { this.lines = lines }
  invalidate() { /* 无缓存 */ }
  render(_width: number): string[] { return this.lines }
}

/** 每 turn 的渲染块组（含 pending 省略块与转正重建标记）。 */
interface RenderedTurn {
  messageID: string
  blocks: UpdatableBlock[]
  pending?: PendingBlock
  queued?: boolean
}

export interface ChatTabDeps {
  tui: TUI
  store: ChatStore
  onSlash: (cmd: string, args: string) => Promise<string | null>
  onError: (message: string) => void
}

/** Chat 面板：ScrollView(transcript, follow:end) + Editor(底部)。transcript 为块组件树。 */
export class ChatTab extends VStack implements Focusable {
  private editor: Editor
  private transcript = new Container()
  private scrollView: ScrollView
  private rendered: RenderedTurn[] = []
  private localBlocks: RawLines[] = []
  private stash = new PromptStash()
  /** 阅读模式设置（/focus /verbose 驱动，块渲染时读取）。 */
  readonly display: DisplaySettings = { focus: false, toolVerbosity: 'all' }
  private savedVerbosity: 'all' | 'off' = 'all'
  private _focused = false
  private deps: ChatTabDeps

  get focused() { return this._focused }
  set focused(v: boolean) { this._focused = v; this.editor.focused = v } // IME 传播

  /** 焦点组件输入路由：TUI 只调 focusedComponent.handleInput，VStack 无此方法——
   *  必须显式转发给 Editor，否则按键被静默丢弃（"tui 没法输入"根因之二）。
   *  转发前拦截三个 app 级输入交互：Up 收回排队（Claude）、Ctrl+S 草稿栈（Hermes）。 */
  handleInput(data: string): void {
    if (data === '\x1b[A') {
      // Up + 输入为空 + 有排队 → 收回全部排队消息进编辑框（一行一条）
      if (this.deps.store.queuedCount > 0 && this.getEditorText().trim() === '') {
        const texts = this.deps.store.takeBackAll()
        if (texts.length > 0) {
          this.setEditorText(texts.join('\n'))
          return
        }
      }
    }
    if (data === '\x13') {
      // Ctrl+S：有文本入栈清空；空输入恢复最新（LIFO）
      const text = this.getEditorText()
      if (text.trim() !== '') {
        this.stash.push(text)
        this.setEditorText('')
        this.deps.tui.requestRender()
        return
      }
      const restored = this.stash.pop()
      if (restored !== null) this.setEditorText(restored)
      return
    }
    this.editor.handleInput(data)
  }

  /** stash 深度（状态栏 📌N 徽标用）。 */
  get stashCount(): number { return this.stash.size }

  /** 鼠标点击：未聚焦时点击即聚焦；已聚焦时放行（保留 pi-tui 拖选复制）。 */
  handleMouseClick(_col: number, _row: number): boolean {
    if (!this._focused) {
      this.deps.tui.setFocus(this)
      return true
    }
    return false
  }

  constructor(deps: ChatTabDeps) {
    super([])
    this.deps = deps
    this.scrollView = new ScrollView(this.transcript, { follow: 'end', primary: true })
    this.editor = new Editor(deps.tui, editorTheme)
    this.editor.setAutocompleteProvider(new CombinedAutocompleteProvider(
      autocompleteItems(),
      process.cwd(),
    ))
    this.editor.onSubmit = (text) => { void this.submit(text) }
    this.addChild(this.scrollView, { basis: 0, grow: 1, minSize: 1 })
    this.addChild(this.editor, { basis: 'auto', shrink: 1, minSize: 1 })
    deps.store.loadHistory().then(() => this.rebuild())
  }

  /** 顶部（用户上翻到头）→ 自动 loadOlder。由 app 轮询调用。 */
  get atTop(): boolean {
    return !this.scrollView.isFollowingEnd && this.scrollView.scrollTop === 0
  }

  async loadOlder(): Promise<void> {
    const n = await this.deps.store.loadOlder()
    if (n > 0) {
      // 前插后保持视口：renderedTurns 全量重建（loadOlder 低频，可接受）
      this.rebuild()
    }
  }

  /** 编辑器文本透传（Ctrl+G 外部编辑器用）。 */
  getEditorText(): string { return this.editor.getText() }
  setEditorText(text: string): void { this.editor.setText(text); this.deps.tui.requestRender() }

  /** 会话切换后全量重建 transcript（本地块如 shell 结果跨重建保留）。 */
  rebuild(): void {
    this.transcript.clear()
    this.rendered = []
    this.refreshTranscript()
    for (const b of this.localBlocks) this.transcript.addChild(b)
    this.deps.tui.requestRender()
  }

  async submit(text: string): Promise<void> {
    const trimmed = text.trim()
    if (!trimmed) return
    // 输入历史（pi-tui Editor 内建 up/down 导航；claude code 同款 per-session 历史）
    this.editor.addToHistory(trimmed)
    if (trimmed === '!') {
      this.addLocalLines([theme.dim('用法: ! <command>（本地执行，不进对话）')])
      return
    }
    if (isShellCommand(trimmed)) {
      const cmd = parseShellCommand(trimmed)
      this.addLocalLines([`${theme.accent('!')} ${theme.dim(cmd)} ${theme.warn('running…')}`])
      const width = this.deps.tui.terminal?.columns ?? 80
      const result = await runShell(cmd)
      this.addLocalLines(shellResultToLines(result, width))
      return
    }
    const slash = parseSlash(trimmed)
    if (slash) {
      const reply = await this.deps.onSlash(slash.cmd, slash.args)
      if (reply) {
        const turn: ChatTurn = {
          messageID: `slash-${Date.now()}`, role: 'assistant', done: true,
          parts: [{ id: `${Date.now()}`, type: 'text', text: reply }],
        }
        for (const p of turn.parts) this.transcript.addChild(buildBlock(p, turn, this.display, () => this.deps.tui.requestRender()))
        this.deps.tui.requestRender()
      }
      return
    }
    await this.deps.store.send(trimmed)
    this.refreshTranscript()
  }

  private addLocalLines(lines: string[]): void {
    const block = new RawLines(lines)
    this.localBlocks.push(block)
    this.transcript.addChild(block)
    this.deps.tui.requestRender()
  }

  /** store.onChange 回调：增量挂新 turn/新 part；流式快照替换；pending 移除。 */
  refreshTranscript(): void {
    const turns = this.deps.store.turns
    // queued→delivered 转正（罕见路径）：全量重建
    for (let i = 0; i < this.rendered.length && i < turns.length; i++) {
      const r = this.rendered[i]
      if (r.queued && !turns[i].queued) { this.rebuild(); return }
    }
    // 新 turn 追加
    while (this.rendered.length < turns.length) {
      const t = turns[this.rendered.length]
      const entry: RenderedTurn = { messageID: t.messageID, blocks: [], queued: t.queued }
      for (const p of t.parts) entry.blocks.push(this.mkBlock(p, t))
      if (t.role === 'assistant' && !t.done) entry.pending = new PendingBlock()
      for (const b of entry.blocks) this.transcript.addChild(b)
      if (entry.pending) this.transcript.addChild(entry.pending)
      this.rendered.push(entry)
    }
    // 最后一 turn 流式增量：新 part 追加（pending 之前）、既有块快照替换、done 移除 pending
    const last = turns.at(-1)
    const entry = this.rendered.at(-1)
    if (!last || !entry || entry.messageID !== last.messageID) { this.deps.tui.requestRender(); return }
    while (entry.blocks.length < last.parts.length) {
      const p = last.parts[entry.blocks.length]
      const b = this.mkBlock(p, last)
      entry.blocks.push(b)
      if (entry.pending) this.transcript.removeChild(entry.pending)
      this.transcript.addChild(b)
      if (entry.pending) this.transcript.addChild(entry.pending)
    }
    for (let j = 0; j < entry.blocks.length; j++) entry.blocks[j].update(last.parts[j])
    if (entry.pending && last.done) {
      this.transcript.removeChild(entry.pending)
      entry.pending = undefined
    }
    this.deps.tui.requestRender()
  }

  /** 滚动 transcript 使目标 turn 位于视口顶部（搜索跳转用）。 */
  scrollToTurn(messageID: string): boolean {
    const entry = this.rendered.find((e) => e.messageID === messageID)
    if (!entry || entry.blocks.length === 0) return false
    const first = entry.blocks[0]
    const idx = this.transcript.children.indexOf(first)
    if (idx < 0) return false
    const width = this.deps.tui.terminal?.columns ?? 80
    let lines = 0
    for (let i = 0; i < idx; i++) lines += this.transcript.children[i].render(width).length
    this.scrollView.scrollTo(Math.max(0, lines - 1))
    return true
  }

  private mkBlock(p: ChatTurn['parts'][number], t: ChatTurn): UpdatableBlock {
    return buildBlock(p, t, this.display, () => this.deps.tui.requestRender()) as UpdatableBlock
  }

  /** /verbose 循环：all（默认展开）↔ off（默认折叠，单击仍可展开）。 */
  cycleVerbosity(): 'all' | 'off' {
    this.display.toolVerbosity = this.display.toolVerbosity === 'all' ? 'off' : 'all'
    if (!this.display.focus) this.savedVerbosity = this.display.toolVerbosity
    this.invalidateAll()
    return this.display.toolVerbosity
  }

  /** /focus 静视图（Hermes 语义：开时收起 tool 输出并记住，关时恢复）。 */
  toggleFocus(): boolean {
    if (this.display.focus) {
      this.display.focus = false
      this.display.toolVerbosity = this.savedVerbosity
    } else {
      this.display.focus = true
      this.savedVerbosity = this.display.toolVerbosity
      this.display.toolVerbosity = 'off'
    }
    this.invalidateAll()
    return this.display.focus
  }

  private invalidateAll(): void {
    for (const e of this.rendered) for (const b of e.blocks) b.invalidate()
    this.deps.tui.requestRender()
  }
}
