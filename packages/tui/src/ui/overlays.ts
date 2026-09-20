import { Text, SelectList, type TUI, type OverlayHandle, type SelectItem } from '@earendil-works/pi-tui'
import type { PermissionRequest } from '@mafw/sdk'
import { theme } from '../theme.ts'
import { selectListTheme } from './chat-tab.ts'
import { HeaderSelectOverlay } from './clickable-select-list.ts'

export function permissionSummary(req: PermissionRequest): string {
  const patterns = req.patterns.length > 0 ? req.patterns.join(', ') : '(无 patterns)'
  return `${req.permission}: ${patterns}`
}

export function permissionToItems(): SelectItem[] {
  return [
    { value: 'once', label: '允许一次', description: '仅本次' },
    { value: 'always', label: '总是允许', description: '本会话内' },
    { value: 'persist', label: '记此前缀', description: '跨会话记住命令前缀' },
    { value: 'persist-tool', label: '记此工具', description: '跨会话记住整个工具' },
    { value: 'reject', label: '拒绝', description: '拒绝此请求' },
  ]
}

/** gateway 已自动答复（mafwPolicy.action !== 'human'）的 asked 不弹 overlay。 */
export function shouldShowOverlay(req: { mafwPolicy?: { action?: string } }): boolean {
  const action = req.mafwPolicy?.action
  return !action || action === 'human'
}

/** permission.asked 弹窗：SelectList once/always/persist/persist-tool/reject → permissions.reply
 *  （支持鼠标点击行；persist = always + persist:'prefix'，persist-tool = persist:'tool'）。 */
export function showPermissionOverlay(
  tui: TUI,
  req: PermissionRequest,
  reply: (r: 'once' | 'always' | 'persist' | 'persist-tool' | 'reject') => Promise<void>,
): OverlayHandle {
  const list = new SelectList(permissionToItems(), 5, selectListTheme)
  const overlay = new HeaderSelectOverlay(
    new Text(theme.warn('权限请求') + '  ' + permissionSummary(req), 1, 1),
    list,
  )
  const handle = tui.showOverlay(overlay, { width: '70%', maxHeight: 10, anchor: 'center' })
  const done = () => handle.hide()
  list.onSelect = (item) => {
    void reply(item.value as 'once' | 'always' | 'persist' | 'persist-tool' | 'reject')
      .catch(() => {})
      .finally(done)
  }
  list.onCancel = done
  return handle
}
