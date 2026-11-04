// mafw.css 编码契约（2026-11-04）：文件必须是干净 UTF-8。
// 历史编辑事故把部分中文注释写成了 GBK 字节 / U+FFFD，读起来是乱码；
// 这里钉死替换字符零出现，防止再次混入不可读注释。
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

test("mafw.css contains no U+FFFD replacement characters", () => {
  const css = readFileSync(new URL("./mafw.css", import.meta.url), "utf8")
  const badLines = css
    .split("\n")
    .map((line, index) => ({ line, number: index + 1 }))
    .filter(({ line }) => line.includes("\uFFFD"))
    .map(({ number }) => number)
  assert.deepEqual(badLines, [], `mafw.css has U+FFFD on lines: ${badLines.join(", ")}`)
})

test("mafw.css comments contain no common GBK mojibake characters", () => {
  const css = readFileSync(new URL("./mafw.css", import.meta.url), "utf8")
  const comments = [...css.matchAll(/\/\*[\s\S]*?\*\//g)].map((match) => match[0]).join("\n")
  const mojibake = comments.match(/[锛浣鐨鏂鍦鐢浜鏄涓绋鍜妯鍥鏃绛]/g) ?? []
  assert.deepEqual([...new Set(mojibake)], [], `mafw.css comments contain GBK mojibake: ${[...new Set(mojibake)].join("")}`)
})
