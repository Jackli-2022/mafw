// 目录 watcher 的 renderer 侧引用计数：项目首页树与内容树可能同时挂载，
// main 侧同一个 (root, rel) 幂等注册，但任一方卸载直接 unwatch 会误关另一方的监听。
export type DirWatchApi = {
  watchDir(root: string, rel: string): void
  unwatchDir(root: string, rel: string): void
}

export type DirWatchPool = {
  acquire(root: string, rel: string): () => void
  countFor(root: string, rel: string): number
}

function watchKey(root: string, rel: string): string {
  return `${root.replace(/\\/g, "/")}::${rel.replace(/\\/g, "/")}`
}

type Entry = { count: number; root: string; rel: string }

export function createDirWatchPool(api: DirWatchApi): DirWatchPool {
  const entries = new Map<string, Entry>()

  return {
    acquire(root, rel) {
      const key = watchKey(root, rel)
      const entry = entries.get(key)
      if (!entry) {
        // 用第一次注册的拼写配对 watch/unwatch；key 只用于等价判断。
        entries.set(key, { count: 1, root, rel })
        api.watchDir(root, rel)
      } else {
        entry.count += 1
      }
      let released = false
      return () => {
        if (released) return
        released = true
        const current = entries.get(key)
        if (!current) return
        if (current.count <= 1) {
          entries.delete(key)
          api.unwatchDir(current.root, current.rel)
          return
        }
        current.count -= 1
      }
    },
    countFor(root, rel) {
      return entries.get(watchKey(root, rel))?.count ?? 0
    },
  }
}

function defaultApi(): DirWatchApi | null {
  if (typeof window === "undefined") return null
  const fs = (window as unknown as { api?: { fs?: { watchDir?: unknown; unwatchDir?: unknown } } }).api?.fs
  if (!fs || typeof fs.watchDir !== "function" || typeof fs.unwatchDir !== "function") return null
  return {
    watchDir: (root, rel) => { (fs.watchDir as (r: string, x: string) => void)(root, rel) },
    unwatchDir: (root, rel) => { (fs.unwatchDir as (r: string, x: string) => void)(root, rel) },
  }
}

let shared: DirWatchPool | null = null

/** FilesDock 使用：懒绑定 window.api.fs；preload 不可用时返回 no-op。 */
export function acquireDirWatch(root: string, rel: string): () => void {
  if (!shared) {
    const api = defaultApi()
    if (!api) return () => {}
    shared = createDirWatchPool(api)
  }
  return shared.acquire(root, rel)
}
