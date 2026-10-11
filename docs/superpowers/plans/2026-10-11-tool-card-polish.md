# MAFW Desktop 工具卡美化 v8 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 MAFW Desktop 工具卡提到「原生工具调用」bar：结构化触发一行 + 内容 surface 盒 + 状态徽标 + 展开高度动效。

**Architecture:** 全在 `packages/desktop` 渲染层。触发行/内容盒走 `mafw.css`（覆盖 `.mafw-session-turn-container [data-component="tool-part-wrapper"]` 段与 `.mafw-tool-*` 段）；状态徽标走 `extract.ts` 的 `ToolCardSpec.badge` + `shared.tsx` 的 `trigger.action` 位；动效走 `BasicTool animated`。内容盒放在内层 `.mafw-tool-box`（不直接在 animated 的 content 元素上），避免折叠到 0 高时露出边框。

**Tech Stack:** SolidJS + Electron 42；CSS 自定义属性；bun:test（CSS 文本契约 + 纯逻辑）；electron-vite。

参考 spec：`docs/superpowers/specs/2026-10-11-tool-card-polish-design.md`

## Global Constraints

- **UI**：禁裸 `<button>`/`<input>`/裸 `title`；用 `@opencode-ai/ui/v2/*`。`TooltipV2` 用 `value`。
- **动效**：纯 CSS transition；走 v7 token（`--dur-fast` 140ms / `--dur-surface` 280ms + `--ease-standard`/`--ease-surface`）；无 spring。
- **令牌**：颜色/尺寸走 token（`--text-*`/`--border-subtle`/`--r-*`/`--bg-inset`/`--hover`/`--active`），禁字面值；只动 v5/v6 现有 token，不新增颜色。
- **reduced-motion**：`.mafw-shell` 全局降级块不动。
- **门禁**：每 task `cd packages/desktop && bun test`；wave 末 `npx electron-vite build`；只 `git add` 本任务文件，绝不 stage 他人 WIP（`.superpowers/sdd/task-1-brief.md`）。
- **不做**：家族色图标、file-accordion/diff、dsh 常显轨迹、Claude 拟人文案、工具卡数据解析改动。
- **汇报**：每 wave 记录 新增用例数 + 全量通过数。

---

## 文件结构

| 文件 | 责任 | 动作 |
|---|---|---|
| `packages/desktop/src/renderer/mafw/mafw.css` | 触发行 + 内容盒 + 徽标样式 | 改 |
| `packages/desktop/src/renderer/mafw/components/tool-cards/shared.tsx` | familyCard（box 包裹 + badge + animated） | 改 |
| `packages/desktop/src/renderer/mafw/components/tool-cards/extract.ts` | `ToolCardSpec.badge` + 各 spec 徽标 | 改 |
| `packages/desktop/src/renderer/mafw/components/tool-cards/rule-model.ts` | rule 族徽标（可选） | 改 |
| `packages/desktop/src/renderer/mafw/components/tool-cards/memory-read.tsx` / `memory-write.tsx` / `automation.tsx` / `python.tsx` | box 包裹 + animated | 改 |
| `packages/desktop/src/renderer/mafw/tool-card-css.test.ts` | 触发行/盒/徽标 CSS 契约 | 新建 |
| `packages/desktop/src/renderer/mafw/components/tool-cards/extract.test.ts` | badge 纯逻辑 | 改 |

---

## W1 — 触发行 + 内容盒

### Task 1: 触发行结构化（CSS）

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/mafw.css`（`.mafw-session-turn-container [data-component="tool-part-wrapper"]` 段，约 1159-1183）
- Test: `packages/desktop/src/renderer/mafw/tool-card-css.test.ts`（新建）

**Interfaces:**
- Produces: 触发行 26px / 标题 `--text-1` 13px 500 / args `--text-4` 11px；`.mafw-tool-badge` 徽标类（tone=`ok|warn|err|muted`）。

- [ ] **Step 1: 写失败契约测试**

Create `packages/desktop/src/renderer/mafw/tool-card-css.test.ts`:

```ts
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const css = readFileSync(join(import.meta.dir, "mafw.css"), "utf8")

describe("tool card trigger (v8)", () => {
  test("trigger row is 26px with a 13px title and 11px args", () => {
    expect(css).toMatch(/\[data-slot="collapsible-trigger"\]\s*\{[^}]*height:\s*26px/)
    expect(css).toMatch(/\[data-slot="basic-tool-tool-title"\]\s*\{[^}]*font-size:\s*13px/)
    expect(css).toMatch(/\[data-slot="basic-tool-tool-arg"\]\s*\{[^}]*font-size:\s*11px/)
  })
  test("status badge class exists with tone variants", () => {
    expect(css).toMatch(/\.mafw-tool-badge\s*\{/)
    expect(css).toMatch(/\.mafw-tool-badge\[data-tone="ok"\]/)
    expect(css).toMatch(/\.mafw-tool-badge\[data-tone="err"\]/)
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `cd packages/desktop && bun test src/renderer/mafw/tool-card-css.test.ts`
Expected: FAIL（26px / 13px / badge 规则不存在）。

- [ ] **Step 3: 改 CSS**

把 `mafw.css` 中 `[data-component="tool-part-wrapper"]` 段落里的触发行规则改为：

```css
.mafw-session-turn-container [data-component="tool-part-wrapper"] [data-slot="collapsible-trigger"] {
  height: 26px;
  padding: 0 6px;
  color: var(--text-3);
  font-size: 13px;
  font-weight: 500;
  transition: color var(--dur-fast) var(--ease-standard), background var(--dur-fast) var(--ease-standard);
}
```

紧接 hover 规则后新增（保留原 hover）：

```css
.mafw-session-turn-container [data-component="tool-part-wrapper"] [data-slot="collapsible-trigger"]:active {
  background: var(--active);
}
.mafw-session-turn-container [data-component="tool-part-wrapper"] [data-slot="basic-tool-tool-title"] {
  color: var(--text-1);
  font-weight: 500;
}
.mafw-session-turn-container [data-component="tool-part-wrapper"] [data-slot="basic-tool-tool-arg"] {
  color: var(--text-4);
  font-size: 11px;
}
```

在 `.mafw-tool-*` 段（约 2040 起）新增徽标类：

```css
.mafw-tool-badge { flex-shrink: 0; padding: 1px 7px; border-radius: 999px; font-size: 10px; font-weight: 600; line-height: 16px; font-variant-numeric: tabular-nums; border: 0.5px solid var(--border-subtle); color: var(--text-3); }
.mafw-tool-badge[data-tone="ok"] { color: var(--accent-text); background: var(--accent-dim); border-color: var(--accent-border); }
.mafw-tool-badge[data-tone="warn"] { color: var(--warning); background: color-mix(in srgb, var(--warning) 10%, transparent); border-color: color-mix(in srgb, var(--warning) 30%, transparent); }
.mafw-tool-badge[data-tone="err"] { color: var(--danger-text); background: var(--danger-dim); border-color: color-mix(in srgb, var(--danger) 30%, transparent); }
.mafw-tool-badge[data-tone="muted"] { color: var(--text-4); background: transparent; }
```

- [ ] **Step 4: 运行确认通过**

Run: `cd packages/desktop && bun test src/renderer/mafw/tool-card-css.test.ts`
Expected: PASS（2 用例）。

- [ ] **Step 5: 提交**

```bash
git add packages/desktop/src/renderer/mafw/mafw.css packages/desktop/src/renderer/mafw/tool-card-css.test.ts
git commit -m "feat(desktop): tool card trigger row v8 (26px / 13px title / args) + status badge class"
```

---

### Task 2: 内容盒（surface box）

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/mafw.css`（删左竖线规则，加 `.mafw-tool-box`；`.mafw-tool-output` 加 mono）
- Modify: `packages/desktop/src/renderer/mafw/components/tool-cards/shared.tsx`（familyCard 内容包 `.mafw-tool-box`）
- Modify: `packages/desktop/src/renderer/mafw/components/tool-cards/memory-read.tsx` / `memory-write.tsx` / `automation.tsx`
- Test: `packages/desktop/src/renderer/mafw/tool-card-css.test.ts`（追加）

**Interfaces:**
- Consumes: Task 1 的 `.mafw-tool-badge`。
- Produces: `.mafw-tool-box` 内容盒（描边/圆角/内边距/inset 底）；`ToolSections` 仍在 `shared.tsx` 导出。

- [ ] **Step 1: 写失败契约测试**

在 `tool-card-css.test.ts` 追加：

```ts
describe("tool card body surface (v8)", () => {
  test("content box has hairline + radius + inset background", () => {
    expect(css).toMatch(/\.mafw-tool-box\s*\{[^}]*border:\s*0\.5px solid var\(--border-subtle\)/)
    expect(css).toMatch(/\.mafw-tool-box\s*\{[^}]*border-radius:\s*var\(--r-md\)/)
    expect(css).toMatch(/\.mafw-tool-box\s*\{[^}]*background:\s*var\(--bg-inset\)/)
  })
  test("legacy left-rule indentation is gone", () => {
    expect(css).not.toMatch(/\[data-slot="collapsible-content"\]\s*>\s*\*\s*\{[^}]*border-left/)
  })
  test("code output uses the data font", () => {
    expect(css).toMatch(/\.mafw-tool-output\s*\{[^}]*font-family:\s*var\(--font-data\)/)
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `cd packages/desktop && bun test src/renderer/mafw/tool-card-css.test.ts`
Expected: FAIL。

- [ ] **Step 3: 改 CSS**

删除该规则（左竖线缩进）：

```css
.mafw-session-turn-container [data-component="tool-part-wrapper"] [data-slot="collapsible-content"] > * {
  border-left: 1px solid var(--border-subtle);
  background: transparent;
  margin-left: 4px;
}
```

在 `.mafw-tool-*` 段新增：

```css
.mafw-tool-box { margin: 4px 0 8px; padding: 8px 10px; border: 0.5px solid var(--border-subtle); border-radius: var(--r-md); background: var(--bg-inset); color: var(--text-base); }
```

把 `.mafw-tool-output` 规则加 mono：

```css
.mafw-tool-output { color: var(--text-base); overflow-x: auto; padding: 8px; background: var(--surface-inset-base, var(--background-weak)); border-radius: 4px; max-height: 240px; font-size: 12px; font-family: var(--font-data); }
```

- [ ] **Step 4: 改 shared.tsx / 自绘卡包 box**

`shared.tsx` familyCard 的 children 改为：

```tsx
      >
        <div class="mafw-tool-box"><ToolSections sections={sections()} /></div>
        <Show when={props.status === "completed" && sections().length === 0}>
          <div class="mafw-tool-empty">(无输出)</div>
        </Show>
      </BasicTool>
```

`memory-read.tsx`：把现有内容块（`<div class="mafw-tool-results">…</div>` 及其后的 `fok`/`hint` 两个 `<Show>`）一起包进 `.mafw-tool-box`——即在 `<BasicTool …>` 的第一个子节点处插入 `<div class="mafw-tool-box">`，末尾对应 `</div>`：

```tsx
      <div class="mafw-tool-box">
        <div class="mafw-tool-results">
          <For each={model().results}>{(r) => ( /* …原结果行… */ )}</For>
          <Show when={model().results.length === 0 && props.status === "completed"}>
            <div class="mafw-tool-empty">No results</div>
          </Show>
        </div>
        <Show when={model().fok}><div class="mafw-tool-meta">{model().fok}</div></Show>
        <Show when={model().hint}><div class="mafw-tool-meta" style="font-size:11px">{model().hint}</div></Show>
      </div>
```

（`<For>` 内原结果行不动，只在最外多包一层 `.mafw-tool-box`。）

`memory-write.tsx`：`<div class="mafw-tool-box"><ToolSections sections={sections()} /></div>`。

`automation.tsx`：`<div class="mafw-tool-box"><ToolSections sections={ruleSections(props.tool, props.output)} /></div>`。

- [ ] **Step 5: 运行 + 提交**

Run: `cd packages/desktop && bun test`
Expected: 全绿。

```bash
git add packages/desktop/src/renderer/mafw/mafw.css packages/desktop/src/renderer/mafw/tool-card-css.test.ts packages/desktop/src/renderer/mafw/components/tool-cards/shared.tsx packages/desktop/src/renderer/mafw/components/tool-cards/memory-read.tsx packages/desktop/src/renderer/mafw/components/tool-cards/memory-write.tsx packages/desktop/src/renderer/mafw/components/tool-cards/automation.tsx
git commit -m "feat(desktop): tool card body surface box (hairline/radius/inset) replaces left-rule indent"
```

---

## W2 — 状态徽标

### Task 3: `ToolCardSpec.badge` + familyCard 渲染

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/components/tool-cards/extract.ts`（interface + 若干 spec 的 badge）
- Modify: `packages/desktop/src/renderer/mafw/components/tool-cards/shared.tsx`（渲染到 `trigger.action`）
- Test: `packages/desktop/src/renderer/mafw/components/tool-cards/extract.test.ts`

**Interfaces:**
- Produces: `ToolCardSpec.badge?: (input: any, output: string | undefined) => { text: string; tone?: "ok"|"warn"|"err"|"muted" } | undefined`。

- [ ] **Step 1: 写失败测试**

在 `extract.test.ts` 追加：

```ts
describe("ToolCardSpec.badge（状态徽标）", () => {
  test("get_goal_status：PASS → ok 徽标", () => {
    const b = TOOL_SPECS.mafw_get_goal_status.badge!({ goalId: "g1" }, JSON.stringify({ verdict: "PASS", phase: "DONE" }))
    expect(b).toEqual({ text: "PASS", tone: "ok" })
  })
  test("get_goal_status：FAILED → err；无 verdict → undefined", () => {
    expect(TOOL_SPECS.mafw_get_goal_status.badge!({}, JSON.stringify({ verdict: "FAILED" }))?.tone).toBe("err")
    expect(TOOL_SPECS.mafw_get_goal_status.badge!({}, JSON.stringify({ phase: "EXECUTING" }))).toBeUndefined()
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `cd packages/desktop && bun test src/renderer/mafw/components/tool-cards/extract.test.ts`
Expected: FAIL（`badge` 不存在）。

- [ ] **Step 3: 加 interface + 实现**

`extract.ts` 的 `ToolCardSpec` 增：

```ts
export interface ToolBadge { text: string; tone?: "ok" | "warn" | "err" | "muted" }
export interface ToolCardSpec {
  icon: string
  title: string
  subtitle?: (input: any) => string | undefined
  defaultOpen?: boolean
  extract: (input: any, output: string | undefined) => Section[]
  badge?: (input: any, output: string | undefined) => ToolBadge | undefined
}
```

`mafw_get_goal_status` 增 badge：

```ts
    badge: (_i, o) => {
      const v = parseOut(o)?.verdict
      if (typeof v !== "string" || !v) return undefined
      const up = v.toUpperCase()
      return { text: up, tone: up === "PASS" || up === "COMPLETED" ? "ok" : up === "FAIL" || up === "FAILED" || up === "CANCELLED" ? "err" : "muted" }
    },
```

`mafw_validate_rule` + `mafw_draft_automation_rule` 同理（`valid: true/false → {text:"valid"/"invalid", tone:"ok"/"err"}`）——这两个在 `rule-model.ts` 渲染，不在 TOOL_SPECS，故其 badge 在 Task 4 处理。

- [ ] **Step 4: shared.tsx 渲染徽标**

`familyCard` 计算并传入 `action`：

```tsx
    const badge = (): ToolBadge | undefined =>
      props.status === "completed" ? spec.badge?.(props.input, props.output) : undefined
    return (
      <BasicTool
        icon={spec.icon as any}
        trigger={{
          title: spec.title,
          subtitle: spec.subtitle?.(props.input),
          action: badge() ? <span class="mafw-tool-badge" data-tone={badge()!.tone ?? "muted"}>{badge()!.text}</span> : undefined,
        }}
        status={props.status}
        defaultOpen={spec.defaultOpen}
      >
```

（import `type ToolBadge`。）

- [ ] **Step 5: 运行确认通过 + 提交**

Run: `cd packages/desktop && bun test`
Expected: 全绿。

```bash
git add packages/desktop/src/renderer/mafw/components/tool-cards/extract.ts packages/desktop/src/renderer/mafw/components/tool-cards/extract.test.ts packages/desktop/src/renderer/mafw/components/tool-cards/shared.tsx
git commit -m "feat(desktop): ToolCardSpec.badge → trigger action chip (goal verdict)"
```

---

### Task 4: rule 族徽标

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/components/tool-cards/rule-model.ts`（导出 `ruleBadge(tool, output)`）
- Modify: `packages/desktop/src/renderer/mafw/components/tool-cards/automation.tsx`（渲染到 trigger.action）
- Test: `packages/desktop/src/renderer/mafw/components/tool-cards/rule-model.test.ts`

**Interfaces:**
- Consumes: `ToolBadge`（Task 3）。
- Produces: `export function ruleBadge(tool: string, output: string | undefined): { text: string; tone: "ok"|"warn"|"err"|"muted" } | undefined`。

- [ ] **Step 1: 写失败测试**

在 `rule-model.test.ts` 追加：

```ts
import { ruleBadge } from "./rule-model"
describe("ruleBadge", () => {
  test("validate_rule → valid/invalid", () => {
    expect(ruleBadge("mafw_validate_rule", JSON.stringify({ valid: true }))).toEqual({ text: "valid", tone: "ok" })
    expect(ruleBadge("mafw_validate_rule", JSON.stringify({ valid: false }))).toEqual({ text: "invalid", tone: "err" })
  })
  test("list_automation_rules → count", () => {
    expect(ruleBadge("mafw_list_automation_rules", JSON.stringify({ rules: [1, 2, 3], count: 3 }))).toEqual({ text: "3", tone: "muted" })
  })
  test("run_automation → status", () => {
    expect(ruleBadge("mafw_run_automation", JSON.stringify({ status: "PENDING_CONFIRMATION" }))?.text).toBe("PENDING_CONFIRMATION")
  })
  test("未知/无 → undefined", () => {
    expect(ruleBadge("mafw_get_automation_rule", JSON.stringify({}))).toBeUndefined()
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `cd packages/desktop && bun test src/renderer/mafw/components/tool-cards/rule-model.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现 ruleBadge**

`rule-model.ts` 追加（import `parseOut` 已有）：

```ts
import type { ToolBadge } from "./extract"

export function ruleBadge(tool: string, output: string | undefined): ToolBadge | undefined {
  const name = (tool || "").replace(/^mafw_/, "")
  const p = parseOut(output)
  if (p === undefined || p === null || typeof p !== "object") return undefined
  switch (name) {
    case "validate_rule":
    case "draft_automation_rule":
      if (typeof p.valid !== "boolean") return undefined
      return { text: p.valid ? "valid" : "invalid", tone: p.valid ? "ok" : "err" }
    case "list_automation_rules": {
      const n = Array.isArray(p.rules) ? p.rules.length : (typeof p.count === "number" ? p.count : undefined)
      return n === undefined ? undefined : { text: String(n), tone: "muted" }
    }
    case "list_triage_items": {
      const n = Array.isArray(p.items) ? p.items.length : (typeof p.count === "number" ? p.count : undefined)
      return n === undefined ? undefined : { text: String(n), tone: "muted" }
    }
    case "run_automation":
    case "propose_triage_decision":
      return typeof p.status === "string" && p.status ? { text: p.status, tone: "muted" } : undefined
    default:
      return undefined
  }
}
```

- [ ] **Step 4: automation.tsx 渲染徽标**

```tsx
import { ruleBadge, ruleSections } from "./rule-model"
// ...
  const badge = () => props.status === "completed" ? ruleBadge(props.tool, props.output) : undefined
  return (
    <BasicTool
      icon={isTriage() ? "warning" : "sliders"}
      trigger={{
        title: `MAFW ${toolName()}`,
        subtitle: props.input?.rule_id || props.input?.id || props.input?.triage_id,
        action: badge() ? <span class="mafw-tool-badge" data-tone={badge()!.tone ?? "muted"}>{badge()!.text}</span> : undefined,
      }}
      status={props.status}
    >
      <div class="mafw-tool-box"><ToolSections sections={ruleSections(props.tool, props.output)} /></div>
    </BasicTool>
  )
```

- [ ] **Step 5: 运行 + 提交**

Run: `cd packages/desktop && bun test`
Expected: 全绿。

```bash
git add packages/desktop/src/renderer/mafw/components/tool-cards/rule-model.ts packages/desktop/src/renderer/mafw/components/tool-cards/rule-model.test.ts packages/desktop/src/renderer/mafw/components/tool-cards/automation.tsx
git commit -m "feat(desktop): rule card status badges (valid/count/status)"
```

---

## W3 — 动效

### Task 5: 展开高度动效 + shimmer 放行

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/components/tool-cards/shared.tsx` / `memory-read.tsx` / `memory-write.tsx` / `automation.tsx` / `python.tsx`（`BasicTool` 加 `animated`）

**Interfaces:**
- Consumes: Task 2 的 `.mafw-tool-box`。

- [ ] **Step 1: 给所有 MAFW 卡开 animated**

在每个 `BasicTool` 上新增 `animated`（`familyCard` + 4 自绘卡）：

```tsx
      <BasicTool
        icon={spec.icon as any}
        trigger={{ /* ... */ }}
        status={props.status}
        defaultOpen={spec.defaultOpen}
        animated
      >
```

（`python.tsx` 里两个 `BasicTool` 同样加 `animated`。）

- [ ] **Step 2: shimmer 放行契约 + 运行**

触发行标题的颜色由 `basic-tool.css` 的 `TextShimmer`/title 控制；MAFW 覆盖只改了字号/粗细（Task 1），未覆盖 shimmer 渐变，故进行态 shimmer 应已可见。加一条契约锁定「不覆盖 title 的 color 到非 shimmer」：

在 `tool-card-css.test.ts` 追加：

```ts
test("trigger title keeps base color (shimmer not clobbered)", () => {
  expect(css).toMatch(/\[data-slot="basic-tool-tool-title"\]\s*\{[^}]*color:\s*var\(--text-1\)/)
})
```

Run: `cd packages/desktop && bun test src/renderer/mafw/tool-card-css.test.ts`
Expected: PASS。

- [ ] **Step 3: 全量 + 构建 + 提交**

Run: `cd packages/desktop && bun test && npx electron-vite build`
Expected: 全绿 + 构建成功。

```bash
git add packages/desktop/src/renderer/mafw/components/tool-cards/shared.tsx packages/desktop/src/renderer/mafw/components/tool-cards/memory-read.tsx packages/desktop/src/renderer/mafw/components/tool-cards/memory-write.tsx packages/desktop/src/renderer/mafw/components/tool-cards/automation.tsx packages/desktop/src/renderer/mafw/components/tool-cards/python.tsx packages/desktop/src/renderer/mafw/tool-card-css.test.ts
git commit -m "feat(desktop): tool card expand height animation (BasicTool animated)"
```

---

## W4 — 收口

### Task 6: 文档 + 全量验收

**Files:**
- Modify: `AGENTS.md`（§5.5 工具卡条目追加 v8 说明）

- [ ] **Step 1: 更新 AGENTS.md §5.5**

在工具卡条目末尾追加：

```
；**v8 美化**（2026-10-11，spec `docs/superpowers/specs/2026-10-11-tool-card-polish-design.md`）：触发行 26px/标题 13px `--text-1`/args `key=value`；内容体 `.mafw-tool-box`（0.5px 描边 + `--r-md` + `--bg-inset`）替代左竖线缩进；status badge（`ToolCardSpec.badge` → `trigger.action`，verdict/valid/count/status）；`BasicTool animated` 高度动效。对标六家见 `docs/research/2026-10-11-tool-call-rendering-survey.md`
```

- [ ] **Step 2: 全量 + 构建 + tsgo**

Run: `cd packages/desktop && bun test && npx electron-vite build`
Expected: 全绿 + 构建成功。

Run: `cd packages/desktop && npx tsgo -b`
Expected: 仅既有他人 WIP 报错（`tool-cards/automation.tsx` 若仍有 MarginBottom 报错为**既有**，`tool-cards/python.tsx` icon 报错**既有**，`ui/src/context/marked.tsx`），本 v8 文件 0 报错。

- [ ] **Step 3: 人工双主题验收（用户）**

`mafw restart-agent` / 重启 electron 后目视：触发行更清晰（标题亮、args 弱）、展开是描边盒、goal/rule 卡右侧有状态徽标、展开有高度过渡。

- [ ] **Step 4: 提交**

```bash
git add AGENTS.md
git commit -m "docs: AGENTS.md §5.5 — tool card polish v8"
```

---

## 自审（spec 覆盖）

| spec 项 | 对应 task |
|---|---|
| §3.1 触发行结构化（26px/标题/args/active/徽标位） | Task 1, 3 |
| §3.2 内容体 surface 盒 + mono + 去左竖线 | Task 2 |
| §3.3 展开高度动效 + 进行态 shimmer | Task 5 |
| §3.4 全工具卡统一 + 徽标补高频 | Task 1–5 |
| 测试（CSS 契约 + badge 纯逻辑） | Task 1, 2, 3, 4 |
| 非目标（图标/档案/dsh/拟人/解析改动） | 全局约束 + 无相关 task |
