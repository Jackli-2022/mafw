import { matchesKey, Key } from '@earendil-works/pi-tui'
import { TABS, type TabId } from './tab-strip.ts'

export class AppModel {
  active: TabId = 'chat'
  helpVisible = false
  /** 输入焦点在 Editor/Input 时，字符键（q/?/数字）归编辑器；由 app 按 tab/焦点状态注入。 */
  editing = false

  switchTab(id: TabId): void {
    this.active = id
  }

  toggleHelp(): void {
    this.helpVisible = !this.helpVisible
  }

  /** 返回 'quit' 表示退出；编辑态只放行 ctrl+c 与 Alt+数字 切 tab。 */
  handleKey(data: string): 'quit' | null {
    if (matchesKey(data, Key.ctrl('c'))) return 'quit'
    // Alt+数字：编辑态也能切 tab
    const altIdx = ALT_DIGITS.findIndex((k) => matchesKey(data, k))
    if (altIdx >= 0) {
      this.switchTab(TABS[altIdx].id)
      return null
    }
    if (this.editing) return null
    if (matchesKey(data, 'q')) return 'quit'
    if (data === '?') {
      this.toggleHelp()
      return null
    }
    const idx = ['1', '2', '3', '4'].indexOf(data)
    if (idx >= 0) this.switchTab(TABS[idx].id)
    return null
  }
}

const ALT_DIGITS = [
  Key.alt('1'), Key.alt('2'), Key.alt('3'), Key.alt('4'),
]
