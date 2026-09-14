import {
  Container, Text, SelectList, matchesKey, Key, truncateToWidth,
  type Component, type TUI, type OverlayHandle,
} from '@earendil-works/pi-tui'
import type { MafwClient, GoalSessionInfo } from '@mafw/sdk'
import { GoalsStore } from '../store/goals-store.ts'
import { historyItemsToTurns } from '../store/chat-store.ts'
import { turnToLines } from './message-blocks.ts'
import { theme } from '../theme.ts'
import { selectListTheme } from './chat-tab.ts'
import { ClickableSelectList } from './clickable-select-list.ts'

const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '')

/** goal sessions 区块渲染行（纯函数，供测试）。 */
export function formatGoalSessions(sessions: GoalSessionInfo[]): string[] {
  if (sessions.length === 0) return [theme.dim('  （无 session 记录）')]
  return sessions.map((s) =>
    `${theme.accent('›')} ${s.phase} · loop ${s.loop}${s.title ? theme.dim(` · ${s.title}`) : ''} ${theme.dim(s.sessionID)}`)
}

/** Goals 面板：goal 列表 + 待决问答区块（selection 跨两区）。 */
export class GoalsTab implements Component {
  private selected = 0
  private deps: {
    tui: TUI
    store: GoalsStore
    client: MafwClient
    setStatus: (patch: { hint?: string }) => void
  }

  constructor(deps: GoalsTab['deps']) {
    this.deps = deps
  }

  invalidate() { /* 状态即渲染源 */ }

  private get rowCount() { return this.deps.store.rows.length }
  private get questionCount() { return this.deps.store.questions.length }
  private get totalSelectable() { return this.rowCount + this.questionCount }

  render(width: number): string[] {
    const { store } = this.deps
    const lines: string[] = []
    const active = store.rows.filter(GoalsStore.isActive).length
    lines.push(truncateToWidth(
      theme.accent(`Goals `) + theme.dim(`${active} active / ${store.rows.length} total · Enter 详情 · x 取消`),
      width,
    ))
    if (store.rows.length === 0) lines.push(theme.dim('  （无 goal）'))
    store.rows.forEach((g, i) => {
      const mark = GoalsStore.isActive(g) ? theme.ok('●') : theme.dim('○')
      const qMark = i === this.selected ? theme.accent('› ') : '  '
      const line = `${qMark}${mark} ${g.goalId} ${theme.dim(`· ${g.phase} · loop ${g.loop} · wave ${g.currentWave}/${g.totalWaves}`)}`
      lines.push(truncateToWidth(line, width))
    })
    if (store.questions.length > 0) {
      lines.push('')
      lines.push(truncateToWidth(theme.warn(`? 待决问答 (${store.questions.length}) · Enter 作答`), width))
      store.questions.forEach((q, i) => {
        const idx = this.rowCount + i
        const qMark = idx === this.selected ? theme.accent('› ') : '  '
        const text = q.questions[0]?.question ?? q.id
        lines.push(truncateToWidth(`${qMark}${theme.warn('?')} ${text}`, width))
      })
    }
    return lines
  }

  /** 鼠标点击行选中（Enter 仍负责激活；行映射与 render 同构：header/空行/header 不可点）。 */
  handleMouseClick(_col: number, row: number): boolean {
    const goalsRows = this.rowCount
    if (goalsRows > 0 && row >= 1 && row <= goalsRows) {
      this.selected = row - 1
      this.deps.tui.requestRender()
      return true
    }
    if (this.questionCount > 0) {
      const qStart = 1 + Math.max(goalsRows, 1) + 2 // header + (goals|占位) + 空行 + 问头
      if (row >= qStart && row < qStart + this.questionCount) {
        this.selected = goalsRows + (row - qStart)
        this.deps.tui.requestRender()
        return true
      }
    }
    return false
  }

  /** 返回 true 表示按键已消费（app 层据此不再转发）。 */
  handleTabKey(data: string): boolean {
    if (matchesKey(data, Key.up)) {
      this.selected = Math.max(0, this.selected - 1)
      this.deps.tui.requestRender()
      return true
    }
    if (matchesKey(data, Key.down)) {
      this.selected = Math.min(this.totalSelectable - 1, this.selected + 1)
      this.deps.tui.requestRender()
      return true
    }
    if (matchesKey(data, Key.enter)) {
      if (this.selected < this.rowCount) this.openGoalDetail(this.deps.store.rows[this.selected].goalId)
      else this.openQuestionOverlay(this.deps.store.questions[this.selected - this.rowCount])
      return true
    }
    if (data === 'x' && this.selected < this.rowCount) {
      this.confirmAbort(this.deps.store.rows[this.selected].goalId)
      return true
    }
    return false
  }

  private openGoalDetail(goalId: string): void {
    void this.deps.client.goals.get(goalId).then((g) => {
      if (!g) return
      const body = [
        `goalId: ${g.goalId}`,
        `phase:  ${g.phase}`,
        `loop:   ${g.loop}`,
        `wave:   ${g.currentWave}/${g.totalWaves}`,
        g.nextAction ? `next:   ${g.nextAction}` : '',
        g.updatedAt ? `更新:   ${g.updatedAt}` : '',
        '',
        theme.dim('s: 查看 session 列表 · Esc: 关闭'),
      ].filter(Boolean).join('\n')
      const overlay = this.deps.tui.showOverlay(new Text(body, 1, 1), { width: 64, maxHeight: 16, anchor: 'center' })
      const close = () => { offKey(); offEsc(); overlay.hide() }
      const offEsc = escCloser(this.deps.tui, close)
      const offKey = this.deps.tui.addInputListener((data) => {
        if (data === 's') {
          close()
          void this.openGoalSessions(goalId)
          return { consume: true }
        }
        return undefined
      })
    })
  }

  /** goal → sessions 下钻（编排可视化：plan/execute/review 会话列表）。 */
  async openGoalSessions(goalId: string): Promise<void> {
    let sessions: GoalSessionInfo[]
    try {
      sessions = await this.deps.client.goals.sessions(goalId)
    } catch (e: any) {
      this.deps.setStatus({ hint: theme.err(`sessions 获取失败: ${String(e?.message ?? e).slice(0, 60)}`) })
      return
    }
    if (sessions.length === 0) {
      const overlay = this.deps.tui.showOverlay(
        new Text(`goal ${goalId}\n${formatGoalSessions(sessions).join('\n')}`, 1, 1),
        { width: 56, maxHeight: 6, anchor: 'center' },
      )
      const close = () => { off(); overlay.hide() }
      const off = escCloser(this.deps.tui, close)
      return
    }
    const list = new SelectList(
      sessions.map((s) => ({
        value: s.sessionID,
        label: `${s.phase} · loop ${s.loop}`,
        description: s.title ?? s.sessionID,
      })),
      Math.min(sessions.length, 8), selectListTheme,
    )
    const handle = this.deps.tui.showOverlay(new ClickableSelectList(list), { width: '70%', maxHeight: 12, anchor: 'center' })
    const close = () => { off(); handle.hide() }
    const off = escCloser(this.deps.tui, close)
    list.onSelect = (item) => { close(); void this.openTranscript(String(item.value)) }
    list.onCancel = close
  }

  /** 只读 transcript overlay（最近 50 条消息）。 */
  async openTranscript(sessionID: string): Promise<void> {
    let messages: any[]
    try {
      const res = await this.deps.client.session.messages({ path: { id: sessionID }, query: { limit: 50 } })
      messages = res.data ?? []
    } catch (e: any) {
      this.deps.setStatus({ hint: theme.err(`transcript 获取失败: ${String(e?.message ?? e).slice(0, 60)}`) })
      return
    }
    const turns = historyItemsToTurns(messages)
    const lines = turns.flatMap((t) => turnToLines(t, 76))
    const body = lines.length > 0 ? lines.join('\n') : theme.dim('（空会话）')
    const overlay = this.deps.tui.showOverlay(
      new Text(`${theme.accent('transcript')} ${theme.dim(sessionID)}\n\n${body}`, 1, 1),
      { width: '80%', maxHeight: '70%', anchor: 'center' },
    )
    const close = () => { off(); overlay.hide() }
    const off = escCloser(this.deps.tui, close)
  }

  private confirmAbort(goalId: string): void {
    const list = new SelectList(
      [{ value: 'yes', label: '确认取消', description: goalId }, { value: 'no', label: '返回' }],
      2, selectListTheme,
    )
    const handle = this.deps.tui.showOverlay(new ClickableSelectList(list), { width: 44, maxHeight: 6, anchor: 'center' })
    const close = () => { off(); handle.hide() }
    const off = escCloser(this.deps.tui, close)
    list.onSelect = (item) => {
      close()
      if (item.value === 'yes') {
        void this.deps.client.goals.control({ goalId, action: 'ABORT' })
          .then(() => this.deps.setStatus({ hint: theme.ok(`已取消 ${goalId}`) }))
          .catch((e: any) => this.deps.setStatus({ hint: theme.err(`取消失败: ${e.message}`) }))
      }
    }
    list.onCancel = close
  }

  private openQuestionOverlay(q: { id: string; questions: { question: string; options: { label: string; description?: string }[] }[] }): void {
    const first = q.questions[0]
    if (!first) return
    if (q.questions.length > 1) {
      const handle = this.deps.tui.showOverlay(
        new Text(theme.warn('多问题请求') + '（v1 请在桌面端处理）\nEsc 关闭', 1, 1),
        { width: 52, maxHeight: 6, anchor: 'center' },
      )
      const close = () => { off(); handle.hide() }
      const off = escCloser(this.deps.tui, close)
      return
    }
    const finish = (answer: string[][]) => {
      void this.deps.client.questions.reply(q.id, answer)
        .then(() => this.deps.setStatus({ hint: theme.ok('已回答') }))
        .catch((e: any) => this.deps.setStatus({ hint: theme.err(`回答失败: ${e.message}`) }))
    }
    if (first.options.length > 0) {
      const list = new SelectList(
        first.options.map((o) => ({ value: o.label, label: o.label, description: o.description })),
        Math.min(first.options.length, 6), selectListTheme,
      )
      const handle = this.deps.tui.showOverlay(new ClickableSelectList(list), { width: '70%', maxHeight: 12, anchor: 'center' })
      const close = () => { off(); handle.hide() }
      const off = escCloser(this.deps.tui, close)
      list.onSelect = (item) => { close(); finish([[item.value]]) }
      list.onCancel = close
    } else {
      const overlay = this.deps.tui.showOverlay(
        new Text(`${first.question}\n\n（开放问题请在桌面端回答；r 拒绝）`, 1, 1),
        { width: 60, maxHeight: 8, anchor: 'center' },
      )
      const off = this.deps.tui.addInputListener((data) => {
        if (data === 'r') {
          off()
          overlay.hide()
          void this.deps.client.questions.reject(q.id).catch(() => {})
          return { consume: true }
        }
        if (matchesKey(data, Key.escape)) {
          off()
          overlay.hide()
          return { consume: true }
        }
        return undefined
      })
    }
  }
}

/** Esc 关闭 overlay：返回 off（各关闭路径都要调用，防监听残留）。 */
function escCloser(tui: TUI, close: () => void): () => void {
  const off = tui.addInputListener((data) => {
    if (matchesKey(data, Key.escape)) {
      off()
      close()
      return { consume: true }
    }
    return undefined
  })
  return off
}

export function goalSummaryLine(g: { goalId: string; phase: string; loop: number }): string {
  return strip(`${g.goalId} · ${g.phase} · loop ${g.loop}`)
}
