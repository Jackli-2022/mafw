# Desktop 美学 v5 · Wave 0（Token v5 暖纸色阶 + accent 绿重校准）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 mafw.css 的双主题色板从冷中性切换为暖纸调，并重校准品牌绿（降饱和），全部旧变量名保留。

**Architecture:** 纯 token 层改动——`.mafw-shell` 暗色默认块、`html[data-theme="light"]` 手动亮色块、`@media (prefers-color-scheme: light)` 系统亮色块三处同步替换；v1/v2 兼容覆盖 token 跟随新值。机械保障在 `packages/desktop/tests/design-contract.test.ts`（cssBlock 选择器块解析模式）。

**Tech Stack:** CSS custom properties、bun test。

**Spec:** `docs/superpowers/specs/2026-09-21-desktop-aesthetic-v5-design.md`（§1 §2）

## Global Constraints

- 只改 `packages/desktop/src/renderer/mafw/mafw.css` 与 `packages/desktop/tests/design-contract.test.ts`，不动任何组件文件
- v3/v4 全部变量名必须保留（V3_GUARD 回归测试不动）
- 暖调约束：所有新色值 chroma ≤0.02 级微暖（观感温润，不发黄）
- accent 衍生 alpha 色按新基色 `rgb(79,211,136)`（暗）/ `rgb(23,128,76)`（亮）同比例重算，alpha 值不变
- 亮色 `--accent` 对 `--bg-base` 对比度必须 ≥4.5:1（WCAG 公式，测试机械断言）
- 测试命令：`bun test tests/design-contract.test.ts`（workdir `packages/desktop`）
- 每 Task 结束独立 commit；版本号在 Wave 3 统一 bump（用户发布惯例）

## 新旧色值对照表（全部 Task 的单一事实源）

### 暗色块（`.mafw-shell {`）

| token | 旧 | 新 |
|---|---|---|
| --bg-base | #09090B | #100F0E |
| --bg-raised | #101014 | #161513 |
| --bg-overlay | #17171D | #1D1B18 |
| --bg-float | #1F1F27 | #252320 |
| --bg-inset | #0D0D10 | #12110F |
| --accent | #46DC82 | #4FD388 |
| --accent-dim | rgba(70,220,130,.13) | rgba(79,211,136,.13) |
| --accent-text | #7FE3A6 | #8CE0B1 |
| --on-accent | #09090B | #100F0E |
| --accent-strong | #5CE896 | #67DE9B |
| --accent-soft | rgba(70,220,130,.12) | rgba(79,211,136,.12) |
| --accent-border | rgba(70,220,130,.35) | rgba(79,211,136,.35) |
| --text-1 | #ECECF0 | #EDECE9 |
| --text-2 | #CFCFD6 | #D1CFCA |
| --text-3 | #8C8C94 | #8E8C86 |
| --text-4 | #5C5C64 | #5E5C57 |
| --text-5 | #404047 | #42403C |
| --glow-accent | rgba(70,220,130,.3) | rgba(79,211,136,.3) |
| --selection | rgba(70,220,130,.22) | rgba(79,211,136,.22) |
| --focus-ring | rgba(70,220,130,.45) | rgba(79,211,136,.45) |
| --composer-focus | rgba(70,220,130,.4) | rgba(79,211,136,.4) |
| --composer-halo | rgba(70,220,130,.1) | rgba(79,211,136,.1) |
| --background-base | #09090B | #100F0E |
| --background-weak | #101014 | #161513 |
| --background-stronger | #101014 | #161513 |
| --surface-base | #17171D | #1D1B18 |
| --surface-raised-base | #1F1F27 | #252320 |
| --text-base | #8C8C94 | #8E8C86 |
| --text-weak | #5C5C64 | #5E5C57 |
| --text-strong | #ECECF0 | #EDECE9 |
| --v2-background-bg-base | #09090B | #100F0E |
| --v2-background-bg-layer-01 | #17171D | #1D1B18 |
| --v2-background-bg-layer-02 | #1F1F27 | #252320 |
| --v2-background-bg-layer-03 | #2A2A32 | #2E2C27 |
| --v2-text-text-base | #CFCFD6 | #D1CFCA |
| --v2-text-text-muted | #8C8C94 | #8E8C86 |
| --v2-text-text-faint | #5C5C64 | #5E5C57 |

### 亮色块（手动 `html[data-theme="light"]` 与系统 `@media` 块同值同步）

| token | 旧 | 新 |
|---|---|---|
| --bg-base | #ECECF0 | #FAF9F5 |
| --bg-raised | #FAFAFB | #F3F1EB |
| --bg-overlay | #EDEDF1 | #FFFFFF |
| --bg-inset | #F2F2F5 | #EFEDE7 |
| --accent | #1F9D5A | #17804C |
| --accent-dim | rgba(31,157,90,.10) | rgba(23,128,76,.10) |
| --accent-text | #177A48 | #14663C |
| --accent-strong | #178048 | #126B3D |
| --accent-soft | rgba(31,157,90,.10) | rgba(23,128,76,.10) |
| --accent-border | rgba(31,157,90,.32) | rgba(23,128,76,.32) |
| --text-1 | #17171B | #1A1917 |
| --text-2 | #34343B | #35332F |
| --text-3 | #5E5E66 | #605D57 |
| --text-4 | #8E8E96 | #8F8C85 |
| --text-5 | #B9B9BF | #BAB7B0 |
| --glow-accent | rgba(31,157,90,.30) | rgba(23,128,76,.30) |
| --selection | rgba(31,157,90,.18) | rgba(23,128,76,.18) |
| --focus-ring | rgba(31,157,90,.35) | rgba(23,128,76,.35) |
| --composer-focus | rgba(31,157,90,.45) | rgba(23,128,76,.45) |
| --composer-halo | rgba(31,157,90,.10) | rgba(23,128,76,.10) |
| --background-base | #ECECF0 | #FAF9F5 |
| --background-weak | #F6F6F8 | #F3F1EB |
| --background-stronger | #FAFAFB | #F3F1EB |
| --surface-base | #EDEDF1 | #FFFFFF |
| --text-base | #5E5E66 | #605D57 |
| --text-weak | #8E8E96 | #8F8C85 |
| --text-strong | #17171B | #1A1917 |
| --v2-background-bg-base | #ECECF0 | #FAF9F5 |
| --v2-background-bg-layer-01 | #EDEDF1 | #FFFFFF |
| --v2-background-bg-layer-03 | #F0F0F4 | #EAE7E0 |
| --v2-text-text-base | #34343B | #35332F |
| --v2-text-text-muted | #5E5E66 | #605D57 |
| --v2-text-text-faint | #8E8E96 | #8F8C85 |

（`--bg-float`、`--surface-raised-base`、`--v2-background-bg-layer-02` 亮色新旧同为 #FFFFFF，无需改；`--on-accent` 亮色 #FFFFFF 不变。）

---

### Task 1: design-contract 测试改写为 v5 期望（先失败）

**Files:**
- Modify: `packages/desktop/tests/design-contract.test.ts:54-59`（替换 "token v4 — 暗色背景换冷蓝调" describe）

**Interfaces:**
- Consumes: 现有 `cssBlock()` helper、`dark`/`light`/`sysLight` 三个已解析块
- Produces: 新增 `tokenHex(block, name)` / `contrastHex(a, b)` 两个 helper（同文件导出，后续 Wave 复用）；v5 断言组

- [ ] **Step 1: 写失败测试**

把 `:54-59` 的 `describe("token v4 — 暗色背景换冷蓝调", ...)` 整块替换为：

```ts
/** 取块内某 token 的 hex 值；找不到返回 null */
export function tokenHex(block: string, name: string): string | null {
  const m = block.match(new RegExp(`${name}:\\s*(#[0-9A-Fa-f]{6})`))
  return m ? m[1].toUpperCase() : null
}

/** WCAG 相对亮度对比度 */
export function contrastHex(a: string, b: string): number {
  const lum = (hex: string) => {
    const m = hex.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i)!
    const lin = (v: number) => {
      const s = v / 255
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
    }
    return 0.2126 * lin(parseInt(m[1], 16)) + 0.7152 * lin(parseInt(m[2], 16)) + 0.0722 * lin(parseInt(m[3], 16))
  }
  const [la, lb] = [lum(a), lum(b)]
  const [hi, lo] = la > lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}

describe("token v5 — 暗色暖纸背景", () => {
  test("bg-base #100F0E", () => expect(dark).toContain("--bg-base: #100F0E"))
  test("bg-raised #161513", () => expect(dark).toContain("--bg-raised: #161513"))
  test("bg-overlay #1D1B18", () => expect(dark).toContain("--bg-overlay: #1D1B18"))
  test("bg-float #252320", () => expect(dark).toContain("--bg-float: #252320"))
  test("bg-inset #12110F", () => expect(dark).toContain("--bg-inset: #12110F"))
})

describe("token v5 — 亮色米纸背景（手动块）", () => {
  test("bg-base #FAF9F5", () => expect(light).toContain("--bg-base: #FAF9F5"))
  test("bg-raised #F3F1EB", () => expect(light).toContain("--bg-raised: #F3F1EB"))
  test("bg-overlay #FFFFFF", () => expect(light).toContain("--bg-overlay: #FFFFFF"))
  test("bg-inset #EFEDE7", () => expect(light).toContain("--bg-inset: #EFEDE7"))
})

describe("token v5 — 亮色系统块与手动块一致", () => {
  test.each(["--bg-base: #FAF9F5", "--bg-raised: #F3F1EB", "--bg-inset: #EFEDE7", "--accent: #17804C"])(
    "系统块含 %s", (s) => expect(sysLight).toContain(s),
  )
})

describe("token v5 — accent 绿重校准", () => {
  test("暗色 accent #4FD388", () => expect(dark).toContain("--accent: #4FD388"))
  test("暗色 accent-strong #67DE9B", () => expect(dark).toContain("--accent-strong: #67DE9B"))
  test("暗色 accent-text #8CE0B1", () => expect(dark).toContain("--accent-text: #8CE0B1"))
  test("暗色 accent alpha 基色 rgb(79,211,136)", () => {
    expect(dark).toContain("rgba(79,211,136,.12)")  // accent-soft
    expect(dark).toContain("rgba(79,211,136,.35)")  // accent-border
    expect(dark).not.toContain("70,220,130")
  })
  test("亮色 accent #17804C", () => expect(light).toContain("--accent: #17804C"))
  test("亮色 accent 对 bg-base 对比度 ≥4.5", () => {
    const accent = tokenHex(light, "--accent")!
    const bg = tokenHex(light, "--bg-base")!
    expect(contrastHex(accent, bg)).toBeGreaterThanOrEqual(4.5)
  })
  test("亮色 accent alpha 基色 rgb(23,128,76)", () => {
    expect(light).toContain("rgba(23,128,76,.10)")
    expect(light).toContain("rgba(23,128,76,.32)")
    expect(light).not.toContain("31,157,90")
  })
})

describe("token v5 — 暖色文字阶", () => {
  test("暗色 text-1 #EDECE9", () => expect(dark).toContain("--text-1: #EDECE9"))
  test("暗色 text-3 #8E8C86", () => expect(dark).toContain("--text-3: #8E8C86"))
  test("亮色 text-1 #1A1917", () => expect(light).toContain("--text-1: #1A1917"))
  test("亮色 text-3 #605D57", () => expect(light).toContain("--text-3: #605D57"))
})

describe("token v5 — v1/v2 兼容覆盖层跟随", () => {
  test("暗色 --background-base #100F0E", () => expect(dark).toContain("--background-base: #100F0E"))
  test("暗色 --v2-background-bg-base #100F0E", () => expect(dark).toContain("--v2-background-bg-base: #100F0E"))
  test("暗色 --v2-background-bg-layer-03 #2E2C27", () => expect(dark).toContain("--v2-background-bg-layer-03: #2E2C27"))
  test("亮色 --background-base #FAF9F5", () => expect(light).toContain("--background-base: #FAF9F5"))
  test("亮色 --v2-background-bg-layer-03 #EAE7E0", () => expect(light).toContain("--v2-background-bg-layer-03: #EAE7E0"))
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `bun test tests/design-contract.test.ts`（workdir `packages/desktop`）
Expected: FAIL（v5 各 describe 红色，报 `--bg-base: #100F0E` not contained 等）

- [ ] **Step 3: Commit（测试先行）**

```bash
git add packages/desktop/tests/design-contract.test.ts
git commit -m "test(desktop): design-contract v5 expectations (warm paper ramp + recalibrated accent)"
```

---

### Task 2: 暗色块 token 替换

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/mafw.css:1-80`（`.mafw-shell {` 暗色默认块）

**Interfaces:**
- Consumes: 对照表「暗色块」
- Produces: 无新接口；全部变量名不变

- [ ] **Step 1: 按对照表逐行替换**

`mafw.css` 第 1-80 行暗色块内，按「暗色块」对照表替换全部 38 个值（含 `--on-accent`、v1 覆盖段 `--background-*`/`--surface-*`/`--text-base/weak/strong`、v2 覆盖段 `--v2-*`）。同时更新注释：

- 第 1 行 `/* ══ 主题变量层（作用域 .mafw-shell，暗色默认，v3 色板） ══ */` → `/* ══ 主题变量层（作用域 .mafw-shell，暗色默认，v5 暖纸色板） ══ */`
- 第 6 行注释 `（§3.1 v4: 09/10/17/1F + inset 凹陷井，冷蓝调）` → `（§3.1 v5: 暖纸调，chroma≤0.02）`

- [ ] **Step 2: 跑测试确认暗色相关断言转绿**

Run: `bun test tests/design-contract.test.ts`（workdir `packages/desktop`）
Expected: "token v5 — 暗色*" 与 "v1/v2 兼容覆盖层" 的暗色断言 PASS；亮色断言仍 FAIL

- [ ] **Step 3: Commit**

```bash
git add packages/desktop/src/renderer/mafw/mafw.css
git commit -m "feat(desktop): token v5 dark warm-paper ramp + recalibrated accent green"
```

---

### Task 3: 亮色手动块 + 系统块 token 替换

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/mafw.css:82-151`（手动亮色块）
- Modify: `packages/desktop/src/renderer/mafw/mafw.css:153-187`（`@media (prefers-color-scheme: light)` 系统块）

**Interfaces:**
- Consumes: 对照表「亮色块」
- Produces: 无新接口

- [ ] **Step 1: 手动亮色块按对照表替换**

`html[data-theme="light"] .mafw-shell {` 块内按「亮色块」对照表替换全部值（注意该块内 `--bg-float`/`--surface-raised-base`/`--v2-background-bg-layer-02` 新旧同为 #FFFFFF，不动）。

- [ ] **Step 2: 系统亮色块同步替换**

`@media (prefers-color-scheme: light)` 内的 `html:not([data-theme]) .mafw-shell {` 块是手动块的压缩复写（同行多声明格式），按同一对照表逐值替换。**保持压缩格式不变**。

- [ ] **Step 3: 跑测试确认全绿**

Run: `bun test tests/design-contract.test.ts`（workdir `packages/desktop`）
Expected: PASS（含亮色对比度 ≥4.5 机械断言）

- [ ] **Step 4: Commit**

```bash
git add packages/desktop/src/renderer/mafw/mafw.css
git commit -m "feat(desktop): token v5 light paper ramp (manual + system blocks)"
```

---

### Task 4: 全文件 accent rgba 残余扫描

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/mafw.css`（token 层之外可能引用旧 accent rgb 三元组的规则）

**Interfaces:**
- Consumes: 无
- Produces: 无

- [ ] **Step 1: 扫描旧三元组残余**

Run: `rg -n "70,220,130|31,157,90" src/renderer/mafw/mafw.css`（workdir `packages/desktop`）
Expected: 无输出（token 层已在 Task 2/3 清完）

- [ ] **Step 2: 若有残余，按语境替换**

暗色语境（如暗色专属规则、阴影）→ `79,211,136`；亮色语境 → `23,128,76`。每处替换后回到 Step 1 复扫。

- [ ] **Step 3: 顺带扫描旧 hex 残余**

Run: `rg -n "#09090B|#101014|#17171D|#1F1F27|#0D0D10|#46DC82|#5CE896|#7FE3A6|#ECECF0|#FAFAFB|#EDEDF1|#F2F2F5|#1F9D5A|#178048|#177A48" src/renderer/mafw/mafw.css`（workdir `packages/desktop`）
Expected: 无输出。若有命中，判断是否 token 别名引用（应改为 `var(--*)`）或遗漏块，逐一处理。

- [ ] **Step 4: 全量测试 + 提交**

Run: `bun test`（workdir `packages/desktop`，跑全部 desktop 测试确认无回归）
Expected: PASS

```bash
git add packages/desktop/src/renderer/mafw/mafw.css
git commit -m "feat(desktop): sweep stale accent rgb triplets and v4 hex remnants"
```

---

### Task 5: 双主题截图门禁（人工验收）

**Files:** 无代码改动

- [ ] **Step 1: 启动 desktop（gateway 需在跑）**

确认 gateway 与 desktop 启动（`mafw status`；desktop 由用户或 `mafw daemon` + 桌面客户端启动）。

- [ ] **Step 2: 双主题截图**

用 `mafw_desktop_screenshot` 分别截取暗色（默认）与亮色（Config 页切换 `data-theme="light"`）的 Chat 主界面 + Dashboard。

- [ ] **Step 3: 人工确认标准**

- 暖纸感「温润不发黄」（若显脏：把五阶背景 chroma 再降，即向纯中性回移 1-2 个色点，重跑 Task 1-3 的对照表值与测试）
- accent 绿在新底色上和谐、对比清晰
- 无明显对比度回退（文字可读性）

- [ ] **Step 4: 验收通过后汇报**

按用户惯例汇报：本波 commit 列表、新增测试数（Task 1 新增约 20 条断言）、desktop 全量测试通过数。

---

## Self-Review 记录

- **Spec 覆盖**：§1 暖调色阶（Task 2/3/5）、§2 accent 校准（Task 2/3/4 + 对比度断言）✅；§3-§6 属 Wave 1/2/3，不在本计划
- **Placeholder 扫描**：无 TBD；所有色值在全局对照表给出精确值
- **类型一致性**：`tokenHex`/`contrastHex` 两 helper 在 Task 1 定义并导出，命名全文一致
- **已知边界**：系统亮色块为压缩单行格式，替换时保持格式（Task 3 Step 2 已注明）；截图调准若改值需同步回写本计划对照表
