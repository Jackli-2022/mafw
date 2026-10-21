import { describe, test, expect } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const css = readFileSync(join(import.meta.dirname, "mafw.css"), "utf8")

function cssBlock(selector: string): string {
  const start = css.indexOf(selector)
  if (start === -1) return ""
  const open = css.indexOf("{", start)
  let depth = 1
  let i = open + 1
  while (i < css.length && depth > 0) {
    if (css[i] === "{") depth++
    if (css[i] === "}") depth--
    i++
  }
  return css.slice(open + 1, i - 1)
}

const dark = cssBlock(".mafw-shell, body {")
const light = cssBlock('html[data-theme="light"] .mafw-shell,')
const sysLight = cssBlock("html:not([data-theme]) .mafw-shell,")

// Shiki OpenCode 主题（packages/ui/src/context/marked.tsx）消费的全部语法 token。
// 上游 ui/theme.css 只在 :root 定义它们且暗色值由 OS 级 media 门控——不响应 app 主题切换；
// 且 :root 上的 var() 别名在定义处即冻结，shell 覆盖无法生效（「白主题黑底代码块」根因）。
// 因此 mafw 每个主题块必须就地定义全套语法色 + 重声明 --color-background-stronger 别名。
const SYNTAX_TOKENS = [
  "--syntax-comment", "--syntax-regexp", "--syntax-string", "--syntax-keyword",
  "--syntax-primitive", "--syntax-operator", "--syntax-variable", "--syntax-property",
  "--syntax-type", "--syntax-constant", "--syntax-punctuation", "--syntax-object",
  "--syntax-success", "--syntax-warning", "--syntax-critical", "--syntax-info",
  "--syntax-diff-add", "--syntax-diff-delete", "--syntax-diff-unknown", "--syntax-unknown",
]

describe("代码块主题 — 语法色 token 三主题块齐备", () => {
  describe("暗色默认块", () => {
    test.each(SYNTAX_TOKENS)("定义 %s", (t) => expect(dark).toContain(`${t}:`))
  })
  describe("亮色手动块", () => {
    test.each(SYNTAX_TOKENS)("定义 %s", (t) => expect(light).toContain(`${t}:`))
  })
  describe("亮色跟随系统块", () => {
    test.each(SYNTAX_TOKENS)("定义 %s", (t) => expect(sysLight).toContain(`${t}:`))
  })
})

describe("代码块主题 — 背景别名就地重解析", () => {
  // tailwind/colors.css 在 :root 声明 --color-background-stronger: var(--background-stronger)，
  // var() 在 :root 即冻结成 :root 值（OS 暗色时为 #151515），shell 覆盖 --background-stronger 无效。
  // 每个主题块必须重声明别名，使其在 shell 作用域重新解析。
  for (const [name, block] of [["暗色", dark], ["亮色手动", light], ["亮色系统", sysLight]] as const) {
    test(`${name}块重声明 --color-background-stronger`, () => {
      expect(block).toContain("--color-background-stronger: var(--background-stronger)")
    })
  }
})

describe("代码块主题 — 色板方向钉扎（亮暗不串色）", () => {
  test("暗色块语法色取上游暗色板（string #00ceb9）", () => {
    expect(dark).toContain("--syntax-string: #00ceb9")
  })
  test("亮色手动块取上游亮色板（string #006656）", () => {
    expect(light).toContain("--syntax-string: #006656")
  })
  test("亮色系统块取上游亮色板（string #006656）", () => {
    expect(sysLight).toContain("--syntax-string: #006656")
  })
  test("暗色块 diff 增删色取暗色板", () => {
    expect(dark).toContain("--syntax-diff-add: #9bcd97")
    expect(dark).toContain("--syntax-diff-delete: #faa494")
  })
  test("亮色手动块 diff 增删色取亮色板", () => {
    expect(light).toContain("--syntax-diff-add: #3a8437")
    expect(light).toContain("--syntax-diff-delete: #ca2d17")
  })
})
