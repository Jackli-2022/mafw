import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { IMAGE_EXTS, fileKindFor, fileOpenPlan } from "./file-kind"

describe("fileKindFor（扩展名 → 文件种类，大小写不敏感、只看 basename）", () => {
  test("八种图片扩展全部识别", () => {
    for (const ext of IMAGE_EXTS) {
      assert.equal(fileKindFor(`a.${ext}`), "image", ext)
    }
  })
  test("大小写不敏感 + 目录前缀不影响", () => {
    assert.equal(fileKindFor("assets/IMG/A.PNG"), "image")
    assert.equal(fileKindFor("deep\\nested\\Photo.JpEg"), "image")
  })
  test("svg 独立分类（文本+图混合体）", () => {
    assert.equal(fileKindFor("logo.svg"), "svg")
    assert.equal(fileKindFor("icons/Logo.SVG"), "svg")
  })
  test("html/htm 分类", () => {
    assert.equal(fileKindFor("index.html"), "html")
    assert.equal(fileKindFor("page.HTM"), "html")
  })
  test("无扩展名 / 点文件 / 普通文本 → text", () => {
    assert.equal(fileKindFor("README"), "text")
    assert.equal(fileKindFor(".env"), "text")
    assert.equal(fileKindFor("src/main.ts"), "text")
    assert.equal(fileKindFor("a.png.bak"), "text")
  })
})

describe("fileOpenPlan（点击分流：html 进浏览器，其余进文件 surface）", () => {
  test("html/htm → browser", () => {
    assert.equal(fileOpenPlan("index.html"), "browser")
    assert.equal(fileOpenPlan("docs/page.HTM"), "browser")
  })
  test("图片/svg/文本 → editor（编辑器内部再按 kind 渲）", () => {
    assert.equal(fileOpenPlan("a.png"), "editor")
    assert.equal(fileOpenPlan("logo.svg"), "editor")
    assert.equal(fileOpenPlan("src/main.ts"), "editor")
    assert.equal(fileOpenPlan("README"), "editor")
  })
})
