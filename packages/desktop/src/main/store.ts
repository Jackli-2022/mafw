import Store from "electron-store"
import electron from "electron"
import { rmSync } from "node:fs"
import { join } from "node:path"
import { stripStoreFileBom } from "./store-bom"
import { quarantineUnreadableStore } from "./store-quarantine"

import { SETTINGS_STORE } from "./store-keys"
import { deleteStoreFileIfEmpty } from "./store-cleanup"

const cache = new Map<string, Store>()

function constructStore(cwd: string, name: string): Store {
  return new Store({
    name,
    cwd,
    fileExtension: "",
    accessPropertiesByDotNotation: false,
  })
}

// We cannot instantiate the electron-store at module load time because
// module import hoisting causes this to run before app.setPath("userData", ...)
// in index.ts has executed, which would result in files being written to the default directory
// (e.g. bad: %APPDATA%\@opencode-ai\desktop\opencode.settings vs good: %APPDATA%\ai.mafw.desktop.dev\opencode.settings).
export function getStore(name = SETTINGS_STORE) {
  const cached = cache.get(name)
  if (cached) return cached
  const cwd = electron.app.getPath("userData")
  try {
    // Windows editors / PowerShell 5 may leave a UTF-8 BOM. electron-store's
    // JSON.parse rejects it, so normalise before construction.
    if (stripStoreFileBom(cwd, name)) {
      console.warn(`[mafw] stripped UTF-8 BOM from store "${name}"`)
    }
  } catch {
    /* unreadable store: the quarantine step below handles it */
  }
  let next: Store
  try {
    next = constructStore(cwd, name)
  } catch (error) {
    // Fail-open：损坏的 store 文件不得卡死启动——隔离后重试一次，仍失败才抛。
    const moved = quarantineUnreadableStore(cwd, name)
    if (moved) {
      console.warn(`[mafw] store "${name}" was unreadable; quarantined to ${moved}`)
      next = constructStore(cwd, name)
    } else {
      throw error
    }
  }
  cache.set(name, next)
  return next
}

export async function removeStoreFileIfEmpty(name: string) {
  if (await deleteStoreFileIfEmpty(electron.app.getPath("userData"), name)) cache.delete(name)
}

export function removeStoreFile(name: string) {
  rmSync(join(electron.app.getPath("userData"), name), { force: true })
  cache.delete(name)
}
