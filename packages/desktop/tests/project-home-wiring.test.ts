import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8")

const work = read("src/renderer/mafw/components/ProjectWorkView.tsx")
const files = read("src/renderer/mafw/components/ProjectFilesCard.tsx")
const recents = read("src/renderer/mafw/components/RecentContentList.tsx")
const dock = read("src/renderer/mafw/components/FilesDock.tsx")
const shell = read("src/renderer/mafw/MafwShell.tsx")

test("project home composes project files and recent content", () => {
  assert.match(work, /ProjectFilesCard/)
  assert.match(work, /RecentContentList/)
  assert.match(work, /mafw-project-home-content/)
  assert.match(work, /props\.files/)
  assert.match(work, /props\.recents/)

  assert.match(files, /FilesDock/)
  assert.match(files, /title="项目文件"/)
  assert.match(files, /onBrowse/)
  assert.match(files, /aria-label="在内容工作台打开项目文件"/)

  assert.match(recents, /splitRelPath/)
  assert.match(recents, /还没有最近打开的文件/)
  assert.match(recents, /onOpen\(entry\)/)

  assert.match(dock, /title\?: string/)
  assert.match(dock, /headerAction\?: JSX\.Element/)
})

test("project home opens files on the project scope and records recents", () => {
  assert.match(shell, /const openProjectFile/)
  assert.match(shell, /const openContentFile/)
  assert.match(shell, /readRecentContent/)
  assert.match(shell, /recordRecentContent/)
  assert.match(shell, /projectContentScope\(project\)/)
  assert.match(shell, /setContentReturnGoalId\(null\)/)
  assert.match(shell, /setContentScope\(scope\)/)
  assert.match(shell, /files=\{\{/)
  assert.match(shell, /recents=\{\{/)
  assert.match(shell, /onBrowse/)
})
