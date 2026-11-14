import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8")
const chat = read("src/renderer/mafw/components/ChatPane.tsx")
const shell = read("src/renderer/mafw/MafwShell.tsx")
const api = read("src/preload/mafw-api.ts")
const types = read("src/preload/mafw-types.ts")

const commandBlock = (id: string) => {
  const start = chat.indexOf(`id: "${id}"`)
  assert.ok(start >= 0, `missing command ${id}`)
  const end = chat.indexOf("\n      },", start)
  assert.ok(end > start, `unterminated command ${id}`)
  return chat.slice(start, end)
}

test("preload exposes session summarize", () => {
  assert.match(types, /summarize: \(sessionID: string\) => Promise<void>/)
  assert.match(
    api,
    /summarize: \(sessionID\) => invoke\("session", "summarize", \{ path: \{ id: sessionID \}, body: \{\} \}\)/,
  )
})

test("local commands clear composer state before running", () => {
  assert.match(
    chat,
    /const runLocalCommand = \(run: \(\) => void\) => \{[\s\S]{0,240}?setInput\(""\)[\s\S]{0,240}?clearDraft\(sidProp\(\)\)[\s\S]{0,240}?closeCommandPicker\(\)[\s\S]{0,120}?run\(\)/,
  )
  assert.match(chat, /if \(item\.run\) \{ runLocalCommand\(item\.run\); return \}/)
})

test("session commands are wired", () => {
  for (const trigger of ["/compact", "/export", "/fork"]) {
    assert.match(chat, new RegExp(`trigger: "${trigger}"`))
  }

  const compact = commandBlock("compact")
  assert.match(compact, /sessions\.summarize\(sid\)/)
  assert.match(compact, /if \(!sid\) return/)
  assert.match(compact, /experienceStore\.supported\("session\.summarize"\)/)
  assert.doesNotMatch(compact, /压缩失败: \$\{e/)
  const compactBusy = compact.indexOf("sessionBusy()")
  const compactSummarize = compact.indexOf("sessions.summarize")
  assert.ok(compactBusy >= 0, "compact must check sessionBusy")
  assert.ok(compactSummarize >= 0, "compact must call sessions.summarize")
  assert.ok(
    compactBusy < compactSummarize,
    "compact must guard a busy turn before calling summarize",
  )

  assert.match(chat, /props\.onExportCurrentSession/)
  assert.match(chat, /props\.onForkCurrentSession/)
  assert.match(
    shell,
    /onExportCurrentSession=\{\(\) => \{ const sid = activeSessionId\(\); if \(sid\) void exportSession\(sid\) \}\}/,
  )
  assert.match(
    shell,
    /onForkCurrentSession=\{\(\) => \{ const sid = activeSessionId\(\); if \(sid\) void forkSessionFromMenu\(sid\) \}\}/,
  )
})

test("navigation and config commands are wired", () => {
  for (const trigger of ["/usage", "/permissions", "/diff", "/skills", "/details"]) {
    assert.match(chat, new RegExp(`trigger: "${trigger}"`))
  }

  assert.match(commandBlock("usage"), /props\.onOpenUsage/)
  assert.match(commandBlock("permissions"), /setPickerOpen\("session-config"\)/)
  assert.match(commandBlock("diff"), /props\.onOpenDiffReview/)
  assert.match(commandBlock("skills"), /mafw:open-config/)
  assert.match(commandBlock("skills"), /detail: "extensions"/)
  assert.match(commandBlock("details"), /toggleDetails\(\)/)
})

test("history commands are wired", () => {
  for (const trigger of ["/undo", "/redo"]) {
    assert.match(chat, new RegExp(`trigger: "${trigger}"`))
  }

  const undo = commandBlock("undo")
  assert.match(undo, /setCheckpointsOpen\(true\)/)
  assert.match(undo, /loadServerCheckpoints\(\)/)

  const redo = commandBlock("redo")
  const redoGuard = redo.indexOf("canUnrevert()")
  const redoAction = redo.indexOf("doUnrevert()")
  assert.ok(redoGuard >= 0, "redo must check canUnrevert")
  assert.ok(redoAction >= 0, "redo must call doUnrevert")
  assert.ok(
    redoGuard < redoAction,
    "redo must check canUnrevert before calling unrevert",
  )
})

test("plan and build commands use DTO flags only", () => {
  for (const trigger of ["/plan", "/build"]) {
    assert.match(chat, new RegExp(`trigger: "${trigger}"`))
  }

  const plan = commandBlock("plan")
  assert.match(plan, /planningAgent\(props\.primaryAgents\(\) as any\)/)
  assert.match(plan, /applyAgentSelection/)
  assert.match(plan, /没有规划 Agent/)

  const build = commandBlock("build")
  assert.match(build, /defaultAgentKey\(props\.primaryAgents\(\) as any\)/)
  assert.match(build, /findAgentEntry/)
  assert.match(build, /applyAgentSelection/)
  assert.match(build, /没有默认执行 Agent/)

  assert.match(chat, /const applyAgentSelection = \(entry: AgentEntry\)/)
  assert.match(
    chat,
    /const applyAgentSelection = \(entry: AgentEntry\) => \{[\s\S]{0,400}?agentSwitchLockReason\(\{ isLead: isLead\(\), creatorLocked: creatorLocked\(\) \}\)/,
  )
  assert.match(
    chat,
    /const onSessionAgentSelect = \(id: string\) => \{[\s\S]{0,240}?applyAgentSelection\(entry\)/,
  )
})
