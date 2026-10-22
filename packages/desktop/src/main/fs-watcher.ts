// fs-watcher：main 侧文件监视注册表 + 纯节流逻辑。
//
// 语义：同一 (root, rel) 幂等注册；文件事件 300ms 窗口内合并（watch 事件常成对到达：
// rename/change）；注册失败（文件不存在/权限）fail-open —— 编辑器仍有打开时读与保存时
// mtime 校验两道防线（Task 1 writeTextFile ifMtimeMs）。
import { watch as fsWatch, type FSWatcher } from "node:fs"

export const WATCH_DEBOUNCE_MS = 300

/** 注册表键：root/rel 反斜杠统一正斜杠（同一文件不同拼写不重复注册）。 */
export function watchKey(root: string, rel: string): string {
  return `${root.replace(/\\/g, "/")}::${rel.replace(/\\/g, "/")}`
}

/** lastSentAt=0 表示首次（必发）；窗口内 → 合并。 */
export function planWatchEvent(e: { lastSentAt: number; now: number }): "send" | "debounce" {
  if (e.lastSentAt === 0) return "send"
  return e.now - e.lastSentAt >= WATCH_DEBOUNCE_MS ? "send" : "debounce"
}

export interface WatchedFile {
  root: string
  rel: string
}

interface WatchEntry {
  watcher: FSWatcher
  lastSentAt: number
}

export class FsWatchRegistry {
  private entries = new Map<string, WatchEntry>()
  private send: (e: WatchedFile) => void

  constructor(send: (e: WatchedFile) => void) {
    this.send = send
  }

  /** 幂等注册；watch 失败 fail-open（不抛）。 */
  watch(root: string, rel: string, abs: string): void {
    const key = watchKey(root, rel)
    if (this.entries.has(key)) return
    try {
      const watcher = fsWatch(abs, { persistent: false }, () => {
        const entry = this.entries.get(key)
        if (!entry) return
        const now = Date.now()
        if (planWatchEvent({ lastSentAt: entry.lastSentAt, now }) === "send") {
          entry.lastSentAt = now
          this.send({ root, rel })
        }
      })
      watcher.on("error", () => this.unwatch(root, rel))
      this.entries.set(key, { watcher, lastSentAt: 0 })
    } catch {
      /* 不可 watch：忽略 */
    }
  }

  unwatch(root: string, rel: string): void {
    const key = watchKey(root, rel)
    const entry = this.entries.get(key)
    if (!entry) return
    try { entry.watcher.close() } catch { /* ignore */ }
    this.entries.delete(key)
  }

  unwatchAll(): void {
    for (const entry of this.entries.values()) {
      try { entry.watcher.close() } catch { /* ignore */ }
    }
    this.entries.clear()
  }
}
