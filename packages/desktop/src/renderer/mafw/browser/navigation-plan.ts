/** 浏览器导航决策（修复：已有 webview 时必须 loadURL，不能只靠首次 src）。 */
export function navigationPlan(hasView: boolean): { create: boolean; useSrc: boolean } {
  return hasView ? { create: false, useSrc: false } : { create: true, useSrc: true }
}
