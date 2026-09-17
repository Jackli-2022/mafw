/**
 * P1 契约漂移防线（SDK 侧）：client.ts / sse.ts 里每一个对 gateway 的调用
 * （this.request / fetch / fetchImpl / EventSource / URL-helper 模板串）
 * 的 (method, path) 必须存在于 contract/openapi.json。
 *
 * 用法：bun test src/contract.test.ts
 * 新增 SDK 方法前先在 contract 里登记 operation，否则本测试红。
 */
import { test, expect } from "bun:test"
import { readFileSync } from "node:fs"

const contract = JSON.parse(readFileSync(new URL("../contract/openapi.json", import.meta.url), "utf-8"))

const METHODS = ["get", "post", "put", "patch", "delete"] as const

/** contract 路径 → 归一化（{param} → {}）。 */
function norm(p: string): string {
  return p.replace(/\{[^}]+\}/g, "{}")
}

function contractOps(): Map<string, string[]> {
  const map = new Map<string, string[]>() // normPath → methods[]
  for (const [path, methods] of Object.entries<any>(contract.paths)) {
    for (const m of Object.keys(methods)) {
      if ((METHODS as readonly string[]).includes(m)) {
        const key = norm(path)
        map.set(key, [...(map.get(key) || []), m.toUpperCase()])
      }
    }
  }
  return map
}

/**
 * 模板串内容 → 归一化路径。
 * - 剥离 `${this.baseUrl}`/`${baseUrl}` 前缀
 * - `${...}` 洞 → {}（结尾洞若为 query 变量/含 ? 则剥掉）
 * - 在第一个字面 `?` 处截断 query
 */
function templateToPath(raw: string): string | null {
  let s = raw
  const prefix = s.match(/^\$\{[^{}]*\}(\/.*)$/s)
  if (prefix) s = prefix[1]
  if (!s.startsWith("/")) return null

  let out = ""
  let i = 0
  let lastHoleTrailing = false
  let lastHoleExpr = ""
  while (i < s.length) {
    if (s[i] === "$" && s[i + 1] === "{") {
      let depth = 1
      let j = i + 2
      while (j < s.length && depth > 0) {
        if (s[j] === "{") depth++
        else if (s[j] === "}") depth--
        j++
      }
      lastHoleExpr = s.slice(i + 2, j - 1)
      lastHoleTrailing = j >= s.length
      out += "{}"
      i = j
    } else {
      out += s[i]
      i++
    }
  }
  // 结尾洞是纯 query 变量（/api/usage${qs}）→ 剥掉；是路径段（.../${id}）→ 保留 {}
  if (lastHoleTrailing) {
    const isQueryVar = /\?/.test(lastHoleExpr) || /^(qs|query|q|searchParams|queryString|params)\s*$/.test(lastHoleExpr.trim())
    // 前提：out 里还没有字面 ?（有 ? 的场景由下面截断处理）
    if (isQueryVar && !out.includes("?") && out.endsWith("{}")) out = out.slice(0, -2)
  }
  const q = out.indexOf("?")
  if (q >= 0) out = out.slice(0, q)
  return out
}

/** 定位字符串字面量的结束位置（起始索引指向引号）。 */
function findStringEnd(src: string, start: number, quote: string): number {
  let i = start + 1
  while (i < src.length) {
    if (src[i] === "\\") { i += 2; continue }
    if (src[i] === quote) return i
    i++
  }
  return src.length
}

function detectMethod(src: string, callOpen: number): string {
  // 从调用 "(" 起做平衡括号扫描（跳过字符串字面量），method 只在当前调用表达式内找
  let depth = 0
  let i = callOpen
  let inStr: string | null = null
  for (; i < src.length; i++) {
    const c = src[i]
    if (inStr) {
      if (c === "\\") { i++; continue }
      if (c === inStr) inStr = null
      continue
    }
    if (c === "'" || c === '"' || c === "`") { inStr = c; continue }
    if (c === "(") depth++
    else if (c === ")") {
      depth--
      if (depth === 0) break
    }
  }
  const m = src.slice(callOpen, i + 1).match(/method:\s*["'](\w+)["']/)
  return m ? m[1].toUpperCase() : "GET"
}

interface SdkCall { file: string; line: number; method: string; path: string }

/** 扫描 client.ts / sse.ts 全部对 gateway 的调用。 */
function extractCalls(fileName: string, src: string): SdkCall[] {
  const calls: SdkCall[] = []
  const lineAt = (idx: number) => src.slice(0, idx).split("\n").length

  // pass 1: this.request(...)（可带泛型 <T>，泛型内可能含括号）
  const reqRe = /this\.request\b/g
  let m: RegExpExecArray | null
  while ((m = reqRe.exec(src))) {
    let i = m.index + m[0].length
    if (src[i] === "<") {
      let d = 1
      i++
      while (i < src.length && d > 0) {
        if (src[i] === "<") d++
        else if (src[i] === ">") d--
        i++
      }
    }
    while (/\s/.test(src[i] || "")) i++
    if (src[i] !== "(") continue
    i++
    while (/\s/.test(src[i] || "")) i++
    const q = src[i]
    if (q === "'" || q === '"' || q === "`") {
      const end = findStringEnd(src, i, q)
      const path = templateToPath(q === "`" ? src.slice(i + 1, end) : src.slice(i + 1, end))
      if (path) calls.push({ file: fileName, line: lineAt(m.index), method: detectMethod(src, i - 1), path })
      reqRe.lastIndex = end
    }
  }

  // pass 2: fetch / fetchImpl / new EventSource（模板串首参）
  const fetchRe = /(?:this\.fetchImpl|new\s+EventSource|(?<![.\w])fetch)\(\s*`/g
  while ((m = fetchRe.exec(src))) {
    const start = m.index + m[0].length - 1
    const end = findStringEnd(src, start, "`")
    const path = templateToPath(src.slice(start + 1, end))
    const callOpen = m.index + m[0].indexOf("(")
    if (path) calls.push({ file: fileName, line: lineAt(m.index), method: m[0].includes("EventSource") ? "GET" : detectMethod(src, callOpen), path })
    fetchRe.lastIndex = end
  }

  // pass 3: URL-helper 模板串（return `${this.baseUrl}/...`）——契约归 SDK 的 helper 出口
  const urlRe = /`\$\{(?:this\.)?baseUrl\}(\/[^`]*)`/g
  while ((m = urlRe.exec(src))) {
    const path = templateToPath(m[0].slice(1, -1))
    if (path && !calls.some(c => c.path === path)) {
      calls.push({ file: fileName, line: lineAt(m.index), method: "GET", path })
    }
  }
  return calls
}

const clientSrc = readFileSync(new URL("./client.ts", import.meta.url), "utf-8")
const sseSrc = readFileSync(new URL("./sse.ts", import.meta.url), "utf-8")
const calls = [...extractCalls("client.ts", clientSrc), ...extractCalls("sse.ts", sseSrc)]

test("contract ops ⊆ SDK 调用面（无死契约）", () => {
  const used = new Set(calls.map(c => `${c.method} ${c.path}`))
  const dead: string[] = []
  for (const [path, methods] of contractOps()) {
    for (const method of methods) {
      if (!used.has(`${method} ${path}`)) dead.push(`${method} ${path}`)
    }
  }
  expect(dead).toEqual([])
})

test("SDK 调用 ⊆ contract（无漂移）", () => {
  const ops = contractOps()
  const drift: string[] = []
  for (const c of calls) {
    const methods = ops.get(c.path)
    if (!methods) { drift.push(`${c.file}:${c.line} ${c.method} ${c.path} 不在 contract`); continue }
    if (!methods.includes(c.method)) {
      drift.push(`${c.file}:${c.line} ${c.method} ${c.path} contract 只声明了 ${methods.join("/")}`)
    }
  }
  expect(drift).toEqual([])
})

test("关键回归路径在契约内（本次两个漂移 bug）", () => {
  const ops = contractOps()
  expect(ops.has("/api/triage/{}/dismiss")).toBe(true)
  expect(ops.get("/api/triage/{}/dismiss")).toContain("POST")
  expect(ops.has("/api/goals/control")).toBe(true)
  expect(ops.get("/api/goals/control")).toContain("POST")
})

test("URL-helper 契约出口齐全（P2 收敛点）", () => {
  const paths = new Set(calls.map(c => c.path))
  expect(paths.has("/api/events")).toBe(true)
  expect(paths.has("/api/tts/stream")).toBe(true)
  expect(paths.has("/a2a/artifacts/{}")).toBe(true)
  expect(paths.has("/api/media/upload")).toBe(true)
  expect(paths.has("/api/media/upload-and-create")).toBe(true)
  expect(paths.has("/api/goals/{}/questions/{}/respond")).toBe(true)
})
