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

/** internal 端点（gateway 内部/dashboard/mobile 用）不被 @mafw/sdk 调用，豁免死契约检查。
 *  豁免粒度是 **(method, path)**：同一路径上的 internal GET 不得连带豁免 SDK-facing 的
 *  PUT/DELETE（`/api/automations/:id` 就是这种混排路径）。 */
function isInternalOp(path: string, method: string): boolean {
  const op = (contract.paths[path] as any)?.[method] as any
  return Array.isArray(op?.tags) && op.tags.includes('internal')
}

/**
 * 运行时透传路径豁免（历史上 `/api/session/:id/background` 曾在此：它直通 v2 runtime、
 * 不在 OpenAPI contract 里）。Task 16 已把该路由登记进 `routes/route-catalog.ts` 并重生成
 * 契约产物，因此豁免表被清空——新增豁免必须显式加回并说明为何不能进 contract。
 */
const RUNTIME_PROXY_EXEMPT = new Set<string>([])

/**
 * DEAD_CONTRACT_TODO —— 已知"gateway 有 op、SDK 无调用方"的契约缺口，**故意**留红转黄。
 *
 * 来源：commit `163b2001`（review-items 门禁）往 `route-catalog.ts` 加了 4 条 SDK-facing
 * op（`pods.goals.reviewItems*`，`tags:['pods']`）却没重跑契约产物。本波重生成产物后
 * 它们在死契约检查里显形：`packages/gateway-sdk/src/client.ts` 没有 review-items 方法，
 * desktop/session-ui 也无消费方。
 *
 * 为什么不在本波补：review-items 的 SDK client + DTO 归 review-items 波次所有。只补一个
 * 无类型、无响应模型的裸 client 方法会让本测试变成假绿（调用面存在 ≠ 契约可用）；
 * 把它们 retag 成 `internal` 则是撒谎（desktop 的 review-items 面板将来要走 SDK）。
 * 因此这里显式记账，并由下面那条 stale-entry 守卫保证豁免不会无限期滞留：
 * 某条 op 从 contract 消失（改名/降级/删除）时，这里必须同步删除。
 */
const DEAD_CONTRACT_TODO = new Set<string>([
  "GET /api/pods/{}/goals/{}/review-items",
  "POST /api/pods/{}/goals/{}/review-items",
  "POST /api/pods/{}/goals/{}/review-items/{}/resolve",
  "POST /api/pods/{}/goals/{}/review-items/{}/reopen",
])

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

  // pass 1: this.request / this.fetchPath / client.fetchPath（可带泛型 <T>，泛型内可能含括号；
  // `client` 是 speakStream 闭包里的 `const client = this` 捕获）
  const reqRe = /(?:this|client)\.(?:request|fetchPath)\b/g
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

test("contract ops ⊆ SDK 调用面（无死契约；internal 标签豁免）", () => {
  const used = new Set(calls.map(c => `${c.method} ${c.path}`))
  const dead: string[] = []
  for (const [rawPath, methods] of Object.entries<any>(contract.paths)) {
    for (const m of Object.keys(methods)) {
      if (!(METHODS as readonly string[]).includes(m)) continue
      if (isInternalOp(rawPath, m)) continue
      const key = `${m.toUpperCase()} ${norm(rawPath)}`
      if (used.has(key)) continue
      if (DEAD_CONTRACT_TODO.has(key)) continue
      dead.push(key)
    }
  }
  expect(dead).toEqual([])
})

test("DEAD_CONTRACT_TODO 无陈旧条目（每个豁免仍是 contract 里的真实 op）", () => {
  const ops = new Set<string>()
  for (const [rawPath, methods] of Object.entries<any>(contract.paths)) {
    for (const m of Object.keys(methods)) {
      if (!(METHODS as readonly string[]).includes(m)) continue
      ops.add(`${m.toUpperCase()} ${norm(rawPath)}`)
    }
  }
  const stale = [...DEAD_CONTRACT_TODO].filter(key => !ops.has(key))
  expect(stale).toEqual([])
})

test("SDK 调用 ⊆ contract（无漂移）", () => {
  const ops = contractOps()
  const drift: string[] = []
  for (const c of calls) {
    if (RUNTIME_PROXY_EXEMPT.has(c.path)) continue
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
