// Composer ↑/↓ input history. One instance per PaneInner; pure state
// machine so it is testable without SolidJS.
//
// 语义（readline 对齐，2026-10-21 修复"仅空框生效"缺陷）：
// - up(current) 从 live 进入历史时保存 live 草稿；down() 到底恢复该草稿
//   （此前返回 "" 直接清空用户打到一半的输入）；
// - 门判定（是否翻历史 vs 光标移动）见 shouldNavigateHistory——按 caret
//   行位置判定，不要求输入框为空。
export function createInputHistory(max = 50) {
  let entries: string[] = []
  let cursor = -1 // -1 = at live input
  let liveDraft = "" // live input snapshot saved on entering history

  return {
    push(text: string) {
      const t = text.trim()
      cursor = -1
      if (!t) return
      if (entries[entries.length - 1] === t) return
      entries.push(t)
      if (entries.length > max) entries = entries.slice(entries.length - max)
    },
    up(current: string): string | null {
      if (entries.length === 0) return null
      if (cursor < 0) {
        // Entering history from live input: snapshot the draft for down-at-bottom.
        liveDraft = current
        cursor = entries.length - 1
        return entries[cursor]
      }
      const next = cursor - 1
      if (next < 0) return null
      cursor = next
      return entries[next]
    },
    down(): string | null {
      if (cursor < 0) return null
      if (cursor >= entries.length - 1) {
        cursor = -1
        return liveDraft
      }
      cursor = cursor + 1
      return entries[cursor]
    },
    /** 是否处于历史遍历态（↑ 进入后、↓ 回到 live 前）。遍历态下 ↑/↓ 直接遍历，不受多行 caret 门限制。 */
    browsing(): boolean {
      return cursor >= 0
    },
  }
}

/**
 * ↑/↓ 翻历史的门判定（call site 还需叠加 picker 打开优先 / IME 组合中不抢键）：
 * - ArrowUp：caret 在首行（caret 前无换行）才翻历史，多行中间让位光标移动；
 * - ArrowDown：caret 在末行（caret 后无换行）才翻历史；
 * - 输入框非空同样生效——旧门条件 `!value` 导致"召回一条后走不动、↓ 全废"。
 */
export function shouldNavigateHistory(key: string, value: string, caret: number): boolean {
  const c = Math.max(0, Math.min(caret, value.length))
  if (key === "ArrowUp") return !value.slice(0, c).includes("\n")
  if (key === "ArrowDown") return !value.slice(c).includes("\n")
  return false
}
