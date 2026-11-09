import Store from "electron-store"
import electron from "electron"
import { rmSync } from "node:fs"
import { join } from "node:path"
import { stripStoreFileBom } from "./store-bom"

import { SETTINGS_STORE } from "./store-keys"
import { deleteStoreFileIfEmpty } from "./store-cleanup"

const cache = new Map<string, Store>()

// We cannot instantiate the electron-store at module load time because
// module import hoisting causes this to run before app.setPath("userData", ...)
// in index.ts has executed, which would result in files being written to the default directory
// (e.g. bad: %APPDATA%\@opencode-ai\desktop\opencode.settings vs good: %APPDATA%\ai.opencode.desktop.dev\opencode.settings).
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
    /* unreadable store: let electron-store report it */
  }
  const next = new Store({
    name,
    cwd,
    fileExtension: "",
    accessPropertiesByDotNotation: false,
  })
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
