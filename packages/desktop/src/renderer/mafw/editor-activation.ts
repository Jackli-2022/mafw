// 编辑器激活刷新判定（2026-10-31）：
// 后台 tab 打开期间不注册 file watch（只有活动文件被 watch），切回时必须按磁盘真值校验，
// 否则 agent 在你切走后写的改动会永久 stale。
//
// - 只读预览（图片/Office）：stat 比 mtime → 变了才 bump 版本（无谓重解析会让 pptx 白一帧）
// - 文本（含 dirty）：读盘探测；干净时静默换基准，dirty 时只标冲突，绝不覆盖
// - 只读文本（binary/超大降级）：不读（内容不可编辑，刷新没有意义）
import { isReadOnlyPreview, type OpenFile } from "./editor-state"

export type ActivationRefreshAction = "read-text" | "stat-preview" | "none"

export function activationRefreshAction(
  file: Pick<OpenFile, "kind" | "dirty" | "readOnly"> | null | undefined,
): ActivationRefreshAction {
  if (!file) return "none"
  if (isReadOnlyPreview(file.kind)) return "stat-preview"
  if (file.readOnly) return "none"
  return "read-text"
}
