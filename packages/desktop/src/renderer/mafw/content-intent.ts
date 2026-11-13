// 内容 surface 标签 + tab 生命周期。阅读/修改意图已删除：文件默认可直接编辑。
/** 内容 surface 的标签：打开文档后直接显示文档名，而不是泛化的「文件」。 */
export function contentDocumentLabel(rel: string | null | undefined): string {
  const name = (rel ?? "").split(/[/\\]/).pop()?.trim()
  return name || "文件"
}

/**
 * 打开模式：普通打开先给一个临时预览；显式 persist（文件树 / 从 diff 打开）→ 持久 tab。
 * 首次输入会把预览提升为持久 tab。
 */
export function openModeForTab(input: { persist?: boolean }): "preview" | "persistent" {
  return input.persist === true ? "persistent" : "preview"
}
