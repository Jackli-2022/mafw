import { describe, expect, test } from "bun:test"
import { readFileSync, readdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import type { MafwPart } from "@mafw/sdk"
import { displayToolOf } from "./parts-rules"

/**
 * session-ui 中立性守卫（spec 2026-11-02 §8.1 / §11）。
 *
 * session-ui 是前端公共渲染层：只消费 MAFW View DTO，不得 import runtime SDK，
 * 也不得读取 runtime wire 形状（`{info, parts}` 历史信封、`info?` 事件载荷、
 * `parts ?? content` 双形状兜底）。渲染组件只读规范形，多形状读取收敛到
 * 客户端摄取层（file-diff-shape / tool-output / task-session）。
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = join(HERE, "..")
const PACKAGE_JSON = join(HERE, "..", "..", "package.json")

const SDK_PACKAGE = ["@opencode-ai", "sdk"].join("/")

/** runtime wire 读取形态（正则文本本身不会命中自己：判别符被拆开拼接）。 */
const OLD_WIRE_PATTERNS = [
  new RegExp(`${["item", "info"].join("\\.")}`),
  new RegExp(`${["info", "\\?\\."].join("")}`),
  new RegExp(`${["\\.parts", "\\s*\\?\\?"].join("")}`),
]

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      walk(path, out)
      continue
    }
    if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) out.push(path)
  }
  return out
}

const files = walk(SRC)

function hits(pattern: RegExp) {
  return files
    .map((file) => ({ file: file.slice(SRC.length + 1), pattern }))
    .flatMap(({ file }) =>
      readFileSync(join(SRC, file), "utf8")
        .split(/\r?\n/)
        .map((line, index) => ({ file, line: index + 1, text: line }))
        .filter((entry) => pattern.test(entry.text))
        .map((entry) => `${entry.file}:${entry.line}: ${entry.text.trim()}`),
    )
}

describe("session-ui view DTO neutrality", () => {
  test("has no runtime SDK dependency", () => {
    expect(files.length).toBeGreaterThan(0)
    expect(hits(new RegExp(SDK_PACKAGE.replace(/[/\\]/g, "\\$&")))).toEqual([])

    const pkg = JSON.parse(readFileSync(PACKAGE_JSON, "utf8")) as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
      peerDependencies?: Record<string, string>
    }
    const declared = {
      ...pkg.dependencies,
      ...pkg.devDependencies,
      ...pkg.peerDependencies,
    }
    expect(Object.keys(declared)).not.toContain(SDK_PACKAGE)
    // View DTO 来源必须是共享契约包，而不是就地复制同名字符串类型
    expect(Object.keys(declared)).toContain("@mafw/sdk")
  })

  test("reads no old runtime wire fields", () => {
    for (const pattern of OLD_WIRE_PATTERNS) {
      expect(hits(pattern)).toEqual([])
    }
  })

  test("tool part reads canonical identity fields", () => {
    const part = toolPart({ tool: "shell", toolClass: "shell", canonicalTool: "bash" })
    expect(displayToolOf(part)).toBe("bash")
    expect(displayToolOf(toolPart({ tool: "bash" }))).toBe("bash")
    expect(displayToolOf(toolPart({ tool: "Read", canonicalTool: "read" }))).toBe("read")
  })
})

function toolPart(identity: { tool: string; toolClass?: string; canonicalTool?: string }): MafwPart {
  return {
    id: "part_1",
    sessionID: "ses_1",
    messageID: "msg_1",
    type: "tool",
    callID: "call_1",
    tool: identity.tool,
    ...(identity.toolClass ? { toolClass: identity.toolClass } : {}),
    ...(identity.canonicalTool ? { canonicalTool: identity.canonicalTool } : {}),
    state: { status: "completed", input: {}, output: "" },
  } as MafwPart
}
