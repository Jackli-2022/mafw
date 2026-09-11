import {
  Text, matchesKey, Key, truncateToWidth, SelectList,
  type Component, type TUI,
} from '@earendil-works/pi-tui'
import type { MafwClient } from '@mafw/sdk'
import { TriageStore, type TriageAction } from '../store/triage-store.ts'
import { theme } from '../theme.ts'
import { selectListTheme } from './chat-tab.ts'

/** Triage 面板：approvals 区块 + triage 列表（selection 跨两区）。 */
export class TriageTab implements Component {
  private selected = 0
  private deps: {
    tui: TUI
    store: TriageStore
    client: MafwClient
    setStatus: (patch: { hint?: string }) => void
  }

  constructor(deps: TriageTab['deps']) {
    this.deps = deps
  }

  invalidate() { /* 状态即渲染源 */ }

  private get approvalCount() { return this.deps.store.approvals.length }
  private get itemCount() { return this.deps.store.items.length }
  private get totalSelectable() { return this.approvalCount + this.itemCount }

  render(width: number): string[] {
    const { store } = this.deps
    const lines: string[] = []
    lines.push(truncateToWidth(
      theme.accent('Approvals ') + theme.dim(`${store.approvals.length} pending · a 批准 · r 拒绝`),
      width,
    ))
    if (store.approvals.length === 0) lines.push(theme.dim('  （无待审批）'))
    store.approvals.forEach((a, i) => {
      const mark = i === this.selected ? theme.accent('› ') : '  '
      lines.push(truncateToWidth(`${mark}[A] ${a.question || a.id} ${theme.dim(a.goalId)}`, width))
    })
    lines.push('')
    lines.push(truncateToWidth(
      theme.accent('Triage ') + theme.dim(`${store.items.length} items · c 确认 · r 拒绝 · d 忽略`),
      width,
    ))
    if (store.items.length === 0) lines.push(theme.dim('  （无 triage 项）'))
    store.items.forEach((t, i) => {
      const idx = this.approvalCount + i
      const mark = idx === this.selected ? theme.accent('› ') : '  '
      const sev = t.severity === 'high' ? theme.err(t.severity) : t.severity === 'medium' ? theme.warn(t.severity) : theme.dim(t.severity)
      lines.push(truncateToWidth(`${mark}[${sev}] ${t.reason} ${theme.dim(t.goalId)}`, width))
    })
    return lines
  }

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
    const isApproval = this.selected < this.approvalCount
    const kind: 'approval' | 'triage' = isApproval ? 'approval' : 'triage'
    const id = isApproval
      ? this.deps.store.approvals[this.selected]?.id
      : this.deps.store.items[this.selected - this.approvalCount]?.id
    if (!id) return false
    let action: TriageAction | null = null
    if (isApproval) {
      if (data === 'a') action = 'approve'
      if (data === 'r') action = 'reject'
    } else {
      if (data === 'c') action = 'confirm'
      if (data === 'd') action = 'dismiss'
      if (data === 'r') action = 'reject'
    }
    if (action) {
      this.apply(kind, id, action)
      return true
    }
    if (matchesKey(data, Key.enter)) {
      this.showDetail(kind, id)
      return true
    }
    return false
  }

  private apply(kind: 'approval' | 'triage', id: string, action: TriageAction): void {
    void this.deps.store.act(kind, id, action)
      .then(() => this.deps.setStatus({ hint: theme.ok(`${kind} ${action} ✓`) }))
      .catch((e: any) => this.deps.setStatus({ hint: theme.err(`${action} 失败: ${e.message}`) }))
  }

  private showDetail(kind: 'approval' | 'triage', id: string): void {
    const isApproval = kind === 'approval'
    const item = isApproval
      ? this.deps.store.approvals.find((a) => a.id === id)
      : this.deps.store.items.find((t) => t.id === id)
    if (!item) return
    const body = isApproval
      ? `类型: approval\nquestion: ${(item as any).question}\ngoalId: ${(item as any).goalId}\n\na 批准 · r 拒绝`
      : `类型: triage\nseverity: ${(item as any).severity}\nreason: ${(item as any).reason}\ngoalId: ${(item as any).goalId}\n\nc 确认 · r 拒绝 · d 忽略`
    const overlay = this.deps.tui.showOverlay(new Text(body, 1, 1), { width: 64, maxHeight: 12, anchor: 'center' })
    const close = () => { off(); overlay.hide() }
    const off = this.deps.tui.addInputListener((data) => {
      if (matchesKey(data, Key.escape)) {
        close()
        return { consume: true }
      }
      if (isApproval && (data === 'a' || data === 'r')) {
        close()
        this.apply('approval', id, data === 'a' ? 'approve' : 'reject')
        return { consume: true }
      }
      if (!isApproval && (data === 'c' || data === 'r' || data === 'd')) {
        close()
        this.apply('triage', id, data === 'c' ? 'confirm' : data === 'd' ? 'dismiss' : 'reject')
        return { consume: true }
      }
      return undefined
    })
    void selectListTheme // 保留导入一致性（SelectList 在此 tab 暂未直接用）
  }
}
