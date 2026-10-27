import { describe, test } from "node:test"
import assert from "node:assert/strict"
import {
  MAFW_FILE_SCHEME,
  buildMafwFileUrl,
  mimeForPath,
  parseMafwFileUrl,
} from "../src/shared/mafw-file"

describe("buildMafwFileUrl / parseMafwFileUrl", () => {
  test("往返：普通相对路径", () => {
    const u = buildMafwFileUrl("ab12cd34", "assets/img/logo.png")
    assert.equal(u, "mafw-file://ab12cd34/assets/img/logo.png")
    assert.deepEqual(parseMafwFileUrl(u), { token: "ab12cd34", rel: "assets/img/logo.png" })
  })
  test("往返：空格/中文/#/? 等特殊字符按段编码", () => {
    const rel = "素材/我的 图 #1?.png"
    const u = buildMafwFileUrl("ab12cd34", rel)
    assert.ok(!u.includes("#") && !u.includes("?"), u)
    assert.deepEqual(parseMafwFileUrl(u), { token: "ab12cd34", rel })
  })
  test("Windows 反斜杠输入统一成 /", () => {
    const u = buildMafwFileUrl("ab12cd34", "assets\\a.png")
    assert.deepEqual(parseMafwFileUrl(u), { token: "ab12cd34", rel: "assets/a.png" })
  })
  test("版本参数（图片刷新）不影响解析", () => {
    const u = buildMafwFileUrl("ab12cd34", "a.png", 1730000000000)
    assert.equal(u, "mafw-file://ab12cd34/a.png?v=1730000000000")
    assert.deepEqual(parseMafwFileUrl(u), { token: "ab12cd34", rel: "a.png" })
  })
  test("拒绝：其他 scheme / 坏 URL / 无 token", () => {
    assert.equal(parseMafwFileUrl("https://example.com/a.png"), null)
    assert.equal(parseMafwFileUrl("file:///C:/a.png"), null)
    assert.equal(parseMafwFileUrl("not a url"), null)
    assert.equal(parseMafwFileUrl("mafw-file:///a.png"), null)
  })
  test("拒绝：traversal（原样与编码）", () => {
    assert.equal(parseMafwFileUrl("mafw-file://ab12cd34/../secret.png"), null)
    assert.equal(parseMafwFileUrl("mafw-file://ab12cd34/%2e%2e/secret.png"), null)
    assert.equal(parseMafwFileUrl("mafw-file://ab12cd34/a/%2E%2E/b.png"), null)
    assert.equal(parseMafwFileUrl("mafw-file://ab12cd34/a/..\\b.png"), null)
  })
  test("拒绝：绝对路径 / 驱动器号 / 空段", () => {
    assert.equal(parseMafwFileUrl("mafw-file://ab12cd34//abs.png"), null)
    assert.equal(parseMafwFileUrl("mafw-file://ab12cd34/C:/Windows/win.ini"), null)
  })
})

describe("mimeForPath", () => {
  test("图片八型", () => {
    assert.equal(mimeForPath("a.png"), "image/png")
    assert.equal(mimeForPath("a.jpg"), "image/jpeg")
    assert.equal(mimeForPath("a.jpeg"), "image/jpeg")
    assert.equal(mimeForPath("a.gif"), "image/gif")
    assert.equal(mimeForPath("a.webp"), "image/webp")
    assert.equal(mimeForPath("a.ico"), "image/x-icon")
    assert.equal(mimeForPath("a.bmp"), "image/bmp")
    assert.equal(mimeForPath("a.avif"), "image/avif")
  })
  test("svg / html / 子资源常见型", () => {
    assert.equal(mimeForPath("logo.svg"), "image/svg+xml")
    assert.equal(mimeForPath("index.html"), "text/html; charset=utf-8")
    assert.equal(mimeForPath("page.htm"), "text/html; charset=utf-8")
    assert.equal(mimeForPath("app.css"), "text/css; charset=utf-8")
    assert.equal(mimeForPath("app.js"), "text/javascript; charset=utf-8")
    assert.equal(mimeForPath("data.json"), "application/json; charset=utf-8")
    assert.equal(mimeForPath("font.woff2"), "font/woff2")
    assert.equal(mimeForPath("clip.mp4"), "video/mp4")
  })
  test("大小写不敏感；未知 → octet-stream", () => {
    assert.equal(mimeForPath("A.PNG"), "image/png")
    assert.equal(mimeForPath("archive.zip"), "application/octet-stream")
    assert.equal(mimeForPath("README"), "application/octet-stream")
  })
})

describe("MAFW_FILE_SCHEME", () => {
  test("scheme 常量与 URL 前缀一致", () => {
    assert.equal(MAFW_FILE_SCHEME, "mafw-file")
    assert.ok(buildMafwFileUrl("ab12cd34", "a.png").startsWith("mafw-file://"))
  })
})
