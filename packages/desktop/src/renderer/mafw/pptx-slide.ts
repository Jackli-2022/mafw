// PPTX 页码解析（M5）：优先用 pptx-preview 自带的 `pptx-preview-slide-wrapper-<0-based>` 类名，
// 无该后缀时回退 DOM 顺序。
export function slideIndexOf(el: HTMLElement, all: HTMLElement[]): number {
  for (const cls of Array.from(el.classList ?? [])) {
    const m = /^pptx-preview-slide-wrapper-(\d+)$/.exec(cls)
    if (m) return Number(m[1]) + 1
  }
  const idx = all.indexOf(el)
  return idx >= 0 ? idx + 1 : 0
}
