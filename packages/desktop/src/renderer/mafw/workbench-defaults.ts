// 工作台布局默认值（2026-10-26 工作台合并后）。
// 对话列宽已迁移到绝对 px 档位（workbench-detents.ts）；本文件只保留 dock 开合默认。

/** 工作台默认打开（用户显式关闭过则尊重）。 */
export function defaultDockOpen(stored: string | null): boolean {
  return stored === null ? true : stored === "1"
}
