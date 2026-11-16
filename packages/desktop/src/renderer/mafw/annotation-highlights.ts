// 预览面 quote 批注高亮（ADE 同款 CSS Custom Highlight API）。
// 用浏览器原生 Highlight 画在文本上：随内容滚动、不改 DOM；不支持时由 EditorDock 回退到 rect 层。
export type QuoteHighlightState = "pending" | "held" | "active"

export function quoteHighlightState(active: boolean, held: boolean): QuoteHighlightState {
  if (active) return "active"
  return held ? "held" : "pending"
}

const supports = (): boolean =>
  typeof CSS !== "undefined" &&
  !!(CSS as any).highlights &&
  typeof (globalThis as any).Highlight === "function"

const ranges = new Map<string, Range>()
const current = new Map<string, QuoteHighlightState>()
const groups = new Map<QuoteHighlightState, any>()

function groupFor(state: QuoteHighlightState): any | null {
  if (!supports()) return null
  let group = groups.get(state)
  if (!group) {
    group = new (globalThis as any).Highlight()
    ;(CSS as any).highlights.set(`mafw-annot-${state}`, group)
    groups.set(state, group)
  }
  return group
}

function detach(id: string): void {
  const range = ranges.get(id)
  if (!range) return
  for (const group of groups.values()) group.delete(range)
}

/** 注册或替换一条 quote 高亮（创建批注时调用，Range 必须是当前 DOM 的活 Range）。 */
export function setQuoteHighlight(id: string, range: Range, state: QuoteHighlightState = "pending"): void {
  if (!supports()) return
  detach(id)
  ranges.set(id, range)
  groupFor(state)?.add(range)
  current.set(id, state)
}

/** 在 pending / held / active 之间移动，不重建 Range。 */
export function updateQuoteHighlightState(id: string, state: QuoteHighlightState): void {
  if (!supports() || current.get(id) === state) return
  const range = ranges.get(id)
  if (!range) return
  detach(id)
  groupFor(state)?.add(range)
  current.set(id, state)
}

export function removeQuoteHighlight(id: string): void {
  if (!supports()) return
  detach(id)
  ranges.delete(id)
  current.delete(id)
}

export function quoteHighlightRange(id: string): Range | null {
  return ranges.get(id) ?? null
}

/** 在 DOM 里按引文找回 Range（刷新/切换文件后恢复高亮）。空白折叠后匹配。 */
export function findQuoteRange(root: ParentNode, quote: string): Range | null {
  const target = quote.replace(/\s+/g, " ").trim()
  if (!target) return null
  const doc = (root as Node).ownerDocument ?? document
  const walker = doc.createTreeWalker(root as Node, NodeFilter.SHOW_TEXT, {
    acceptNode(node: Node) {
      const parent = (node as Text).parentElement
      if (!parent || parent.closest("script, style")) return NodeFilter.FILTER_REJECT
      return NodeFilter.FILTER_ACCEPT
    },
  })
  const nodes: Text[] = []
  while (walker.nextNode()) nodes.push(walker.currentNode as Text)
  if (nodes.length === 0) return null

  let norm = ""
  const map: { node: Text; offset: number }[] = []
  let lastSpace = false
  for (const node of nodes) {
    const data = node.data
    for (let i = 0; i < data.length; i++) {
      const ch = data[i]
      if (/\s/.test(ch)) {
        if (lastSpace) continue
        norm += " "
        map.push({ node, offset: i })
        lastSpace = true
      } else {
        norm += ch
        map.push({ node, offset: i })
        lastSpace = false
      }
    }
  }

  const at = norm.indexOf(target)
  if (at < 0) return null
  const start = map[at]
  const end = map[at + target.length - 1]
  if (!start || !end) return null
  const range = doc.createRange()
  range.setStart(start.node, start.offset)
  range.setEnd(end.node, end.offset + 1)
  return range
}

export function clearQuoteHighlights(): void {
  ranges.clear()
  current.clear()
  for (const group of groups.values()) group.clear()
}

export function supportsQuoteHighlights(): boolean {
  return supports()
}
