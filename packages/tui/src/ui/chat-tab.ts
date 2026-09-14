import {
  VStack, Container, Editor, CombinedAutocompleteProvider, ScrollView,
  type Component, type Focusable, type TUI, type EditorTheme, type SelectListTheme,
} from '@earendil-works/pi-tui'
import type { ChatStore, ChatTurn } from '../store/chat-store.ts'
import { turnToLines } from './message-blocks.ts'
import { isShellCommand, parseShellCommand, runShell, shellResultToLines } from '../shell-mode.ts'
import { autocompleteItems } from './command-registry.ts'
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

/** 纯文本行组件（按 turn 渲染，可失效重绘——流式 turn 用）。 */
class TurnLines implements Component {
  private cachedWidth?: number
  private cached?: string[]
  private turn: ChatTurn
  constructor(turn: ChatTurn) { this.turn = turn }
  invalidate() { this.cachedWidth = undefined; this.cached = undefined }
  render(width: number): string[] {
    if (this.cached && this.cachedWidth === width) return this.cached
    this.cached = turnToLines(this.turn, width)
    this.cachedWidth = width
    return this.cached
  }
}

/** 预渲染行块（shell 结果 / 用法提示等本地块，宽度自适应重渲染）。 */
class RawLines implements Component {
  private lines: string[]
  private maxWidth = 80
  constructor(lines: string[], maxWidth = 80) { this.lines = lines; this.maxWidth = maxWidth }
  invalidate() { /* 无缓存 */ }
  render(_width: number): string[] { return this.lines }
}

export interface ChatTabDeps {
  tui: TUI
  store: ChatStore
  onSlash: (cmd: string, args: string) => Promise<string | null>
  onError: (message: string) => void
}

/** Chat 面板：ScrollView(transcript, follow:end) + Editor(底部)。 */
export class ChatTab extends VStack implements Focusable {
  private editor: Editor
  private transcript = new Container()
  private scrollView: ScrollView
  private turnLines: TurnLines[] = []
  private localBlocks: RawLines[] = []
  private _focused = false
  private deps: ChatTabDeps

  get focused() { return this._focused }
  set focused(v: boolean) { this._focused = v; this.editor.focused = v } // IME 传播

  /** 焦点组件输入路由：TUI 只调 focusedComponent.handleInput，VStack 无此方法——
   *  必须显式转发给 Editor，否则按键被静默丢弃（"tui 没法输入"根因之二）。 */
  handleInput(data: string): void {
    this.editor.handleInput(data)
  }

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
    this.turnLines = this.deps.store.turns.map((t) => new TurnLines(t))
    for (const l of this.turnLines) this.transcript.addChild(l)
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
        this.transcript.addChild(new TurnLines({
          messageID: `slash-${Date.now()}`, role: 'assistant', done: true,
          parts: [{ id: `${Date.now()}`, type: 'text', text: reply }],
        }))
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

  /** store.onChange 回调：增量挂新 turn；流式 turn 失效重绘。 */
  refreshTranscript(): void {
    const turns = this.deps.store.turns
    while (this.turnLines.length < turns.length) {
      const t = turns[this.turnLines.length]
      const lines = new TurnLines(t)
      this.turnLines.push(lines)
      this.transcript.addChild(lines)
    }
    // 流式中最后一条 assistant turn：失效让其重渲染
    const last = turns.at(-1)
    if (last && last.role === 'assistant' && !last.done) {
      this.turnLines.at(-1)?.invalidate()
    }
    this.deps.tui.requestRender()
  }
}
