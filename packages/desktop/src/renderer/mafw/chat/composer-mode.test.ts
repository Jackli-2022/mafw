import { test } from "node:test"
import assert from "node:assert/strict"
import {
  CHAT_MODE_ITEMS,
  modeActionLabel,
  modeAvailability,
  modeDirective,
  modeSendsMessage,
} from "./composer-mode"

test("discuss sends the original text with no directive", () => {
  assert.equal(modeDirective("discuss"), null)
  assert.equal(modeSendsMessage("discuss"), true)
})

test("propose carries the exact directive and still sends", () => {
  assert.equal(
    modeDirective("propose"),
    "[[mode:propose]] 请给出至少两个选项、取舍、风险与建议；不要直接执行。",
  )
  assert.equal(modeSendsMessage("propose"), true)
})

test("delegate and resolve do not send", () => {
  assert.equal(modeDirective("delegate"), null)
  assert.equal(modeDirective("resolve"), null)
  assert.equal(modeSendsMessage("delegate"), false)
  assert.equal(modeSendsMessage("resolve"), false)
})

test("availability disables delegate and resolve without a target", () => {
  assert.deepEqual(modeAvailability({ canDelegate: false, canResolve: false }), {
    discuss: true,
    propose: true,
    delegate: false,
    resolve: false,
  })
  assert.deepEqual(modeAvailability({ canDelegate: true, canResolve: true }), {
    discuss: true,
    propose: true,
    delegate: true,
    resolve: true,
  })
})

test("mode action labels are stable", () => {
  assert.deepEqual(CHAT_MODE_ITEMS.map((item) => item.id), [
    "discuss",
    "propose",
    "delegate",
    "resolve",
  ])
  assert.deepEqual(CHAT_MODE_ITEMS.map((item) => item.label), [
    "讨论",
    "提议",
    "委托",
    "解决",
  ])
  assert.equal(modeActionLabel("discuss"), "发送")
  assert.equal(modeActionLabel("propose"), "提议")
  assert.equal(modeActionLabel("delegate"), "委托")
  assert.equal(modeActionLabel("resolve"), "去处理")
})
