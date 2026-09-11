import {
  VStack, Container, Editor, CombinedAutocompleteProvider, ScrollView,
  type Component, type Focusable, type TUI, type EditorTheme, type SelectListTheme,
} from '@earendil-works/pi-tui'
import type { ChatStore, ChatTurn } from '../store/chat-store.ts'
import { turnToLines } from './message-blocks.ts'
import { theme } from '../theme.ts'

export function parseSlash(text: string): { cmd: string; args: string } | null {
  const m = text.match(/^\/(\w+)(?:\s+([\s\S]*))?$/)
  return m ? { cmd: m[1], args: m[2] ?? '' } : null
}

const selectListTheme: SelectListTheme = {
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
  private _focused = false
  private deps: ChatTabDeps

  get focused() { return this._focused }
  set focused(v: boolean) { this._focused = v; this.editor.focused = v } // IME 传播

  constructor(deps: ChatTabDeps) {
    super([])
    this.deps = deps
    this.scrollView = new ScrollView(this.transcript, { follow: 'end', primary: true })
    this.editor = new Editor(deps.tui, editorTheme)
    this.editor.setAutocompleteProvider(new CombinedAutocompleteProvider(
      [
        { name: 'new', description: '新话题（rotate manager session）' },
        { name: 'btw', description: '支线问答：/btw <问题>' },
        { name: 'older', description: '加载更早历史' },
        { name: 'help', description: '快捷键帮助' },
      ],
      process.cwd(),
    ))
    this.editor.onSubmit = (text) => { void this.submit(text) }
    this.addChild(this.scrollView, { basis: 0, grow: 1, minSize: 1 })
    this.addChild(this.editor, { basis: 'auto', shrink: 1, minSize: 1 })
    deps.store.loadHistory().then(() => this.refreshTranscript())
  }

  /** 顶部（用户上翻到头）→ 自动 loadOlder。由 app 轮询调用。 */
  get atTop(): boolean {
    return !this.scrollView.isFollowingEnd && this.scrollView.scrollTop === 0
  }

  async loadOlder(): Promise<void> {
    const n = await this.deps.store.loadOlder()
    if (n > 0) {
      // 前插后保持视口：renderedTurns 全量重建（loadOlder 低频，可接受）
      this.rebuildTranscript()
    }
  }

  async submit(text: string): Promise<void> {
    const trimmed = text.trim()
    if (!trimmed) return
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

  private rebuildTranscript(): void {
    this.transcript.clear()
    this.turnLines = this.deps.store.turns.map((t) => new TurnLines(t))
    for (const l of this.turnLines) this.transcript.addChild(l)
    this.deps.tui.requestRender()
  }
}
