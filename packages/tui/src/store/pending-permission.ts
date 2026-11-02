/**
 * 待决审批 overlay 追踪（canonical id 键控）。
 *
 * `permission.asked` 弹出后，同一请求可能在别处被答复（桌面 / 另一 TUI / agent 自动
 * 决策），gateway 会广播 `permission.replied`（asked/replied 同一投影，pi 的
 * `requestId`、opencode v2 的 `requestID` 都收敛成 canonical `id`）。本端不关闭的话，
 * 用户会对一个已决请求再答一次——卡片状态与服务端真相分叉。
 *
 * 不碰审批语义：这里只负责「外部已决 → 收起本地弹窗」。
 */
export interface PendingPermission {
  id: string
  close(): void
}

export class PendingPermissionStore {
  private pending: PendingPermission | null = null

  /** 记录当前展示中的审批 overlay（新请求覆盖旧记录：同一时刻只有一个弹窗）。 */
  track(id: string, close: () => void): void {
    if (!id) return
    this.pending = { id, close }
  }

  /** 本地答复/取消关闭后清理（避免残留句柄被后来的 replied 二次 hide）。 */
  clear(id?: string): void {
    if (id && this.pending?.id !== id) return
    this.pending = null
  }

  /** 外部销账：canonical id 命中则收起弹窗并返回 true（未命中/无待决 → false）。 */
  resolve(id: string | undefined): boolean {
    if (!id || this.pending?.id !== id) return false
    const { close } = this.pending
    this.pending = null
    try {
      close()
    } catch {
      /* fail-open：关窗失败不影响事件链 */
    }
    return true
  }

  get currentId(): string | null {
    return this.pending?.id ?? null
  }
}

/**
 * `permission.replied` 的 canonical id：`id` 优先，旧 gateway 的 `requestID` /
 * 裸 `requestId`（客户端摄取边界）兜底。无 id 返回 undefined（不猜）。
 */
export function permissionRepliedId(props: unknown): string | undefined {
  const p = props as Record<string, unknown> | null | undefined
  if (!p || typeof p !== 'object') return undefined
  for (const key of ['id', 'requestID', 'requestId'] as const) {
    const v = p[key]
    if (typeof v === 'string' && v) return v
  }
  return undefined
}
