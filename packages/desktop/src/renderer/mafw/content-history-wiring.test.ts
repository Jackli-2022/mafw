import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const read = (path: string) => readFileSync(join(import.meta.dirname, path), "utf8")
const shell = read("MafwShell.tsx")
const header = read("components/ContentScopeHeader.tsx")

test("the shell remembers content locations before opening another one", () => {
  assert.match(shell, /contentHistory/)
  assert.match(shell, /pushContentHistory/)
  assert.match(shell, /popContentHistory/)
  assert.match(shell, /rememberContentLocation/)
  assert.match(shell, /backContent/)
  assert.match(shell, /contentScopeBelongsToProject/)
  assert.match(shell, /setContentHistory\(\[\]\)/)
  const onOpenFile = shell.slice(shell.indexOf("onOpenFile={"), shell.indexOf("onSendAnnotation={"))
  assert.match(onOpenFile, /rememberContentLocation\(\)/)
})

test("the scope header exposes a real back action", () => {
  assert.match(header, /canGoBack/)
  assert.match(header, /onBack/)
  assert.match(header, /返回/)
  assert.match(header, /TooltipV2/)
  assert.match(header, /openDelay=\{300\}/)
  assert.match(header, /backLabel/)
})

test("back restores the tree selection and names its destination", () => {
  assert.match(shell, /contentBackLabel/)
  assert.match(shell, /backLabel=\{contentBackLabel\(\)\}/)
  const back = shell.slice(shell.indexOf("const backContent"), shell.indexOf("const openGoalContent"))
  assert.match(back, /selectTreeFile\(/)
  assert.match(back, /saveContentScopeState\(/)
})
