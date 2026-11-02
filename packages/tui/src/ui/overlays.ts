import { Text, SelectList, type TUI, type OverlayHandle, type SelectItem } from '@earendil-works/pi-tui'
import type { MafwPermissionRequest } from '@mafw/sdk'
import { theme } from '../theme.ts'
import { normalizePermissionRequest } from '../store/dto.ts'
import { selectListTheme } from './chat-tab.ts'
import { HeaderSelectOverlay } from './clickable-select-list.ts'
import { showModal } from './overlay-surface.ts'

/**
 * 权限请求摘要（Task 12）：接受中性 DTO（或尚未归一的原生载荷，内部归一）。
 * 不直接读 opencode `patterns` / pi `toolName`。
 */
export function permissionSummary(req: MafwPermissionRequest | Record<string, unknown>): string {
  const dto = normalizePermissionRequest(req)
  if (!dto) return '权限请求'
  const targets = dto.targets.length > 0 ? dto.targets.join(', ') : '（无目标）'
  return `${dto.kind}: ${targets}`
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
export function shouldShowOverlay(req: MafwPermissionRequest | Record<string, unknown>): boolean {
  const dto = normalizePermissionRequest(req)
  // 归一后富化在 extensions；未归一的原始载荷仍可能带顶层 mafwPolicy（客户端摄取边界）。
  const policy = (dto?.extensions?.mafwPolicy
    ?? (req as Record<string, unknown>)?.mafwPolicy) as { action?: string } | undefined
  const action = policy?.action
  return !action || action === 'human'
}

/** permission.asked 弹窗：SelectList once/always/persist/persist-tool/reject → permissions.reply
 *  （支持鼠标点击行；persist = always + persist:'prefix'，persist-tool = persist:'tool'）。
 *  `onClose` 在弹窗收起（答复/取消）后调用——app 用它清掉待决追踪。 */
export function showPermissionOverlay(
  tui: TUI,
  req: MafwPermissionRequest,
  reply: (r: 'once' | 'always' | 'persist' | 'persist-tool' | 'reject') => Promise<void>,
  onClose?: () => void,
): OverlayHandle {
  const list = new SelectList(permissionToItems(), 5, selectListTheme)
  const overlay = new HeaderSelectOverlay(
    new Text(theme.warn('权限请求') + '  ' + permissionSummary(req), 1, 1),
    list,
  )
  const handle = showModal(tui, overlay, { width: '70%', maxHeight: 10, anchor: 'center' })
  const done = () => {
    handle.hide()
    onClose?.()
  }
  list.onSelect = (item) => {
    void reply(item.value as 'once' | 'always' | 'persist' | 'persist-tool' | 'reject')
      .catch(() => {})
      .finally(done)
  }
  list.onCancel = done
  return handle
}
