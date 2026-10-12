# Desktop 主题系统结构收敛 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** mafw.css 主题 token 从 9 个手写重复块收敛为 3 个合并块（选择器列表覆盖 .mafw-shell + body），主题逻辑抽为可单测模块，补齐悬空 token 别名——全程零视觉变化。

**Architecture:** 选择器合并（每主题态一块，选择器列 `.mafw-shell, body`；picker-pop token 块整体删除——证据：其全部 token 与 body 块同值重复）；主题逻辑抽 `src/renderer/mafw/theme.ts`；契约测试从「钉存在性」升级为「选择器覆盖 + 键集一致 + 悬空引用扫描」。

**Tech Stack:** Electron + SolidJS + bun test（CSS 契约测试为纯文本解析，无 DOM）。

**Spec:** `docs/superpowers/specs/2026-10-12-desktop-theme-consolidation-design.md`

## Global Constraints

- **零视觉变化**：不改任何颜色值/尺寸/排版；别名值一律等于现行 fallback 生效值。
- 测试命令：`cd packages/desktop && bun test`（单文件 `bun test <path>`）；构建 `npx electron-vite build`。
- 代码块主题令牌（`--syntax-*` / `--color-background-stronger`，2026-10-12 修复引入）在合并中必须保留进合并块。
- 合并选择器的**精确文本**（测试钉扎，不得变体）：
  - 暗色：`.mafw-shell, body {`
  - 亮色手动：`html[data-theme="light"] .mafw-shell,\nhtml[data-theme="light"] body {`
  - 亮色系统：`@media (prefers-color-scheme: light) {` 内 `html:not([data-theme]) .mafw-shell,\n  html:not([data-theme]) body {`

---

### Task 1: theme.ts 主题逻辑模块抽取

**Files:**
- Create: `packages/desktop/src/renderer/mafw/theme.ts`
- Test: `packages/desktop/src/renderer/mafw/theme.test.ts`
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx`（onMount 713-737、toggleTheme 738-747）

**Interfaces:**
- Produces: `export type ThemeChoice = "light" | "dark" | null`；`readSavedTheme(storage: Pick<Storage,"getItem">): ThemeChoice`；`nextTheme(current: "light"|"dark"): "light"|"dark"`；`applyTheme(root: HTMLElement, choice: ThemeChoice, systemLight: boolean): void`。Task 2+ 不依赖本模块。

- [ ] **Step 1: 写失败测试** `packages/desktop/src/renderer/mafw/theme.test.ts`

```ts
import { describe, test, expect } from "bun:test"
import { readSavedTheme, nextTheme, applyTheme } from "./theme"

const fakeStorage = (v: string | null) => ({ getItem: (_k: string) => v })
const fakeRoot = () => {
  const dataset: Record<string, string> = {}
  return { dataset, removed: [] as string[], removeAttribute(k: string) { this.removed.push(k); delete dataset[k.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] } } as unknown as HTMLElement
}

describe("readSavedTheme", () => {
  test("light/dark 原样返回", () => {
    expect(readSavedTheme(fakeStorage("light"))).toBe("light")
    expect(readSavedTheme(fakeStorage("dark"))).toBe("dark")
  })
  test("缺省/非法值 → null（跟随系统）", () => {
    expect(readSavedTheme(fakeStorage(null))).toBeNull()
    expect(readSavedTheme(fakeStorage("oc-2"))).toBeNull()
  })
})

describe("nextTheme", () => {
  test("两态循环", () => {
    expect(nextTheme("light")).toBe("dark")
    expect(nextTheme("dark")).toBe("light")
  })
})

describe("applyTheme", () => {
  test("saved=light：写 data-theme + data-color-scheme", () => {
    const root = fakeRoot()
    applyTheme(root, "light", false)
    expect(root.dataset.theme).toBe("light")
    expect(root.dataset.colorScheme).toBe("light")
  })
  test("saved=dark：写 data-theme + data-color-scheme", () => {
    const root = fakeRoot()
    applyTheme(root, "dark", true)
    expect(root.dataset.theme).toBe("dark")
    expect(root.dataset.colorScheme).toBe("dark")
  })
  test("null + 系统亮：移除 data-theme，colorScheme=light", () => {
    const root = fakeRoot()
    root.dataset.theme = "dark"
    applyTheme(root, null, true)
    expect(root.dataset.theme).toBeUndefined()
    expect(root.dataset.colorScheme).toBe("light")
  })
  test("null + 系统暗：移除 data-theme，colorScheme=dark", () => {
    const root = fakeRoot()
    applyTheme(root, null, false)
    expect(root.dataset.theme).toBeUndefined()
    expect(root.dataset.colorScheme).toBe("dark")
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/desktop && bun test src/renderer/mafw/theme.test.ts`
Expected: FAIL（`./theme` 模块不存在）

- [ ] **Step 3: 实现** `packages/desktop/src/renderer/mafw/theme.ts`

```ts
// 主题状态契约：与 public/oc-theme-preload.js 读写同一 localStorage 键 mafw-theme。
// data-theme = 手动覆盖（light/dark），缺省移除 = 跟随系统（CSS 媒体查询块生效）；
// data-color-scheme 是上游 v2/session-ui 的主题门，始终与生效主题同步双写。
export type ThemeChoice = "light" | "dark" | null

export function readSavedTheme(storage: Pick<Storage, "getItem">): ThemeChoice {
  const v = storage.getItem("mafw-theme")
  return v === "light" || v === "dark" ? v : null
}

export function nextTheme(current: "light" | "dark"): "light" | "dark" {
  return current === "light" ? "dark" : "light"
}

export function applyTheme(root: HTMLElement, choice: ThemeChoice, systemLight: boolean): void {
  const effective = choice ?? (systemLight ? "light" : "dark")
  if (choice) root.dataset.theme = choice
  else root.removeAttribute("data-theme")
  root.dataset.colorScheme = effective
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd packages/desktop && bun test src/renderer/mafw/theme.test.ts`
Expected: 8 pass

- [ ] **Step 5: MafwShell 改薄壳**（`MafwShell.tsx:713-747`）

替换 onMount 与 toggleTheme 为：

```tsx
  // Theme: 逻辑在 ./theme.ts（与 preload 同源的 mafw-theme 键契约见其文件头注释）。
  onMount(() => {
    const root = document.documentElement
    const saved = readSavedTheme(localStorage)
    const mq = window.matchMedia('(prefers-color-scheme: light)')
    applyTheme(root, saved, mq.matches)
    if (saved) setTheme(saved)
    else {
      const onMq = () => {
        const cur = readSavedTheme(localStorage)
        if (cur) return
        root.dataset.colorScheme = mq.matches ? 'light' : 'dark'
      }
      mq.addEventListener('change', onMq)
      onCleanup(() => mq.removeEventListener('change', onMq))
    }
  })
  const toggleTheme = () => {
    const mq = window.matchMedia('(prefers-color-scheme: light)')
    const root = document.documentElement
    const cur = root.dataset.theme === 'light' ? 'light' : root.dataset.theme === 'dark' ? 'dark' : (mq.matches ? 'light' : 'dark')
    const next = nextTheme(cur)
    applyTheme(root, next, mq.matches)
    localStorage.setItem('mafw-theme', next)
    setTheme(next)
  }
```

文件顶部 import 处加 `import { readSavedTheme, nextTheme, applyTheme } from "./theme"`（相对路径按 MafwShell 现有 import 风格）。

- [ ] **Step 6: 全量 desktop 测试 + 提交**

Run: `cd packages/desktop && bun test`
Expected: 全绿（1008 pass：1000 + 8 新）

```bash
git add packages/desktop/src/renderer/mafw/theme.ts packages/desktop/src/renderer/mafw/theme.test.ts packages/desktop/src/renderer/mafw/MafwShell.tsx
git commit -m "refactor(desktop): 主题逻辑抽 theme.ts 纯模块（三态读取/两态循环/applyTheme 四分支）"
```

---

### Task 2: 选择器合并 9→3 + picker-pop token 块删除 + 契约测试迁移

**Files:**
- Create: `packages/desktop/tests/css-helpers.ts`
- Create: `packages/desktop/src/renderer/mafw/theme-merge-css.test.ts`
- Modify: `packages/desktop/src/renderer/mafw/mafw.css`（1-446 主题块区 + 1637-1704 picker-pop token 块）
- Modify: `packages/desktop/tests/design-contract.test.ts`（cssBlock 调用点迁移）
- Modify: `packages/desktop/src/renderer/mafw/code-theme-css.test.ts`（选择器迁移）
- Modify: `packages/desktop/src/renderer/mafw/motion-tokens.test.ts`（第 8 行切片迁移）

**Interfaces:**
- Consumes: Task 1 无交集（并行安全）。
- Produces: `css-helpers.ts` 导出 `readMafwCss(): string`、`ruleWithScope(css, scopeSelector, gate?: "light"|"system-light"|"dark"): string`；合并后三个主题块的精确选择器文本（见 Global Constraints），Task 3/4 的测试复用 `ruleWithScope`。

**背景证据（picker-pop 可删）**：`.mafw-picker-pop` 经 Portal 挂 document.body（`PopoverShell.tsx:153`），其三个 token 块（mafw.css 1637-1704）的全部 token 与 body 镜像块**同值重复**（逐一核对过：bg-float/bg-overlay/border-subtle/shadow-float/text-1..5/accent 族/info/bg-inset/hover）。删除后 picker 从 body 继承同值，零视觉变化。

- [ ] **Step 1: 写共享 helper + 失败测试**

`packages/desktop/tests/css-helpers.ts`：

```ts
import { readFileSync } from "node:fs"
import { join } from "node:path"

export function readMafwCss(): string {
  return readFileSync(join(import.meta.dir, "..", "src", "renderer", "mafw", "mafw.css"), "utf8")
}

/** 提取包含 scopeSelector 且带指定主题门的那条规则的规则体 */
export function ruleWithScope(
  css: string,
  scopeSelector: string,
  gate: "dark" | "light" | "system-light",
): string {
  const gated =
    gate === "light" ? `html[data-theme="light"] ${scopeSelector}`
    : gate === "system-light" ? `html:not([data-theme]) ${scopeSelector}`
    : scopeSelector
  const start = css.indexOf(gated)
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
```

`packages/desktop/src/renderer/mafw/theme-merge-css.test.ts`：

```ts
import { describe, test, expect } from "bun:test"
import { readMafwCss, ruleWithScope } from "../../tests/css-helpers"

const css = readMafwCss()
const dark = ruleWithScope(css, ".mafw-shell", "dark")
const light = ruleWithScope(css, ".mafw-shell", "light")
const sysLight = ruleWithScope(css, ".mafw-shell", "system-light")

describe("主题块合并 — 选择器覆盖 shell + body 双作用域", () => {
  test("暗色默认块", () => expect(css).toContain(".mafw-shell, body {"))
  test("亮色手动块", () => {
    expect(css).toContain('html[data-theme="light"] .mafw-shell,')
    expect(css).toContain('html[data-theme="light"] body {')
  })
  test("亮色跟随系统块", () => {
    expect(css).toContain("html:not([data-theme]) .mafw-shell,")
    expect(css).toContain("html:not([data-theme]) body {")
  })
})

describe("主题块合并 — 三主题态 token 键集一致", () => {
  const keys = (block: string) =>
    [...block.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]).sort()
  test("dark == light == sysLight", () => {
    expect(keys(light)).toEqual(keys(dark))
    expect(keys(sysLight)).toEqual(keys(dark))
  })
})

describe("picker-pop token 块已删除（picker 经 Portal 挂 body，token 从 body 继承同值）", () => {
  test("不存在携带 token 的 .mafw-picker-pop 规则", () => {
    const i = css.indexOf(".mafw-picker-pop {")
    // 1705 起是布局规则（position: fixed 等），不得含 token 定义
    const rule = i === -1 ? "" : css.slice(i, css.indexOf("}", i))
    expect(rule).not.toContain("--bg-float")
    expect(css).not.toContain('html[data-theme="light"] .mafw-picker-pop')
    expect(css).not.toContain("html:not([data-theme]) .mafw-picker-pop")
  })
})

describe("合并块保留代码块主题令牌", () => {
  test("暗色块", () => {
    expect(dark).toContain("--color-background-stronger: var(--background-stronger)")
    expect(dark).toContain("--syntax-string: #00ceb9")
  })
  test("亮色手动块", () => {
    expect(light).toContain("--syntax-string: #006656")
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/desktop && bun test src/renderer/mafw/theme-merge-css.test.ts`
Expected: FAIL（选择器断言找不到合并形态）

- [ ] **Step 3: 执行 mafw.css 合并**

对 mafw.css 做三处编辑（保持 token 声明逐字不变，只改选择器头与删块）：

1. 暗色块（当前 `.mafw-shell {` 开头，第 2 行）：选择器改 `.mafw-shell, body {`。然后把 body 暗色镜像块（原 257-322，`body {` 整规则，含其上方注释块 251-256 更新为指向合并块）删除——删除前逐一核对 body 块每个 token 在 shell 块同值存在（本计划已核对：全部同值；若执行时发现新漂移，以 shell 块为准并在提交信息记录）。
2. 亮色手动块：`html[data-theme="light"] .mafw-shell {` →
   ```
   html[data-theme="light"] .mafw-shell,
   html[data-theme="light"] body {
   ```
   删除 body 亮色手动镜像块（原 324-380）。
3. 亮色系统块：`html:not([data-theme]) .mafw-shell {` →
   ```
   html:not([data-theme]) .mafw-shell,
   html:not([data-theme]) body {
   ```
   删除 body 系统亮镜像块（原 383-413，含 `@media` 包裹层只删内层规则，media 块壳保留给 shell 那条）。
   注意：shell 系统亮块与 body 系统亮块各有一个 `@media (prefers-color-scheme: light)` 包裹；合并后保留 shell 那个 media 块（内含合并规则），删除 body 那个 media 块整体。
4. 删除 picker-pop 三个 token 块（1637-1704：`picker-pop {` 暗 / `html[data-theme="light"] .mafw-picker-pop {` / `@media light { html:not([data-theme]) .mafw-picker-pop {`），连同其上方注释（1634-1636）替换为一行指向：`/* picker 弹层经 Portal 挂 body，主题 token 由合并后的 body 作用域继承（原独立块已删除，2026-10-12） */`。1705 起的 `.mafw-picker-pop { position: fixed; … }` 布局规则不动。
5. 文件头注释（第 1 行区域）更新：「复制勿引用」不变量退役说明改为「选择器合并单块单一源」。

- [ ] **Step 4: 迁移三个既有测试文件的选择器**

- `tests/design-contract.test.ts`：头部改为
  ```ts
  import { readMafwCss, ruleWithScope } from "./css-helpers"
  const css = readMafwCss()
  ```
  删除本地 `cssBlock` 定义的闭包 css 依赖，改为 `export function cssBlock(selector: string): string` 内部第一行 `const css = readMafwCss()`（保留导出签名，全文调用点零改动）。三个主题常量改为：
  ```ts
  const dark = ruleWithScope(css, ".mafw-shell", "dark")
  const light = ruleWithScope(css, ".mafw-shell", "light")
  const sysLight = ruleWithScope(css, ".mafw-shell", "system-light")
  const bodyDark = dark      // 合并后同一块
  const bodyLight = light
  const bodySysLight = sysLight
  ```
- `src/renderer/mafw/code-theme-css.test.ts`：删除本地 `cssBlock`，改为
  ```ts
  import { readMafwCss, ruleWithScope } from "../../tests/css-helpers"
  const css = readMafwCss()
  const dark = ruleWithScope(css, ".mafw-shell", "dark")
  const light = ruleWithScope(css, ".mafw-shell", "light")
  const sysLight = ruleWithScope(css, ".mafw-shell", "system-light")
  ```
- `src/renderer/mafw/motion-tokens.test.ts` 第 8 行：`css.indexOf(".mafw-shell {")` → `css.indexOf(".mafw-shell, body {")`。

- [ ] **Step 5: 全量测试 + 构建**

Run: `cd packages/desktop && bun test`
Expected: 全绿（1008+ 新 theme-merge 用例）
Run: `cd packages/desktop && npx electron-vite build`
Expected: built 成功

- [ ] **Step 6: 提交**

```bash
git add packages/desktop/src/renderer/mafw/mafw.css packages/desktop/tests/css-helpers.ts packages/desktop/src/renderer/mafw/theme-merge-css.test.ts packages/desktop/tests/design-contract.test.ts packages/desktop/src/renderer/mafw/code-theme-css.test.ts packages/desktop/src/renderer/mafw/motion-tokens.test.ts
git commit -m "refactor(desktop): 主题 token 块选择器合并 9→3，删除 picker-pop 冗余 token 块，契约测试改钉作用域覆盖+键集一致"
```

---

### Task 3: 悬空 token 兜底别名

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/theme-merge-css.test.ts`
- Modify: `packages/desktop/src/renderer/mafw/mafw.css`（三个合并块）

**Interfaces:**
- Consumes: Task 2 的合并块与 `ruleWithScope`。
- Produces: 三个合并块新增 `--text-6` / `--success` / `--border-strong`。

- [ ] **Step 1: 追加失败测试**（theme-merge-css.test.ts 尾部）

```ts
describe("悬空 token 兜底别名（值 = 现行 fallback 生效值，零视觉变化）", () => {
  for (const [name, block] of [["暗色", dark], ["亮色手动", light], ["亮色系统", sysLight]] as const) {
    test(`${name}块定义 --text-6 / --success / --border-strong`, () => {
      expect(block).toContain("--text-6: var(--text-5)")
      expect(block).toContain("--success: #3fb950")
      expect(block).toContain("--border-strong: var(--text-5)")
    })
  }
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/desktop && bun test src/renderer/mafw/theme-merge-css.test.ts`
Expected: 3 fail

- [ ] **Step 3: 三个合并块各加三行**（放在 `--text-5` 定义行之后，三个块同样位置）

```css
  /* 兜底别名：历史上消费方 fallback 指向未定义 token，值 = 现行生效值 */
  --text-6: var(--text-5);
  --success: #3fb950;
  --border-strong: var(--text-5);
```

- [ ] **Step 4: 跑测试确认通过 + 提交**

Run: `cd packages/desktop && bun test src/renderer/mafw/theme-merge-css.test.ts`
Expected: 全绿

```bash
git add packages/desktop/src/renderer/mafw/mafw.css packages/desktop/src/renderer/mafw/theme-merge-css.test.ts
git commit -m "fix(desktop): 补 --text-6/--success/--border-strong 兜底别名（值=现行 fallback，零视觉变化）"
```

---

### Task 4: 悬空引用静态扫描

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/theme-merge-css.test.ts`

**Interfaces:**
- Consumes: `readMafwCss`；上游文件 `packages/ui/src/styles/theme.css`、`packages/ui/src/styles/tailwind/colors.css`、`packages/ui/src/v2/styles/theme.css`、`packages/session-ui/src/components/markdown.css`。
- Produces: 无新接口。

- [ ] **Step 1: 追加测试**

```ts
describe("悬空引用扫描 — mafw.css 引用的 token 必须有定义", () => {
  test("var(--x) 引用闭集", () => {
    const upstream = ["../../ui/src/styles/theme.css", "../../ui/src/styles/tailwind/colors.css", "../../ui/src/v2/styles/theme.css", "../../session-ui/src/components/markdown.css"]
      .map((p) => readFileSync(join(import.meta.dir, p), "utf8"))
      .join("\n")
    const defined = new Set(
      [...(css + "\n" + upstream).matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]),
    )
    const referenced = [...css.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1])
    const missing = [...new Set(referenced.filter((t) => !defined.has(t)))]
    expect(missing).toEqual([])
  })
})
```

（文件顶部补 `import { readFileSync } from "node:fs"` 与 `import { join } from "node:path"`。）

- [ ] **Step 2: 跑测试**

Run: `cd packages/desktop && bun test src/renderer/mafw/theme-merge-css.test.ts`
Expected: 若 FAIL，missing 列表即新发现的悬空 token——按 Task 3 同一原则（别名 = 现行 fallback 生效值）在三个合并块补齐，直至通过。每条新补别名记入提交信息。

- [ ] **Step 3: 提交**

```bash
git add packages/desktop/src/renderer/mafw/theme-merge-css.test.ts packages/desktop/src/renderer/mafw/mafw.css
git commit -m "test(desktop): 主题 token 悬空引用静态扫描（引用闭集契约）"
```

---

### Task 5: 收尾——文档 + 全量验证

**Files:**
- Modify: `AGENTS.md`（§5.5 v5 不变量描述）

- [ ] **Step 1: AGENTS.md 更新**

把 §5.5 中「v5 主题 token 三重重复是刻意不变量 / 复制勿引用」相关表述更新为：「2026-10-12 起主题 token 选择器合并为每主题单块（`.mafw-shell, body` 双作用域），『复制勿引用』退役；picker 弹层 token 从 body 继承」。

- [ ] **Step 2: 全量验证**

Run: `cd packages/desktop && bun test`
Expected: 全绿，记录通过数
Run: `cd packages/desktop && npx electron-vite build`
Expected: built 成功

- [ ] **Step 3: 提交**

```bash
git add AGENTS.md
git commit -m "docs(desktop): AGENTS §5.5 主题 token 不变量更新（选择器合并单块制）"
```

- [ ] **Step 4: 向用户汇报**

汇报：新增测试数 / 全量通过数 / 各 commit 哈希；请用户目视冒烟（亮/暗/跟随系统三态切换 + Config 弹窗不透明 + 代码块两主题底色）。
