import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
const chat = read("src/renderer/mafw/components/ChatPane.tsx")
const header = read("src/renderer/mafw/components/EpisodeHeader.tsx")
const css = read("src/renderer/mafw/chat-episodes.css")

test("ChatPane groups visible turns into episodes", () => {
  assert.match(chat, /groupTurnsByEpisode/)
  assert.match(chat, /episodeStructureKey/)
  assert.match(chat, /EpisodeHeader/)
  assert.match(chat, /episodeCollapseOverrides/)
  assert.match(chat, /episodeForMessage/)
  assert.match(chat, /isTurnHidden/)
  assert.match(chat, /resetEpisodeCollapse/)
  assert.match(chat, /标记 Episode/)
})

test("EpisodeHeader renders status, title and human actions", () => {
  assert.match(header, /mafw-episode-header/)
  assert.match(header, /ButtonV2/)
  assert.match(header, /TextInputV2/)
  assert.match(header, /已关闭/)
  assert.match(header, /重新打开/)
  assert.match(header, /查看决定记录/)
  assert.doesNotMatch(header, /<button/)
})

test("episode CSS uses tokens and stays in flow", () => {
  assert.match(css, /\.mafw-episode-header/)
  assert.match(css, /var\(--/)
  assert.doesNotMatch(css, /position:\s*absolute/)
})
