import type { TabId } from './tab-strip.ts'

/**
 * App 级状态持有者（P1 瘦身后）：只管状态，不管按键——键位路由在 keymap.ts。
 * 键盘行为测试见 tests/keymap.test.ts。
 */
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
}
