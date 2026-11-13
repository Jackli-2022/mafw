import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8")
const chat = read("src/renderer/mafw/components/ChatPane.tsx")
const send = read("src/renderer/mafw/chat/use-send-message.ts")
const preload = read("src/preload/mafw-api.ts")
const commandPicker = read("src/renderer/mafw/components/pickers/CommandPicker.tsx")

test("old skill→command synthesis is gone", () => {
  assert.doesNotMatch(chat, /for \(const s of snapshot\?\.skills/)
  assert.doesNotMatch(chat, /merged\.push\(\{ name, source: "skill" \}\)/)
})

test("slash menu shows skills only when the runtime supports invokeSkill", () => {
  assert.match(chat, /const \[skillInvokeSupported, setSkillInvokeSupported\] = createSignal\(false\)/)
  assert.match(chat, /skillInvokeSupported\(\)[\s\S]{0,160}discoveredSkills\(\)/)
  assert.match(chat, /const cmdItems = createMemo\(\(\) => buildCommands\(\)\)/)
  assert.match(commandPicker, /it\.group === "skill" \? "技能"/)
})

test("desktop calls the uniform API and never the runtime dialect", () => {
  assert.match(preload, /invokeSkill:/)
  assert.match(send, /discovery\.invokeSkill/)
  assert.doesNotMatch(send, /@\$\{cmd\.name\}/)
})
