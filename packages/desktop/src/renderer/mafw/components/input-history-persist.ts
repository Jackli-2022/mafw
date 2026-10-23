// Composer 输入历史的 localStorage 持久化（按会话隔离）。
//
// 安全边界：> 4KB 的条目整条丢弃（绝不截半条再召回——静默发送残缺 prompt
// 比没有历史更糟）；总预算 20KB，超出时从最旧整条开始丢。坏 JSON / 存储
// 异常一律 fail-open 返回空历史，不影响输入。

export interface HistoryStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem?(key: string): void
}

export const INPUT_HISTORY_MAX_ENTRY_CHARS = 4096
export const INPUT_HISTORY_MAX_TOTAL_CHARS = 20480
export const INPUT_HISTORY_MAX_ENTRIES = 50

export function inputHistoryKey(sessionID: string): string {
  return `mafw-input-history:v1:${sessionID}`
}

function clean(entries: unknown, max: number): string[] {
  if (!Array.isArray(entries)) return []
  const out = entries
    .filter((x): x is string => typeof x === "string" && x.length > 0 && x.length <= INPUT_HISTORY_MAX_ENTRY_CHARS)
    .slice(-max)
  let total = out.reduce((n, x) => n + x.length, 0)
  while (out.length > 0 && total > INPUT_HISTORY_MAX_TOTAL_CHARS) {
    total -= out[0].length
    out.shift()
  }
  return out
}

export function loadInputHistory(storage: HistoryStorage, sessionID: string, max = INPUT_HISTORY_MAX_ENTRIES): string[] {
  try {
    const raw = storage.getItem(inputHistoryKey(sessionID))
    if (!raw) return []
    return clean(JSON.parse(raw), max)
  } catch {
    return []
  }
}

export function saveInputHistory(
  storage: HistoryStorage,
  sessionID: string,
  entries: string[],
  max = INPUT_HISTORY_MAX_ENTRIES,
): void {
  try {
    const key = inputHistoryKey(sessionID)
    const cleaned = clean(entries, max)
    if (cleaned.length === 0) {
      if (storage.removeItem) storage.removeItem(key)
      else storage.setItem(key, "[]")
      return
    }
    storage.setItem(key, JSON.stringify(cleaned))
  } catch {
    // fail-open: quota / privacy mode / serialization errors are non-fatal
  }
}
