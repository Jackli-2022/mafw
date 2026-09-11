import {
  Container, Text, SelectList, matchesKey, Key, truncateToWidth,
  type Component, type TUI, type OverlayHandle,
} from '@earendil-works/pi-tui'
import type { MafwClient } from '@mafw/sdk'
import { GoalsStore } from '../store/goals-store.ts'
import { theme } from '../theme.ts'
import { selectListTheme } from './chat-tab.ts'

const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '')

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
      ].filter(Boolean).join('\n')
      const overlay = this.deps.tui.showOverlay(new Text(body, 1, 1), { width: 64, maxHeight: 14, anchor: 'center' })
      const close = () => { off(); overlay.hide() }
      const off = escCloser(this.deps.tui, close)
    })
  }

  private confirmAbort(goalId: string): void {
    const list = new SelectList(
      [{ value: 'yes', label: '确认取消', description: goalId }, { value: 'no', label: '返回' }],
      2, selectListTheme,
    )
    const handle = this.deps.tui.showOverlay(list, { width: 44, maxHeight: 6, anchor: 'center' })
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
      const handle = this.deps.tui.showOverlay(list, { width: '70%', maxHeight: 12, anchor: 'center' })
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
