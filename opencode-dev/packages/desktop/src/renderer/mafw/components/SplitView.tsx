import { createEffect, createSignal, onCleanup, type JSX } from "solid-js"

/**
 * Split tree node. Leaves are either a concrete session (`sid`) or an empty
 * placeholder pane (`empty`) that the shell renders a session-picker into.
 */
export type SplitLeaf = { sid: string } | { empty: true }
export type SplitNode =
  | { dir: "h" | "v"; ratio: number; a: SplitNode; b: SplitNode }
  | SplitLeaf

export const isLeaf = (n: SplitNode): n is SplitLeaf => "sid" in n || "empty" in n
export const isSidLeaf = (n: SplitNode): n is { sid: string } => "sid" in n
export const isEmptyLeaf = (n: SplitNode): n is { empty: true } => "empty" in n

/** Session ids currently on screen (placeholder leaves are excluded). */
export function leafIds(root: SplitNode): string[] {
  if (isSidLeaf(root)) return [root.sid]
  if (isEmptyLeaf(root)) return []
  return [...leafIds(root.a), ...leafIds(root.b)]
}

/** Total pane count (session + placeholder leaves). Used for the 4-pane cap. */
export function leafCount(root: SplitNode): number {
  if (isLeaf(root)) return 1
  return leafCount(root.a) + leafCount(root.b)
}

/** Path (sequence of a/b choices) of the first leaf in the tree. */
export function firstLeafPath(root: SplitNode): number[] {
  if (isLeaf(root)) return []
  if (isLeaf(root.a)) return [0]
  return [0, ...firstLeafPath(root.a)]
}

/** Path of the leaf holding `sid`, or null if it is not on screen. */
export function findSidPath(root: SplitNode, sid: string, prefix: number[] = []): number[] | null {
  if (isSidLeaf(root)) return root.sid === sid ? prefix : null
  if (isEmptyLeaf(root)) return null
  const a = findSidPath(root.a, sid, [...prefix, 0])
  if (a) return a
  return findSidPath(root.b, sid, [...prefix, 1])
}

/** Replace the first empty placeholder leaf with a concrete session. */
export function fillEmpty(root: SplitNode, sid: string): SplitNode {
  if (isEmptyLeaf(root)) return { sid }
  if (isSidLeaf(root)) return root
  const a = fillEmpty(root.a, sid)
  if (a !== root.a) return { ...root, a }
  const b = fillEmpty(root.b, sid)
  return b === root.b ? root : { ...root, b }
}

/**
 * Replace the leaf holding `target` (fallback: first sid leaf) with a split
 * whose right/bottom pane shows `fresh`.
 *
 * Guards:
 * - `fresh === target` → no-op (never duplicate a session into two panes)
 * - `fresh` already on screen → no-op
 * - total pane count already >= 4 → no-op (4-pane cap)
 */
export function splitLeaf(root: SplitNode, target: string, dir: "h" | "v", fresh: string): SplitNode {
  if (fresh === target) return root
  if (leafIds(root).includes(fresh)) return root
  if (leafCount(root) >= 4) return root

  const fallback = leafIds(root)[0] ?? target
  const targetId = target || fallback

  const walk = (n: SplitNode): SplitNode => {
    if (isEmptyLeaf(n)) return n
    if (isSidLeaf(n)) return n.sid === targetId ? { dir, ratio: 0.5, a: n, b: { sid: fresh } } : n
    const a = walk(n.a)
    const b = walk(n.b)
    if (a === n.a && b === n.b) return n
    return { ...n, a, b }
  }

  const result = walk(root)
  if (result === root) {
    // Target not found anywhere — split the first leaf.
    if (isEmptyLeaf(root)) return { dir, ratio: 0.5, a: root, b: { sid: fresh } }
    if (isSidLeaf(root)) return { dir, ratio: 0.5, a: root, b: { sid: fresh } }
    return result
  }
  return result
}

/** Remove the leaf holding `target`; the parent split collapses to its sibling. */
export function removeLeaf(root: SplitNode, target: string): SplitNode {
  const remove = (n: SplitNode): SplitNode | null => {
    if (isSidLeaf(n)) return n.sid === target ? null : n
    if (isEmptyLeaf(n)) return n
    const a = remove(n.a)
    const b = remove(n.b)
    if (!a) return b
    if (!b) return a
    if (a === n.a && b === n.b) return n
    return { ...n, a, b }
  }
  return remove(root) ?? { empty: true }
}

/**
 * Remove the leaf holding `sid` anywhere in the tree. Returns the new tree,
 * whether a leaf was actually removed, and the path of the removed leaf (so
 * callers can detect path drift after the tree collapses).
 */
export function removeSid(
  root: SplitNode,
  sid: string,
  prefix: number[] = [],
): { tree: SplitNode; removed: boolean; removedPath?: number[] } {
  if (isSidLeaf(root)) {
    return root.sid === sid
      ? { tree: { empty: true }, removed: true, removedPath: prefix }
      : { tree: root, removed: false }
  }
  if (isEmptyLeaf(root)) return { tree: root, removed: false }
  const a = removeSid(root.a, sid, [...prefix, 0])
  const b = removeSid(root.b, sid, [...prefix, 1])
  if (!a.removed && !b.removed) return { tree: root, removed: false }
  const newA = a.removed ? a.tree : root.a
  const newB = b.removed ? b.tree : root.b
  // A side that became an empty placeholder means its only leaf was the removed
  // sid — collapse that side so the tree shrinks instead of leaving a ghost.
  if (isEmptyLeaf(newA)) return { tree: newB, removed: true, removedPath: a.removed ? a.removedPath : b.removedPath }
  if (isEmptyLeaf(newB)) return { tree: newA, removed: true, removedPath: a.removed ? a.removedPath : b.removedPath }
  return { tree: { ...root, a: newA, b: newB }, removed: true, removedPath: a.removed ? a.removedPath : b.removedPath }
}

/**
 * Split the leaf at `path` into `{ dir, ratio: 0.5, a, b }`, placing the new
 * `sid` pane on the `before` (a / left-top) or `after` (b / right-bottom) side.
 * Guards: fresh already on screen, or pane count >= 4.
 */
export function splitAtPath(
  root: SplitNode,
  path: number[],
  dir: "h" | "v",
  sid: string,
  place: "before" | "after",
): SplitNode {
  if (leafIds(root).includes(sid)) return root
  if (leafCount(root) >= 4) return root

  const walk = (n: SplitNode, idxs: number[]): SplitNode => {
    if (isLeaf(n)) {
      if (idxs.length !== 0) return n // path went past a leaf; safety
      return place === "before"
        ? { dir, ratio: 0.5, a: { sid }, b: n }
        : { dir, ratio: 0.5, a: n, b: { sid } }
    }
    if (idxs.length === 0) {
      // Path points at this internal node — split it as if it were a leaf.
      return place === "before"
        ? { dir, ratio: 0.5, a: { sid }, b: n }
        : { dir, ratio: 0.5, a: n, b: { sid } }
    }
    const [head, ...rest] = idxs
    if (head !== 0 && head !== 1) return n // invalid path index → no-op
    const child = head === 0 ? n.a : n.b
    const next = walk(child, rest)
    if (next === child) return n
    return head === 0 ? { ...n, a: next } : { ...n, b: next }
  }
  return walk(root, path)
}

/** Replace the leaf at `path` with a concrete session leaf. */
export function replaceAtPath(root: SplitNode, path: number[], sid: string): SplitNode {
  const walk = (n: SplitNode, idxs: number[]): SplitNode => {
    if (isLeaf(n)) return idxs.length === 0 ? { sid } : n
    if (idxs.length === 0) return n
    const [head, ...rest] = idxs
    if (head !== 0 && head !== 1) return n // invalid path index → no-op
    const child = head === 0 ? n.a : n.b
    const next = walk(child, rest)
    if (next === child) return n
    return head === 0 ? { ...n, a: next } : { ...n, b: next }
  }
  return walk(root, path)
}

/**
 * Direction of the split node that is the parent of the leaf at `path`
 * (`"h"` = left/right, `"v"` = top/bottom, `null` = root / no parent).
 * Used to enforce the no-same-direction nesting rule: children of an `h`
 * split may only split vertically and vice versa.
 */
export function parentDirOf(root: SplitNode, path: number[]): "h" | "v" | null {
  if (path.length === 0) return null
  let node = root
  for (let i = 0; i < path.length - 1; i++) {
    if (isLeaf(node)) return null
    const idx = path[i]
    if (idx !== 0 && idx !== 1) return null
    node = idx === 0 ? node.a : node.b
  }
  if (isLeaf(node)) return null
  const last = path[path.length - 1]
  if (last !== 0 && last !== 1) return null
  return node.dir
}

/**
 * Split the leaf at `path` into `{ dir, ratio: 0.5, a, b }`, placing `target`
 * (a session or an empty placeholder) on the `before` (a / left-top) or
 * `after` (b / right-bottom) side.
 *
 * Guards:
 * - pane count already >= 4 → no-op
 * - target is a sid that is already on screen → downgraded to an empty
 *   placeholder (never duplicate a session into two panes)
 */
export function splitWithTarget(
  root: SplitNode,
  path: number[],
  dir: "h" | "v",
  place: "before" | "after",
  target: SplitLeaf,
): SplitNode {
  if (leafCount(root) >= 4) return root
  let effective: SplitLeaf = target
  if ("sid" in target && leafIds(root).includes(target.sid)) effective = { empty: true }

  const walk = (n: SplitNode, idxs: number[]): SplitNode => {
    if (isLeaf(n)) {
      if (idxs.length !== 0) return n // path went past a leaf; safety
      return place === "before"
        ? { dir, ratio: 0.5, a: effective, b: n }
        : { dir, ratio: 0.5, a: n, b: effective }
    }
    if (idxs.length === 0) {
      // Path points at this internal node — split it as if it were a leaf.
      return place === "before"
        ? { dir, ratio: 0.5, a: effective, b: n }
        : { dir, ratio: 0.5, a: n, b: effective }
    }
    const [head, ...rest] = idxs
    if (head !== 0 && head !== 1) return n // invalid path index → no-op
    const child = head === 0 ? n.a : n.b
    const next = walk(child, rest)
    if (next === child) return n
    return head === 0 ? { ...n, a: next } : { ...n, b: next }
  }
  return walk(root, path)
}

/**
 * Set the `ratio` of the split node at `path` (the node itself, not its
 * parent). `path` is the sequence of a/b choices from the root to the node
 * whose resize handle fired; `[]` targets the root.
 */
export function setRatio(root: SplitNode, path: number[], ratio: number): SplitNode {
  const walk = (n: SplitNode, idxs: number[]): SplitNode => {
    if (isLeaf(n)) return n
    if (idxs.length === 0) return { ...n, ratio }
    const [head, ...rest] = idxs
    if (head !== 0 && head !== 1) return n // invalid path index → no-op
    const child = head === 0 ? n.a : n.b
    const next = walk(child, rest)
    if (next === child) return n
    return head === 0 ? { ...n, a: next } : { ...n, b: next }
  }
  return walk(root, path)
}

/** Leaf at `path`, or null if the path no longer terminates in a leaf (tree shrank). */
function leafAtPath(root: SplitNode, path: number[]): SplitLeaf | null {
  let node = root
  for (let i = 0; i < path.length; i++) {
    if (isLeaf(node)) return null
    node = path[i] === 0 ? node.a : node.b
  }
  return isLeaf(node) ? node : null
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const samePath = (a: number[], b: number[]) => JSON.stringify(a) === JSON.stringify(b)

/** Zone of a drop position within a pane (left/right/top/bottom edge or center). */
export type DropZone = "left" | "right" | "top" | "bottom" | "center"

export function zoneForPoint(rect: DOMRect, x: number, y: number): DropZone {
  const edge = 0.24
  const dx = x / rect.width
  const dy = y / rect.height
  if (dx <= edge) return "left"
  if (dx >= 1 - edge) return "right"
  if (dy <= edge) return "top"
  if (dy >= 1 - edge) return "bottom"
  return "center"
}

export function zoneToDir(zone: DropZone): { dir: "h" | "v"; place: "before" | "after" } | null {
  switch (zone) {
    case "left": return { dir: "h", place: "before" }
    case "right": return { dir: "h", place: "after" }
    case "top": return { dir: "v", place: "before" }
    case "bottom": return { dir: "v", place: "after" }
    case "center": return null
  }
}

type Props = {
  root: SplitNode
  renderLeaf: (leaf: SplitLeaf, path: number[]) => JSX.Element
  onRatio: (path: number[], ratio: number) => void
  /** Shell drag handlers, keyed by leaf path. */
  onLeafDragOver?: (path: number[], e: DragEvent) => void
  onLeafDrop?: (path: number[], e: DragEvent) => void
  /** Active drop preview for a specific leaf path + zone. */
  preview?: { path: number[]; zone: DropZone } | null
}

const MIN_PX = 160

type NodeProps = {
  node: SplitNode
  path: number[]
  renderLeaf: (leaf: SplitLeaf, path: number[]) => JSX.Element
  renderChild: (node: SplitNode, path: number[]) => JSX.Element
  onRatio: (path: number[], ratio: number) => void
  onLeafDragOver?: (path: number[], e: DragEvent) => void
  onLeafDrop?: (path: number[], e: DragEvent) => void
  preview?: { path: number[]; zone: DropZone } | null
  /** Leaf is temporarily hidden by a maximized sibling (DOM kept alive). */
  hidden?: boolean
  onToggleMaximize?: (path: number[]) => void
}

/** Observe a container's size with a ResizeObserver; returns its current size. */
function useObservedSize(): { ref: (el: HTMLDivElement | undefined) => void; size: () => { w: number; h: number } } {
  let el: HTMLDivElement | undefined
  const [size, setSize] = createSignal({ w: 0, h: 0 })
  let ro: ResizeObserver | null = null

  const update = (target: HTMLDivElement) => {
    const w = target.clientWidth
    const h = target.clientHeight
    setSize(prev => (prev.w === w && prev.h === h ? prev : { w, h }))
  }

  const ref = (node: HTMLDivElement | undefined) => {
    if (node === el) return
    el = node
    ro?.disconnect()
    ro = null
    if (!node) return
    update(node)
    ro = new ResizeObserver(() => update(node))
    ro.observe(node)
  }

  onCleanup(() => ro?.disconnect())

  return { ref, size }
}

/** A single session/placeholder pane. Only ever receives leaf nodes. */
function SplitLeafView(props: NodeProps) {
  const { ref, size } = useObservedSize()
  void size // leaf has no ratio math; size kept for symmetry
  const key = JSON.stringify(props.path)
  const active = props.preview?.path && JSON.stringify(props.preview.path) === key ? props.preview.zone : null
  return (
    <div
      ref={ref}
      class="mafw-pane-drop"
      style={props.hidden ? { display: "none" } : undefined}
      data-path={key}
      onDragOver={props.onLeafDragOver ? (e) => props.onLeafDragOver!(props.path, e) : undefined}
      onDrop={props.onLeafDrop ? (e) => props.onLeafDrop!(props.path, e) : undefined}
      onDblClick={(e) => {
        // Double-click on the pane title bar (not its buttons) toggles maximize;
        // placeholder panes maximize from anywhere.
        const target = e.target as HTMLElement
        const titleHit = !!target.closest(".mafw-session-titlebar-inner") && !target.closest("button")
        if (props.onToggleMaximize && (isEmptyLeaf(props.node) || titleHit)) props.onToggleMaximize(props.path)
      }}
    >
      {props.renderLeaf(props.node as SplitLeaf, props.path)}
      {active ? <div class={`mafw-pane-preview mafw-pane-preview-${active}`} /> : null}
    </div>
  )
}

/** A split branch (two cells + draggable divider). Only ever receives split nodes. */
function SplitBranchView(props: NodeProps) {
  const { ref, size } = useObservedSize()
  const [dragging, setDragging] = createSignal(false)
  // Local ratio applied during a divider drag. Committing through onRatio on
  // every mousemove would rebuild the whole split subtree each frame (the
  // leaf content is not keyed), which cancels the drag via onCleanup.
  const [dragRatio, setDragRatio] = createSignal<number | null>(null)
  const node = props.node
  if (isLeaf(node)) return <>{props.renderLeaf(node, props.path)}</>
  const branch = node
  const horizontal = branch.dir === "h"
  let drag: { axis: "x" | "y"; startClient: number; startRatio: number } | null = null

  function stopDividerDrag() {
    if (drag) {
      const committed = dragRatio() ?? drag.startRatio
      if (Math.abs(committed - drag.startRatio) > 0.0005) props.onRatio(props.path, committed)
    }
    drag = null
    setDragRatio(null)
    setDragging(false)
    document.body.style.cursor = ""
    document.body.style.userSelect = ""
    window.removeEventListener("mousemove", onDividerMove)
    window.removeEventListener("mouseup", stopDividerDrag)
  }
  function onDividerMove(e: MouseEvent) {
    if (!drag) return
    const dim = drag.axis === "x" ? size().w : size().h
    if (dim <= 0) return
    const minR = Math.min(MIN_PX / dim, 0.45)
    setDragRatio(clamp(drag.startRatio + ((drag.axis === "x" ? e.clientX : e.clientY) - drag.startClient) / dim, minR, 1 - minR))
  }
  function onDividerDown(e: MouseEvent) {
    if (e.button !== 0) return
    e.preventDefault()
    const dim = horizontal ? size().w : size().h
    if (dim <= 0) return
    drag = { axis: horizontal ? "x" : "y", startClient: horizontal ? e.clientX : e.clientY, startRatio: branch.ratio }
    setDragRatio(branch.ratio)
    setDragging(true)
    document.body.style.cursor = horizontal ? "col-resize" : "row-resize"
    document.body.style.userSelect = "none"
    window.addEventListener("mousemove", onDividerMove)
    window.addEventListener("mouseup", stopDividerDrag)
  }
  onCleanup(stopDividerDrag)

  const ratio = () => dragRatio() ?? branch.ratio
  return (
    <div ref={ref} class={`mafw-split${horizontal ? " mafw-split-h" : " mafw-split-v"}`}>
      <div class="mafw-split-cell" style={{ flex: `${ratio()} 1 0`, "min-width": 0, "min-height": 0 }}>
        {props.renderChild(node.a, [...props.path, 0])}
      </div>
      <div
        class={`mafw-split-divider${horizontal ? " mafw-split-divider-h" : " mafw-split-divider-v"}${dragging() ? " mafw-split-divider-active" : ""}`}
        onMouseDown={onDividerDown}
      />
      <div class="mafw-split-cell" style={{ flex: `${1 - ratio()} 1 0`, "min-width": 0, "min-height": 0 }}>
        {props.renderChild(node.b, [...props.path, 1])}
      </div>
    </div>
  )
}

export function SplitView(props: Props) {
  // Maximized pane is a transient view state (like VS Code group maximize):
  // it hides sibling leaves via `hidden` (DOM kept alive) without touching the
  // layout tree, and is never persisted.
  const [maximized, setMaximized] = createSignal<number[] | null>(null)
  // Reset the maximized pane whenever the tree's leaf set changes (split,
  // close, or switching to a different split view). A stale maximized path
  // would otherwise hide a pane in the new layout. Ratio-only updates (divider
  // drags) keep the leaf set and therefore preserve the maximized state.
  let lastLeaves = ""
  createEffect(() => {
    const leaves = leafIds(props.root).join(",")
    if (leaves !== lastLeaves) {
      lastLeaves = leaves
      setMaximized(null)
      return
    }
    const p = maximized()
    if (p && !leafAtPath(props.root, p)) setMaximized(null)
  })
  const toggleMaximize = (path: number[]) => {
    setMaximized(prev => (prev && samePath(prev, path) ? null : path))
  }

  // Dispatch by node kind at a stable location so SplitLeafView and
  // SplitBranchView each keep a stable hook call graph (they are separate
  // components; a single component switching between both shapes breaks
  // SolidJS's signal registration and leaks cleanups).
  const renderChild = (node: SplitNode, path: number[]): JSX.Element => {
    const maxPath = maximized()
    const hidden = !!maxPath && !samePath(maxPath, path)
    if (isLeaf(node)) {
      return (
        <SplitLeafView
          node={node}
          path={path}
          hidden={hidden}
          renderLeaf={props.renderLeaf}
          renderChild={renderChild}
          onRatio={props.onRatio}
          onLeafDragOver={props.onLeafDragOver}
          onLeafDrop={props.onLeafDrop}
          preview={props.preview}
          onToggleMaximize={toggleMaximize}
        />
      )
    }
    return (
      <SplitBranchView
        node={node}
        path={path}
        renderLeaf={props.renderLeaf}
        renderChild={renderChild}
        onRatio={props.onRatio}
        onLeafDragOver={props.onLeafDragOver}
        onLeafDrop={props.onLeafDrop}
        preview={props.preview}
        onToggleMaximize={toggleMaximize}
      />
    )
  }

  return (
    <div class="mafw-split-root">
      {renderChild(props.root, [])}
    </div>
  )
}
