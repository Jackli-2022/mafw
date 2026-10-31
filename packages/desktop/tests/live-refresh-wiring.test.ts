import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8")

// 工作台实时刷新（2026-10-31）：
// ① 后台 tab 切回时重新读盘（活动文件之外的改动不再永久 stale）
// ② 文件树跟随目录变更自动刷新（agent 新建/删除文件无需手点刷新）
test("编辑器激活时重新读盘：文本按 mtime 静默换基准，dirty 只探测冲突", () => {
  const src = read("src/renderer/mafw/components/EditorDock.tsx")
  assert.match(src, /refreshActiveFromDisk/)
  assert.match(src, /activationRefreshAction/)
  // mountActive 默认刷新；刚读盘打开的路径传 fresh 跳过重复读
  assert.match(src, /async function mountActive\(opts\?: \{ fresh\?: boolean \}\)/)
  assert.match(src, /mountActive\(\{ fresh: true \}\)/)
  // 只读预览：mtime 未变不得 bump 版本（否则每次切 tab 都重解析闪帧）
  const refresh = src.slice(src.indexOf("async function refreshActiveFromDisk"), src.indexOf("function setDocs"))
  assert.match(refresh, /statFile/)
  assert.match(refresh, /getMtime/)
  assert.match(refresh, /getMtime\(root, rel\) === st\.mtimeMs/)
})

test("目录 watch：main 注册 fs-watch-dir 并广播 fs-dir-changed", () => {
  const ipc = read("src/main/ipc.ts")
  assert.match(ipc, /new FsWatchRegistry/)
  assert.match(ipc, /fs-dir-changed/)
  assert.match(ipc, /ipcMain\.handle\("fs-watch-dir"/)
  assert.match(ipc, /ipcMain\.handle\("fs-unwatch-dir"/)
  assert.match(ipc, /resolveDirInRoot/)
})

test("目录 watch：preload 暴露 watchDir/unwatchDir/onDirChanged", () => {
  const preload = read("src/preload/index.ts")
  assert.match(preload, /watchDir: \(root, rel\) => ipcRenderer\.invoke\("fs-watch-dir"/)
  assert.match(preload, /unwatchDir: \(root, rel\) => ipcRenderer\.invoke\("fs-unwatch-dir"/)
  assert.match(preload, /onDirChanged: \(cb\) =>/)
  const types = read("src/preload/types.ts")
  assert.match(types, /watchDir\(root: string, rel: string\): Promise<void>/)
  assert.match(types, /unwatchDir\(root: string, rel: string\): Promise<void>/)
  assert.match(types, /onDirChanged\(cb: \(e: \{ root: string; rel: string \}\) => void\): \(\) => void/)
})

test("文件树自动刷新：展开目录被 watch，事件只重列受影响目录", () => {
  const dock = read("src/renderer/mafw/components/FilesDock.tsx")
  assert.match(dock, /planDirWatches/)
  assert.match(dock, /onDirChanged/)
  assert.match(dock, /nextChildrenAfterRefresh/)
  assert.match(dock, /watchDir/)
  assert.match(dock, /unwatchDir/)
  // 根目录始终 watch（rel=""）
  assert.match(dock, /wanted\.add\(""\)/)
  // 不整树重置：事件路径不调用 loadRoot
  const handler = dock.slice(dock.indexOf("onDirChanged"), dock.indexOf("const rows ="))
  assert.doesNotMatch(handler, /loadRoot\(\)/)
})
