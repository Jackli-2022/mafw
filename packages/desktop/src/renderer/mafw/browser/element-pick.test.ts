import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { buildPickScript } from "./element-pick"

describe("element pick script", () => {
  const script = buildPickScript()

  test("自包含：高亮样式 + 事件 + Promise 返回", () => {
    assert.ok(script.includes("mafw-pick-highlight"))
    assert.ok(script.includes("addEventListener(\"mousemove\""))
    assert.ok(script.includes("addEventListener(\"click\""))
    assert.ok(script.includes("addEventListener(\"keydown\""))
    assert.ok(script.includes("return new Promise"))
    assert.ok(script.includes("preventDefault"))
  })

  test("字段：selector / rect / outerHTML / attrs / 截断", () => {
    assert.ok(script.includes("getBoundingClientRect"))
    assert.ok(script.includes("selectorOf"))
    assert.ok(script.includes("outerHTML"))
    assert.ok(script.includes("attrsOf"))
    assert.ok(script.includes("slice(0, 200)"))
    assert.ok(script.includes("slice(0, 500)"))
  })

  test("Esc 取消 + 清理监听", () => {
    assert.ok(script.includes("Escape"))
    assert.ok(script.includes("removeEventListener"))
  })

  test("脚本可被解析（语法有效）", () => {
    assert.doesNotThrow(() => new Function(`return ${script}`))
  })
})
