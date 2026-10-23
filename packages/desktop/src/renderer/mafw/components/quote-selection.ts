// 选区抑制快照：Esc/滚动关闭引用工具栏后，keyup/mouseup 不能把同一选区
// 立刻重新弹出；只有选区真正变化（文本/节点/偏移）才重新允许。
// Node 用 unknown 以便纯逻辑测试注入假对象。

export interface QuoteSelectionSnapshot {
  text: string
  anchorNode: unknown
  anchorOffset: number
  focusNode: unknown
  focusOffset: number
}

export interface QuoteSelectionLike {
  toString(): string
  anchorNode: unknown
  anchorOffset: number
  focusNode: unknown
  focusOffset: number
}

export function snapshotQuoteSelection(sel: QuoteSelectionLike): QuoteSelectionSnapshot {
  return {
    text: sel.toString(),
    anchorNode: sel.anchorNode,
    anchorOffset: sel.anchorOffset,
    focusNode: sel.focusNode,
    focusOffset: sel.focusOffset,
  }
}

export function sameQuoteSelection(sel: QuoteSelectionLike, snap: QuoteSelectionSnapshot | null): boolean {
  if (!snap) return false
  return (
    sel.toString() === snap.text
    && sel.anchorNode === snap.anchorNode
    && sel.anchorOffset === snap.anchorOffset
    && sel.focusNode === snap.focusNode
    && sel.focusOffset === snap.focusOffset
  )
}
