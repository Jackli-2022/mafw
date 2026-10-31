// Office 预览重载判定（2026-10-31 闪帧回归）。
//
// 背景：OfficePreview 的解析 effect 直接读 props.kind / props.url；这两个 getter
// 的响应式依赖链包含 `benchRoot()`（经 props.sessionDirectory），而 benchRoot 在
// 回合开始/结束（sessions 数组替换）时会被重新读取。即便解析出的目录与 url 完全
// 没变，effect 也会重跑——旧实现无条件清空 host.innerHTML 重新解析，肉眼就是
// 一次白/黑帧。
//
// 契约：解析只在「同一文件的新版本」或「换文件」时发生；无关信号抖动不重载。
export type OfficePreviewLoad = {
  /** 已加载的键（空串 = 尚未加载）。 */
  key: string
  /** 本次是否需要重新解析。 */
  reload: boolean
}

/** kind + url 的稳定键；用 \u0000 分隔，避免 url 内换行造成跨字段串键。 */
export function officePreviewKey(kind: string, url: string): string {
  return `${kind}\u0000${url}`
}

/**
 * 下一次 effect 运行是否应重新解析。
 * - url 为空（root token 未就绪）：不加载，也不丢弃旧键（host 未被清空）。
 * - 键相同：无关信号抖动 → 不重载。
 * - 键变化（新文件 / 新版本）：重载。
 */
export function nextOfficePreviewLoad(prevKey: string, kind: string, url: string): OfficePreviewLoad {
  if (!url) return { key: prevKey, reload: false }
  const key = officePreviewKey(kind, url)
  return { key, reload: key !== prevKey }
}
