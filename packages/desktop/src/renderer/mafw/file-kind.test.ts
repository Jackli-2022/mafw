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

describe("pdf / table（2026-10-27 增补）", () => {
  test("pdf 分类 + 进浏览器 surface", () => {
    assert.equal(fileKindFor("doc.pdf"), "pdf")
    assert.equal(fileKindFor("Docs/A.PDF"), "pdf")
    assert.equal(fileOpenPlan("doc.pdf"), "browser")
  })
  test("csv/tsv 分类为 table（文件 surface 表格预览）", () => {
    assert.equal(fileKindFor("data.csv"), "table")
    assert.equal(fileKindFor("DATA.TSV"), "table")
    assert.equal(fileOpenPlan("data.csv"), "editor")
    assert.equal(fileOpenPlan("data.tsv"), "editor")
  })
})

describe("markdown（2026-10-27 增补）", () => {
  test("md/markdown → markdown 种类，仍进文件 surface", () => {
    assert.equal(fileKindFor("README.md"), "markdown")
    assert.equal(fileKindFor("docs/Guide.MARKDOWN"), "markdown")
    assert.equal(fileKindFor("a.mdx"), "text")
    assert.equal(fileOpenPlan("README.md"), "editor")
  })
})

describe("json（2026-10-27 增补）", () => {
  test("json → json 种类，仍进文件 surface", () => {
    assert.equal(fileKindFor("data.json"), "json")
    assert.equal(fileKindFor("Config.JSON"), "json")
    assert.equal(fileOpenPlan("data.json"), "editor")
    assert.equal(fileKindFor("data.jsonc"), "text")
  })
})
