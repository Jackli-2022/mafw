// Workbench 三档绝对 px（spec 2026-10-26-workbench-merge-design · 2026-11-04 rev3）
// 默认是 760——业界 48rem 聊天阅读列在本仓 14px 全局字号 / 16px 正文覆盖下的等价物，
// 依据 docs/research/2026-11-04-chat-detent-default-760.md 与
// docs/superpowers/specs/2026-11-04-agent-workbench-right-primary-design.md。
// 依据 docs/research/2026-10-26-detent-ratio-vs-absolute.md：业界桌面 IDE/Agent 全部绝对 px；
// 比例档位只属固定画布；比例档位在 1920+ 会被 760 墙压缩。
//
// 2026-11-10 A 方案：宽窗并排，窄窗改成 Chat / Workbench 全宽切换。
// - available >= 520 + 720 = 1240：split，chat 至少 520，工作台保 720；
// - available < 1240：narrow，不再从 chat 里切 720，760 保持，工作台走全宽视图。
// 320 只作为极端兜底（窗口下限已降到 900×600，正常不会触达）。
export type WorkbenchDetent = 520 | 640 | 760

export const WORKBENCH_DETENTS: WorkbenchDetent[] = [520, 640, 760]
export const WORKBENCH_DEFAULT_DETENT: WorkbenchDetent = 760
export const CHAT_PX_FLOOR = 320
export const CHAT_PX_CEIL = 760
/** 正常聊天的最小舒适宽度；320 只在窗口小于 566px 时才会成为实际约束。 */
export const CHAT_COMFORT_MIN = 520
export const WORKBENCH_MIN_WIDTH = 720
/** split 需要同时容纳 chat 舒适下限和工作台下限。 */
export const WORKBENCH_SPLIT_MIN_AVAILABLE = CHAT_COMFORT_MIN + WORKBENCH_MIN_WIDTH

export type WorkbenchLayoutZone = "split" | "narrow"

/** 宽窗并排；窄窗切换。1240 是 520 + 720 的精确边界。 */
export function workbenchZoneFor(availableWidth: number): WorkbenchLayoutZone {
  return availableWidth >= WORKBENCH_SPLIT_MIN_AVAILABLE ? "split" : "narrow"
}

/**
 * 档位 → 实际 chat 宽度。
 *
 * - split：chat = min(detent, max(520, min(760, available - 720)))
 * - narrow：chat = min(detent, max(320, available))；不再预留工作台宽度
 */
export function chatPxForDetent(
  detent: WorkbenchDetent,
  availableWidth: number,
  zone: WorkbenchLayoutZone = workbenchZoneFor(availableWidth),
): number {
  const desired = Math.min(CHAT_PX_CEIL, Math.max(CHAT_PX_FLOOR, detent))
  if (zone === "narrow") {
    return Math.min(desired, Math.max(CHAT_PX_FLOOR, availableWidth))
  }
  const cap = Math.max(CHAT_COMFORT_MIN, Math.min(CHAT_PX_CEIL, availableWidth - WORKBENCH_MIN_WIDTH))
  return Math.min(desired, cap)
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

/** 旧版 `mafw-chat-width`（自动 px）→ 档位；缺失/非法/不可用宽 → 默认 760。 */
export function migrateLegacyChatWidth(storedPx: number | null, availableWidth: number): WorkbenchDetent {
  if (storedPx === null || !Number.isFinite(storedPx) || storedPx <= 0 || !(availableWidth > 0)) {
    return WORKBENCH_DEFAULT_DETENT
  }
  return snapDetent(storedPx, availableWidth)
}

/** localStorage 值归一：仅接受 520/640/760（旧 420 等非法值回默认 760）。 */
export function normalizeDetent(stored: string | number | null): WorkbenchDetent {
  const n = typeof stored === "number" ? stored : Number(stored)
  return (WORKBENCH_DETENTS as number[]).includes(n) ? (n as WorkbenchDetent) : WORKBENCH_DEFAULT_DETENT
}
