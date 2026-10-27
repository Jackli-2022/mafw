// Workbench 三档绝对 px（spec 2026-10-26-workbench-merge-design；2026-10-26 rev2：
// 默认档 640、去掉过窄的 420、640 外新增 760）。
// 依据 docs/research/2026-10-26-detent-ratio-vs-absolute.md：业界桌面 IDE/Agent 全部绝对 px，
// 比例档位只属固定画布；比例档在 1920+ 撞 760 墙会塌缩。
// 护栏：chat = clamp(detent, 320, min(760, availableWidth − 640 工作台下限))。
// 2026-10-27：工作台下限 520 → 640（与 chat 默认档拉平，spec 2026-10-27-left-rail-visual-polish §6.5）。
export type WorkbenchDetent = 520 | 640 | 760

export const WORKBENCH_DETENTS: WorkbenchDetent[] = [520, 640, 760]
export const WORKBENCH_DEFAULT_DETENT: WorkbenchDetent = 640
export const CHAT_PX_FLOOR = 320
export const CHAT_PX_CEIL = 760
export const WORKBENCH_MIN_WIDTH = 640

/** 档位 → 对话列宽度（px，护栏优先）。 */
export function chatPxForDetent(detent: WorkbenchDetent, availableWidth: number): number {
  const cap = Math.max(CHAT_PX_FLOOR, Math.min(CHAT_PX_CEIL, availableWidth - WORKBENCH_MIN_WIDTH))
  return Math.min(cap, Math.max(CHAT_PX_FLOOR, detent))
}

/** 拖动中的任意 px → 最近档位（比较各档**钳制后**的实际像素，像素距离贴近用户本意）。 */
export function snapDetent(px: number, availableWidth: number): WorkbenchDetent {
  let best = WORKBENCH_DETENTS[0]
  for (const d of WORKBENCH_DETENTS) {
    if (Math.abs(chatPxForDetent(d, availableWidth) - px) < Math.abs(chatPxForDetent(best, availableWidth) - px)) {
      best = d
    }
  }
  return best
}

/** 拖动 px → 可用宽百分比（一位小数；仅用于实时显示「比例是结果」）。 */
export function ratioPercentFromDrag(px: number, availableWidth: number): number {
  if (!(availableWidth > 0)) return 0
  return Math.round((px / availableWidth) * 1000) / 10
}

/** 旧版 `mafw-chat-width`（自由 px）→ 档位；缺失/非法/不可用宽 → 默认 640。 */
export function migrateLegacyChatWidth(storedPx: number | null, availableWidth: number): WorkbenchDetent {
  if (storedPx === null || !Number.isFinite(storedPx) || storedPx <= 0 || !(availableWidth > 0)) {
    return WORKBENCH_DEFAULT_DETENT
  }
  return snapDetent(storedPx, availableWidth)
}

/** localStorage 值归一：仅接受 520/640/760（旧 420 等非法值回默认 640）。 */
export function normalizeDetent(stored: string | number | null): WorkbenchDetent {
  const n = typeof stored === "number" ? stored : Number(stored)
  return (WORKBENCH_DETENTS as number[]).includes(n) ? (n as WorkbenchDetent) : WORKBENCH_DEFAULT_DETENT
}
