import { describe, expect, test } from "bun:test"
import { readFileSync, readdirSync } from "node:fs"
import { dirname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"

/**
 * session-ui 架构守卫（spec 2026-11-02 §8.1 / §11）。
 *
 * 与 `components/view-dto.test.ts` 互补：那个文件钉「渲染层只读 View DTO」的字段面，
 * 这里钉**依赖方向与全域边界**——
 *   - 不 import runtime SDK，也不出现 runtime 名称/裸能力位；
 *   - 不读事件载荷 wire 形状（`properties.info`）；
 *   - 渲染入口只接收 `Mafw*` 类型（不接收 runtime 私有类型）；
 *   - 例外清单必须为空（session-ui 没有任何 Diagnostics/Admin 面）。
 *
 * 反向 fixture 证明扫描器不是恒绿。
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = HERE
const PACKAGE_ROOT = join(HERE, "..")

interface Rule {
  name: string
  pattern: RegExp
}

const RULES: Rule[] = [
  {
    name: "runtime-caps",
    pattern: /\bruntimeCaps\b|\brtCaps\b|\bworktreeApi\b|\bdiffApi\b|\bsteerApi\b|\brunStateApi\b|\bcheckpointApi\b|\bsessionBranchApi\b|\bmcpConfigApi\b|\binstructionsApi\b|\bdiscoveryApi\b/,
  },
  { name: "runtime-name", pattern: /\bruntimeName\b|\brtName\b|\bactive\.name\b/ },
  { name: "wire-shape", pattern: /\.info\s*\?\?|\bitem\.info\b|\b(?:m|msg|message|row|entry)\.parts\s*\?\?|properties\?*\.info\b/ },
  { name: "sdk-import", pattern: /@opencode-ai\/sdk/ },
]

function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\s\/\/[^\n]*$/gm, "")
}

export function scanSessionUiSource(text: string, rules: Rule[] = RULES): string[] {
  const code = stripComments(text)
  return rules.filter((rule) => rule.pattern.test(code)).map((rule) => rule.name)
}

/** 反向 fixture 入口（spec §11）。 */
export function scanSessionUiFixture(text: string): string[] {
  return scanSessionUiSource(text)
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      walk(full, out)
      continue
    }
    if (/\.(ts|tsx)$/.test(entry.name)) out.push(full)
  }
  return out
}

// 只排除测试文件（它们本身就是反向 fixture）；**stories 也在扫描面内**——
// 演示组件同样应只消费 View DTO，发现旧格式应改写 fixture，而不是加豁免。
const SOURCE_FILES = walk(SRC).filter((file) => !/\.test\.(ts|tsx)$/.test(file))

describe("session-ui architecture: View DTO only", () => {
  test("scanner catches synthetic violations (reverse fixtures)", () => {
    expect(scanSessionUiFixture("const caps = props.runtimeCaps.diffApi;")).toContain("runtime-caps")
    expect(scanSessionUiFixture('if (runtimeName === "pi") {}')).toContain("runtime-name")
    expect(scanSessionUiFixture("const m = item.info ?? item;")).toContain("wire-shape")
    expect(scanSessionUiFixture("const sid = event.properties.info.sessionID;")).toContain("wire-shape")
    expect(scanSessionUiFixture('import { x } from "@opencode-ai/sdk";')).toContain("sdk-import")
    // 合法的 DTO/Experience 面不得误报；注释术语也不算。
    expect(scanSessionUiFixture("const part: MafwPart = view();")).toEqual([])
    expect(scanSessionUiFixture("// 不再读 properties.info\nconst ok = 1;")).toEqual([])
  })

  test("full source tree has no runtime identity, capabilities, wire shapes or runtime SDK", () => {
    expect(SOURCE_FILES.length).toBeGreaterThan(80)
    const found: string[] = []
    for (const file of SOURCE_FILES) {
      const rel = relative(PACKAGE_ROOT, file).replace(/\\/g, "/")
      for (const rule of scanSessionUiSource(readFileSync(file, "utf8"))) found.push(`${rel}: ${rule}`)
    }
    expect(found).toEqual([])
  })

  test("no exception list: session-ui has no diagnostics surface", () => {
    // 例外清单为空是设计约束（Diagnostics/Admin 在 desktop/gateway，不在渲染层）。
    // 这里用「出现任何命中即失败」的等价断言把约束写死：上面 full-tree 扫描已为 []。
    const whitelisted = SOURCE_FILES.filter((file) => /pages\/|admin|diagnostics/i.test(relative(SRC, file)))
    expect(whitelisted).toEqual([])
  })

  test("renderers take Mafw* DTO types, not runtime-private shapes", () => {
    const messagePart = readFileSync(join(SRC, "components", "message-part.tsx"), "utf8")
    expect(messagePart).toContain("MafwPart")
    expect(messagePart).toContain("MafwSession")
    const sessionTurn = readFileSync(join(SRC, "components", "session-turn.tsx"), "utf8")
    // 消息类型是 View DTO 的组件侧别名（`UiMessage = MafwMessage & {..}`），不是 runtime 形状。
    expect(sessionTurn).toContain("MafwPart")
    expect(sessionTurn).toContain("UiMessage")
    const context = readFileSync(join(SRC, "context", "data.tsx"), "utf8")
    expect(context).toContain("UiMessage = MafwMessage")
    // 契约包的 View DTO 是唯一类型来源。
    const pkg = JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8")) as Record<string, Record<string, string>>
    const declared = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}), ...(pkg.peerDependencies ?? {}) }
    expect(Object.keys(declared)).toContain("@mafw/sdk")
    expect(Object.keys(declared)).not.toContain("@opencode-ai/sdk")
  })

  test("interactive surfaces gate on the Experience contract, not capability props", () => {
    // session-ui 本身不取 actions（由 desktop/TUI 注入），但也不得出现 capability 门。
    for (const file of ["components/session-turn.tsx", "components/message-part.tsx"]) {
      const text = readFileSync(join(SRC, file), "utf8")
      expect(scanSessionUiSource(text)).toEqual([])
    }
  })
})
