/**
 * Tab slinky（Chrome 语义）：关闭 tab 后其余 tab 保持当前像素宽，
 * 直到指针离开 strip——连续点 × 时下一个 tab 的 × 总在光标原位置。
 * freeze 返回 restore；重复 freeze 幂等（以首次冻结前的 flex 为准）。
 */
export interface FreezableEl {
  offsetWidth: number
  style: { flex: string }
}

export function freezeTabs(els: FreezableEl[]): () => void {
  const restores = els.map((el) => {
    const prev = el.style.flex
    el.style.flex = `0 0 ${el.offsetWidth}px`
    return () => { el.style.flex = prev }
  })
  let done = false
  return () => {
    if (done) return
    done = true
    for (const r of restores) r()
  }
}
