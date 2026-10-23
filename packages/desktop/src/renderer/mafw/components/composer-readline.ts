// Composer readline 编辑层（纯函数，无 DOM/Solid）。
//
// 与 input-history 的分工：这里只管「键 → 新 value + 新选区」，历史/草稿/
// IME/picker 的门控留在 ChatPane。修饰键只认字面 Ctrl / Alt；Meta（macOS
// Cmd）与 Shift 一律不拦截，保留原生全选/关窗与扩选语义。
//
// 选区语义：移动类折叠到目标位置（左→选区头、右→选区尾）；kill 类在选区
// 非空时先删选区；Ctrl+T 在选区非空时 no-op。

export interface ReadlineState {
  value: string
  start: number
  end: number
}

export interface ReadlineMods {
  ctrl?: boolean
  alt?: boolean
  meta?: boolean
  shift?: boolean
}

const clamp = (n: number, len: number) => Math.max(0, Math.min(len, n))
const isSpace = (ch: string) => /\s/.test(ch)

function lineStart(value: string, caret: number): number {
  return value.lastIndexOf("\n", Math.max(0, caret - 1)) + 1
}

function lineEnd(value: string, caret: number): number {
  const nl = value.indexOf("\n", caret)
  return nl === -1 ? value.length : nl
}

function wordLeft(value: string, caret: number): number {
  let i = caret
  while (i > 0 && isSpace(value[i - 1])) i--
  while (i > 0 && !isSpace(value[i - 1])) i--
  return i
}

function wordRight(value: string, caret: number): number {
  let i = caret
  while (i < value.length && isSpace(value[i])) i++
  while (i < value.length && !isSpace(value[i])) i++
  return i
}

const collapse = (value: string, pos: number): ReadlineState => ({ value, start: pos, end: pos })
const removeRange = (value: string, a: number, b: number) => value.slice(0, a) + value.slice(b)

export function applyReadlineKey(
  state: ReadlineState,
  key: string,
  mods: ReadlineMods,
): ReadlineState | null {
  if (!mods || mods.meta || mods.shift) return null
  if (mods.ctrl && mods.alt) return null
  if (!mods.ctrl && !mods.alt) return null

  const value = state.value
  const len = value.length
  const rawStart = clamp(state.start, len)
  const rawEnd = clamp(state.end, len)
  const start = Math.min(rawStart, rawEnd)
  const end = Math.max(rawStart, rawEnd)
  const hasSelection = end > start
  const k = key.toLowerCase()

  if (mods.alt) {
    if (k === "b") return collapse(value, hasSelection ? start : wordLeft(value, start))
    if (k === "f") return collapse(value, hasSelection ? end : wordRight(value, end))
    return null
  }

  switch (k) {
    case "a":
      return collapse(value, lineStart(value, start))
    case "e":
      return collapse(value, lineEnd(value, end))
    case "b":
      return collapse(value, hasSelection ? start : clamp(start - 1, len))
    case "f":
      return collapse(value, hasSelection ? end : clamp(end + 1, len))
    case "k": {
      if (hasSelection) return collapse(removeRange(value, start, end), start)
      return collapse(removeRange(value, start, lineEnd(value, start)), start)
    }
    case "u": {
      if (hasSelection) return collapse(removeRange(value, start, end), start)
      return collapse(removeRange(value, lineStart(value, start), start), lineStart(value, start))
    }
    case "w": {
      if (hasSelection) return collapse(removeRange(value, start, end), start)
      const from = wordLeft(value, start)
      return collapse(removeRange(value, from, start), from)
    }
    case "t": {
      if (hasSelection || len < 2) return null
      const caret = start
      if (caret === 0) return null
      if (caret >= len) {
        if (value[len - 1] === "\n" || value[len - 2] === "\n") return null
        return collapse(value.slice(0, len - 2) + value[len - 1] + value[len - 2], len)
      }
      if (value[caret - 1] === "\n" || value[caret] === "\n") return null
      return collapse(
        value.slice(0, caret - 1) + value[caret] + value[caret - 1] + value.slice(caret + 1),
        caret + 1,
      )
    }
    default:
      return null
  }
}
