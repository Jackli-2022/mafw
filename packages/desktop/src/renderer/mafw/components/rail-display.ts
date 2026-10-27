// rail 展示层纯函数（spec 2026-10-27-left-rail-visual-polish-design §6.2）。
// 只做展示格式化，不改存储值：重命名草稿/拾取回调继续用原始 title。

/** `New session - <ISO>` 兜底标题 → `未命名 · 10月13日`；空 → 未命名；其余原样。幂等。 */
export function formatRailTitle(title: string | null | undefined): string {
  const raw = (title ?? "").trim()
  if (!raw) return "未命名"
  if (/^New conversation$/i.test(raw)) return "未命名" // runtime 空会话占位
  const m = raw.match(/^New session - (\d{4})-(\d{2})-(\d{2})T/)
  if (m) return `未命名 · ${Number(m[2])}月${Number(m[3])}日`
  return raw
}

/** 项目名 basename；退化名（空 / "." / 尾分隔符）按当前项目与否兜底。 */
export function railProjectName(raw: string | null | undefined, isCurrent: boolean): string {
  const base = (raw ?? "").split(/[/\\]/).pop()?.trim() ?? ""
  if (!base || base === ".") return isCurrent ? "当前项目" : "未命名项目"
  return base
}

const PHASE_LABELS: Record<string, string> = {
  PLANNING: "规划中",
  EXECUTING: "执行中",
  REVIEWING: "审阅中",
  ASKING_USER: "待提问",
}

/** goal phase 极简中文化；未知回退原文，null/undefined → 空闲。 */
export function managerPhaseLabel(phase: string | null | undefined): string {
  if (!phase) return "空闲"
  return PHASE_LABELS[phase] ?? phase
}
