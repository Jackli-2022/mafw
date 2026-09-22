# mafw_* 全工具专属卡片 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** desktop ChatView 的全部 44 个第一方 mafw_* 工具（39 gateway MCP + 5 插件侧）都拥有按语义定制的专属工具卡片，消灭 GenericTool 兜底与 JSON dump 泛用卡。

**Architecture:** 旧 `MafwToolCards.tsx` 拆为 `tool-cards/` 目录：30 个工具走「族组件 + 纯数据 spec」（`extract.ts` 的 `TOOL_SPECS` + `shared.tsx` 的 `familyCard` 工厂），14 个注册位保留 bespoke 组件（search/add_memory/deltas/python×2/rule×9）原样迁入。注册时机不变：`MafwShell.tsx` 先于 `registerUserPluginCards()` 调用。

**Tech Stack:** SolidJS + `@mafw/session-ui`（ToolRegistry/BasicTool）+ bun test。

**Spec:** `docs/superpowers/specs/2026-09-22-mafw-tool-cards-design.md`

## Global Constraints

- 测试用 `bun:test` 风格（`import { describe, expect, test } from "bun:test"`），测试文件与源码同目录 `.test.ts`
- `extract.ts` 必须是**纯 TS 零 Solid 依赖**（bun 可测）；Solid 组件只在 `.tsx` 文件
- 图标只允许用代码库已出现过的 `@mafw/ui` Icon 名：`magnifying-glass-menu`、`magnifying-glass`、`brain`、`pencil-line`、`sliders`、`warning`、`terminal`、`rotate-ccw`、`checklist`、`edit`、`folder`、`archive`、`glasses`、`models`、`help`、`comment`、`branch`、`bullet-list`、`menu`、`enter`、`check`、`mcp`
- 卡片渲染**绝不抛出**：extract 失败/字段缺失一律 fail-soft（`?? "-"`、跳过该段、raw code 段兜底）
- `error` 状态由 session-ui `ToolErrorCard` 旁路（`packages/session-ui/src/components/message-part.tsx:1649`），卡片代码不处理
- 不改 gateway、不改 session-ui、不改用户插件优先级（`override:true` 仍可覆盖任何内置卡）
- 每任务结束 commit；最终任务跑 `npm run test:desktop`（root）+ `cd packages/desktop && npx electron-vite build`

---

### Task 1: extract.ts 纯核心 — 类型 + 解析辅助 + memory-write 族 5 specs

**Files:**
- Create: `packages/desktop/src/renderer/mafw/components/tool-cards/extract.ts`
- Test: `packages/desktop/src/renderer/mafw/components/tool-cards/extract.test.ts`

**Interfaces:**
- Produces: `Section`、`ListItem`、`ToolCardSpec`、`TOOL_SPECS: Record<string, ToolCardSpec>`、`parseOut(output: string | undefined): any`、`trunc(v: any, n: number): string`、`s(v: any, fb?: any): string`——后续所有任务向 `TOOL_SPECS` 追加条目，`shared.tsx`（Task 2）消费这些类型。

- [ ] **Step 1: Write the failing test**

```ts
// packages/desktop/src/renderer/mafw/components/tool-cards/extract.test.ts
import { describe, expect, test } from "bun:test"
import { TOOL_SPECS, parseOut, trunc, s } from "./extract"

describe("helpers", () => {
  test("parseOut：合法 JSON 解析，非法/空 → undefined", () => {
    expect(parseOut('{"a":1}')).toEqual({ a: 1 })
    expect(parseOut("not json")).toBeUndefined()
    expect(parseOut(undefined)).toBeUndefined()
    expect(parseOut("")).toBeUndefined()
  })
  test("trunc：超长截断加省略号", () => {
    expect(trunc("abcdef", 3)).toBe("abc…")
    expect(trunc("ab", 3)).toBe("ab")
    expect(trunc(undefined, 3)).toBe("")
  })
  test("s：缺失值回退", () => {
    expect(s(undefined)).toBe("-")
    expect(s(null)).toBe("-")
    expect(s("")).toBe("-")
    expect(s(0)).toBe("0")
    expect(s(undefined, 200)).toBe("200")
  })
})

describe("memory-write specs", () => {
  test("mafw_supersede_memory：ids 列表 + reason", () => {
    const secs = TOOL_SPECS.mafw_supersede_memory.extract(
      { ids: ["mem_1", "mem_2"], reason: "过期" }, undefined)
    expect(secs[0].kind).toBe("kv")
    const rows = (secs[0] as any).rows as Array<[string, string]>
    expect(rows[0][1]).toBe("mem_1, mem_2")
    expect(rows[1][1]).toBe("过期")
  })
  test("mafw_supersede_memory：字段缺失 fail-soft", () => {
    const secs = TOOL_SPECS.mafw_supersede_memory.extract({}, undefined)
    const rows = (secs[0] as any).rows as Array<[string, string]>
    expect(rows[0][1]).toBe("-")
  })
  test("mafw_pin_memory：sticky 上板徽标", () => {
    const secs = TOOL_SPECS.mafw_pin_memory.extract(
      { id: "mem_abc", sticky: true, stickyDays: 3 }, undefined)
    const tags = secs.find((x) => x.kind === "tags") as any
    expect(tags.items.join(" ")).toContain("sticky 3 天")
  })
  test("mafw_merge_memory：output JSON 提取统计", () => {
    const secs = TOOL_SPECS.mafw_merge_memory.extract(
      { sourceWorktree: "/tmp/wt" },
      JSON.stringify({ extracted: 5, conflicts: 2 }))
    const rows = (secs[0] as any).rows as Array<[string, string]>
    expect(rows.map((r) => r[0])).toContain("提取")
    expect(rows.map((r) => r[0])).toContain("冲突")
  })
  test("mafw_merge_memory：畸形 output 降级 raw code 段", () => {
    const secs = TOOL_SPECS.mafw_merge_memory.extract({ sourceWorktree: "/tmp/wt" }, "oops")
    expect(secs.some((x) => x.kind === "code" && (x as any).text === "oops")).toBe(true)
  })
  test("mafw_resolve_merge：三字段 KV", () => {
    const secs = TOOL_SPECS.mafw_resolve_merge.extract(
      { conflictingId: "mem_x", newAbstraction: "合并摘要", action: "merge" }, undefined)
    const rows = (secs[0] as any).rows as Array<[string, string]>
    expect(rows[2]).toEqual(["动作", "merge"])
  })
  test("mafw_commit_heuristic：pattern 文本 + triggerContext tags", () => {
    const secs = TOOL_SPECS.mafw_commit_heuristic.extract(
      { pattern: "总是先跑测试", triggerContext: ["tdd", "test"] }, undefined)
    expect(secs[0]).toEqual({ kind: "text", text: "总是先跑测试" })
    expect((secs[1] as any).items).toEqual(["tdd", "test"])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/desktop && bun test src/renderer/mafw/components/tool-cards/extract.test.ts`
Expected: FAIL（`Cannot find module "./extract"`）

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/desktop/src/renderer/mafw/components/tool-cards/extract.ts
export type Section =
  | { kind: "kv"; rows: Array<[string, string]> }
  | { kind: "tags"; items: string[] }
  | { kind: "text"; text: string; tone?: "muted" | "warn" | "error" }
  | { kind: "code"; text: string; language?: string }
  | { kind: "list"; items: ListItem[] }

export interface ListItem {
  title: string
  subtitle?: string
  badge?: string
  badgeTone?: "ok" | "warn" | "err" | "muted" | "accent"
}

export interface ToolCardSpec {
  icon: string
  title: string
  subtitle?: (input: any) => string | undefined
  defaultOpen?: boolean
  extract: (input: any, output: string | undefined) => Section[]
}

export const s = (v: any, fb: any = "-"): string =>
  v === undefined || v === null || v === "" ? String(fb) : String(v)

export const trunc = (v: any, n: number): string => {
  const x = s(v, "")
  return x.length > n ? x.slice(0, n) + "…" : x
}

export function parseOut(output: string | undefined): any {
  if (!output) return undefined
  try { return JSON.parse(output) } catch { return undefined }
}

function rawSection(output: string | undefined): Section[] {
  return output ? [{ kind: "code", text: output }] : []
}

export const TOOL_SPECS: Record<string, ToolCardSpec> = {
  // ── 记忆写入族 ──────────────────────────────────────────────
  mafw_supersede_memory: {
    icon: "archive", title: "记忆取代",
    subtitle: (i) => (Array.isArray(i?.ids) ? `${i.ids.length} 条` : undefined),
    extract: (i) => [{
      kind: "kv",
      rows: [
        ["被取代 id", Array.isArray(i?.ids) ? i.ids.join(", ") : s(i?.ids)],
        ["原因", s(i?.reason)],
      ],
    }],
  },
  mafw_pin_memory: {
    icon: "check", title: "记忆 Pin / 便签",
    subtitle: (i) => i?.id,
    extract: (i) => {
      const secs: Section[] = [{
        kind: "kv",
        rows: [
          ["id", s(i?.id)],
          ["pinned", i?.pinned === undefined ? "-" : i.pinned ? "是" : "否"],
        ],
      }]
      const tags: string[] = []
      if (i?.sticky === true) tags.push(`sticky ${i?.stickyDays ?? 7} 天`)
      if (i?.sticky === false) tags.push("下架便签")
      if (tags.length) secs.push({ kind: "tags", items: tags })
      return secs
    },
  },
  mafw_merge_memory: {
    icon: "branch", title: "跨 worktree 记忆融合",
    subtitle: (i) => i?.sourceWorktree,
    extract: (i, o) => {
      const p = parseOut(o)
      if (!p || typeof p !== "object") return rawSection(o)
      return [{
        kind: "kv",
        rows: [
          ["来源", s(i?.sourceWorktree)],
          ["策略", s(i?.resolveStrategy, "manual")],
          ["提取", s(p.extracted ?? p.merged)],
          ["冲突", s(p.conflicts ?? p.conflicting)],
        ],
      }]
    },
  },
  mafw_resolve_merge: {
    icon: "branch", title: "解决融合冲突",
    subtitle: (i) => i?.conflictingId,
    extract: (i) => [{
      kind: "kv",
      rows: [
        ["冲突 id", s(i?.conflictingId)],
        ["新摘要", s(i?.newAbstraction)],
        ["动作", s(i?.action)],
      ],
    }],
  },
  mafw_commit_heuristic: {
    icon: "archive", title: "提交 L5 启发式",
    subtitle: (i) => trunc(i?.pattern, 50),
    extract: (i) => {
      const secs: Section[] = [{ kind: "text", text: s(i?.pattern) }]
      if (Array.isArray(i?.triggerContext) && i.triggerContext.length)
        secs.push({ kind: "tags", items: i.triggerContext.map(String) })
      return secs
    },
  },
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/desktop && bun test src/renderer/mafw/components/tool-cards/extract.test.ts`
Expected: PASS（8 tests）

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/mafw/components/tool-cards/extract.ts packages/desktop/src/renderer/mafw/components/tool-cards/extract.test.ts
git commit -m "feat(desktop): tool-cards extract core + memory-write specs"
```

---

### Task 2: shared.tsx 渲染器 — familyCard 工厂 + SectionView

**Files:**
- Create: `packages/desktop/src/renderer/mafw/components/tool-cards/shared.tsx`
- Create: `packages/desktop/src/renderer/mafw/components/tool-cards/index.ts`

**Interfaces:**
- Consumes: `Section`、`ToolCardSpec`、`TOOL_SPECS`（Task 1）；`BasicTool`（`@mafw/session-ui/basic-tool`，props: `icon/trigger{title,subtitle,args}/status/defaultOpen/children`）；`ToolRegistry`、`ToolProps`（`@mafw/session-ui/message-part`）
- Produces: `familyCard(spec: ToolCardSpec): Component<ToolProps>`；`registerMafwToolCards()`（本任务只注册 `TOOL_SPECS` 现有条目，bespoke 注册在 Task 8 加入）

- [ ] **Step 1: Write the implementation（Solid 渲染需 DOM，无单测；由 Task 9 的 electron-vite build 类型检查兜底）**

```tsx
// packages/desktop/src/renderer/mafw/components/tool-cards/shared.tsx
import { For, Show, type Component } from "solid-js"
import { BasicTool } from "@mafw/session-ui/basic-tool"
import type { ToolProps } from "@mafw/session-ui/message-part"
import type { ListItem, Section, ToolCardSpec } from "./extract"

const BADGE_STYLE: Record<string, any> = {
  ok: { background: "var(--accent-bg)", color: "var(--accent)" },
  accent: { background: "var(--accent-bg)", color: "var(--accent)" },
  warn: { background: "rgba(232,184,75,0.15)", color: "#e8b84b" },
  err: { background: "rgba(232,99,107,0.15)", color: "#e8636b" },
  muted: { background: "transparent", color: "var(--text-muted)" },
}

function Badge(props: { text: string; tone?: string }) {
  return (
    <span class="mafw-tool-tag" style={{ "border": "0.5px solid var(--border-base)", ...(BADGE_STYLE[props.tone || "muted"] || BADGE_STYLE.muted) }}>
      {props.text}
    </span>
  )
}

function SectionView(props: { section: Section }) {
  const sec = () => props.section
  return (
    <>
      <Show when={sec().kind === "kv"}>
        <div class="mafw-tool-meta-grid">
          <For each={(sec() as any).rows}>
            {(row: [string, string]) => (
              <div class="mafw-tool-meta">
                <span class="mafw-tool-meta-label">{row[0]}</span>
                {row[1]}
              </div>
            )}
          </For>
        </div>
      </Show>
      <Show when={sec().kind === "tags"}>
        <div class="mafw-tool-anchors">
          <For each={(sec() as any).items}>
            {(t: string) => <span class="mafw-tool-chip">{t}</span>}
          </For>
        </div>
      </Show>
      <Show when={sec().kind === "text"}>
        <div class="mafw-tool-meta" style={{
          color: (sec() as any).tone === "error" ? "#e8636b"
            : (sec() as any).tone === "warn" ? "#e8b84b"
            : (sec() as any).tone === "muted" ? "var(--text-muted)" : undefined,
        }}>{(sec() as any).text}</div>
      </Show>
      <Show when={sec().kind === "code"}>
        <pre class="mafw-tool-output">{(sec() as any).text}</pre>
      </Show>
      <Show when={sec().kind === "list"}>
        <div class="mafw-tool-results">
          <For each={(sec() as any).items}>
            {(item: ListItem) => (
              <div class="mafw-tool-result">
                <div style={{ flex: 1 }}>
                  <div class="mafw-tool-result-text">{item.title}</div>
                  <Show when={item.subtitle}>
                    <div class="mafw-tool-meta" style="font-size:11px">{item.subtitle}</div>
                  </Show>
                </div>
                <Show when={item.badge}>
                  <Badge text={item.badge!} tone={item.badgeTone} />
                </Show>
              </div>
            )}
          </For>
        </div>
      </Show>
    </>
  )
}

export function familyCard(spec: ToolCardSpec): Component<ToolProps> {
  return (props) => {
    const sections = (): Section[] => {
      if (props.status !== "completed" || !props.output) return []
      try {
        return spec.extract(props.input, props.output)
      } catch (e) {
        console.warn("[mafw]", e)
        return [{ kind: "code", text: String(props.output) }]
      }
    }
    return (
      <BasicTool
        icon={spec.icon as any}
        trigger={{ title: spec.title, subtitle: spec.subtitle?.(props.input) }}
        status={props.status}
        defaultOpen={spec.defaultOpen}
      >
        <For each={sections()}>{(sec) => <SectionView section={sec} />}</For>
        <Show when={props.status === "completed" && sections().length === 0}>
          <div class="mafw-tool-empty">(无输出)</div>
        </Show>
      </BasicTool>
    )
  }
}
```

```ts
// packages/desktop/src/renderer/mafw/components/tool-cards/index.ts
import { ToolRegistry } from "@mafw/session-ui/message-part"
import { TOOL_SPECS } from "./extract"
import { familyCard } from "./shared"

export function registerMafwToolCards() {
  for (const [name, spec] of Object.entries(TOOL_SPECS)) {
    ToolRegistry.register({ name, render: familyCard(spec) })
  }
}
```

- [ ] **Step 2: Verify compile**

Run: `cd packages/desktop && npx electron-vite build`
Expected: build 成功（renderer 段无 TS 错误）

- [ ] **Step 3: Commit**

```bash
git add packages/desktop/src/renderer/mafw/components/tool-cards/shared.tsx packages/desktop/src/renderer/mafw/components/tool-cards/index.ts
git commit -m "feat(desktop): tool-cards familyCard renderer + registry entry"
```

---

### Task 3: memory-read 族 specs（get_memory / get_axioms）

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/components/tool-cards/extract.ts`（`TOOL_SPECS` 追加 2 条）
- Test: `packages/desktop/src/renderer/mafw/components/tool-cards/extract.test.ts`

**Interfaces:**
- Consumes: `TOOL_SPECS`、`Section`、`parseOut`、`s`、`trunc`、`rawSection`（注意：`rawSection` 目前是 module-private——本任务需把它 export）

- [ ] **Step 1: Write the failing test（追加到 extract.test.ts）**

```ts
describe("memory-read specs", () => {
  test("mafw_get_memory：KV + anchors + 全文段", () => {
    const mem = {
      id: "mem_abc", type: "semantic", energy: 0.9,
      cue_anchors: ["tdd", "发布"], memory_value: "用户偏好 TDD",
    }
    const secs = TOOL_SPECS.mafw_get_memory.extract({ id: "mem_abc" }, JSON.stringify(mem))
    const kv = secs[0] as any
    expect(kv.rows.map((r: any) => r[0])).toEqual(["id", "类型", "能量", "pinned", "sticky"])
    expect((secs[1] as any).items).toEqual(["tdd", "发布"])
    expect((secs[2] as any).text).toBe("用户偏好 TDD")
  })
  test("mafw_get_memory：superseded 警告行", () => {
    const secs = TOOL_SPECS.mafw_get_memory.extract({}, JSON.stringify({ id: "m1", superseded_by: "m2" }))
    const warn = secs.find((x) => x.kind === "text") as any
    expect(warn.tone).toBe("warn")
    expect(warn.text).toContain("m2")
  })
  test("mafw_get_memory：非 JSON output 降级 raw", () => {
    const secs = TOOL_SPECS.mafw_get_memory.extract({}, "plain text")
    expect(secs[0]).toEqual({ kind: "code", text: "plain text" })
  })
  test("mafw_get_axioms：数组 → list 带能量徽标", () => {
    const secs = TOOL_SPECS.mafw_get_axioms.extract({}, JSON.stringify([
      { pattern: "先验证再宣称完成", energy: 0.85 },
      { primary_abstraction: "子代理不写记忆", energy: 0.6 },
    ]))
    const items = (secs[0] as any).items
    expect(items[0].title).toBe("先验证再宣称完成")
    expect(items[0].badge).toBe("E:0.9")
    expect(items[1].title).toBe("子代理不写记忆")
  })
  test("mafw_get_axioms：{axioms:[...]} 信封兼容", () => {
    const secs = TOOL_SPECS.mafw_get_axioms.extract({}, JSON.stringify({ axioms: [{ pattern: "p", energy: 1 }] }))
    expect((secs[0] as any).items).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/desktop && bun test src/renderer/mafw/components/tool-cards/extract.test.ts`
Expected: FAIL（`TOOL_SPECS.mafw_get_memory is undefined`）

- [ ] **Step 3: Implement（extract.ts 中把 `rawSection` 改为 `export function`，并在 `TOOL_SPECS` 追加）**

```ts
  // ── 记忆检索族 ──────────────────────────────────────────────
  mafw_get_memory: {
    icon: "brain", title: "记忆全文",
    subtitle: (i) => trunc(i?.id, 24),
    extract: (i, o) => {
      const p = parseOut(o)
      if (!p || typeof p !== "object") return rawSection(o)
      const m = p.memory ?? p
      const secs: Section[] = [{
        kind: "kv",
        rows: [
          ["id", s(m.id ?? i?.id)],
          ["类型", s(m.type)],
          ["能量", s(m.energy)],
          ["pinned", m.pinned ? "是" : "-"],
          ["sticky", s(m.sticky_until)],
        ],
      }]
      if (Array.isArray(m.cue_anchors) && m.cue_anchors.length)
        secs.push({ kind: "tags", items: m.cue_anchors.map(String) })
      if (m.memory_value)
        secs.push({ kind: "code", text: trunc(m.memory_value, 2000), language: "markdown" })
      if (m.superseded_by)
        secs.push({ kind: "text", text: `已被取代 → ${m.superseded_by}`, tone: "warn" })
      return secs
    },
  },
  mafw_get_axioms: {
    icon: "glasses", title: "L5 公理",
    extract: (_i, o) => {
      const p = parseOut(o)
      const arr = Array.isArray(p) ? p : p?.axioms ?? p?.heuristics
      if (!Array.isArray(arr)) return rawSection(o)
      return [{
        kind: "list",
        items: arr.map((a: any) => ({
          title: s(a.pattern ?? a.primary_abstraction ?? a.content),
          badge: a.energy != null ? `E:${Number(a.energy).toFixed(1)}` : undefined,
          badgeTone: "accent" as const,
        })),
      }]
    },
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/desktop && bun test src/renderer/mafw/components/tool-cards/extract.test.ts`
Expected: PASS（13 tests）

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/mafw/components/tool-cards/extract.ts packages/desktop/src/renderer/mafw/components/tool-cards/extract.test.ts
git commit -m "feat(desktop): memory-read specs (get_memory, get_axioms)"
```

---

### Task 4: goal 族 specs（10 工具）

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/components/tool-cards/extract.ts`
- Test: `packages/desktop/src/renderer/mafw/components/tool-cards/extract.test.ts`

**Interfaces:**
- Consumes: 同 Task 3。goal verdict→badgeTone 映射：`COMPLETED→ok`、`FAILED/CANCELLED→err`、其他→`accent`。

- [ ] **Step 1: Write the failing test（追加）**

```ts
describe("goal specs", () => {
  test("mafw_create_goal：KV 五字段", () => {
    const secs = TOOL_SPECS.mafw_create_goal.extract(
      { goalId: "003-foo", title: "做卡片", priority: "high", maxLoops: 5,
        budget: { maxTurns: 30, maxCostUsd: 2 } }, undefined)
    const rows = (secs[0] as any).rows as Array<[string, string]>
    expect(rows[0]).toEqual(["Goal", "003-foo"])
    expect(rows[4]).toEqual(["预算", "30 轮 / $2"])
  })
  test("mafw_get_goal_status：解析 output 阶段/判定", () => {
    const secs = TOOL_SPECS.mafw_get_goal_status.extract(
      { goalId: "g1" }, JSON.stringify({ goalId: "g1", phase: "EXECUTING", verdict: "PASS", loopNum: 2 }))
    const rows = (secs[0] as any).rows as Array<[string, string]>
    expect(rows[1]).toEqual(["阶段", "EXECUTING"])
    expect(rows[2]).toEqual(["判定", "PASS"])
  })
  test("mafw_list_goals：list + verdict 着色", () => {
    const secs = TOOL_SPECS.mafw_list_goals.extract({}, JSON.stringify([
      { goalId: "g1", title: "A", phase: "EXECUTING" },
      { goalId: "g2", title: "B", verdict: "FAILED" },
    ]))
    const items = (secs[0] as any).items
    expect(items).toHaveLength(2)
    expect(items[0].badge).toBe("EXECUTING")
    expect(items[1].badgeTone).toBe("err")
  })
  test("mafw_get_evidence：长文本 code 段截断", () => {
    const long = "x".repeat(5000)
    const secs = TOOL_SPECS.mafw_get_evidence.extract({ goalId: "g1" }, long)
    expect(secs[0].kind).toBe("code")
    expect((secs[0] as any).text.length).toBeLessThan(4200)
  })
  test("mafw_update_state：goalId + patch code 段", () => {
    const secs = TOOL_SPECS.mafw_update_state.extract(
      { goalId: "g1", patch: { loopNum: 3 } }, undefined)
    expect((secs[0] as any).rows[0]).toEqual(["Goal", "g1"])
    expect((secs[1] as any).text).toContain("loopNum")
  })
  test("mafw_load_state：output pretty code 段", () => {
    const secs = TOOL_SPECS.mafw_load_state.extract(
      { goalId: "g1" }, JSON.stringify({ goalId: "g1", loopNum: 1 }))
    expect(secs[0].kind).toBe("code")
    expect((secs[0] as any).text).toContain("loopNum")
  })
  test("mafw_answer_question：questionId + answer", () => {
    const secs = TOOL_SPECS.mafw_answer_question.extract(
      { goalId: "g1", questionId: "q9", answer: "选 A" }, undefined)
    const rows = (secs[0] as any).rows as Array<[string, string]>
    expect(rows[1]).toEqual(["问题", "q9"])
    expect(rows[2]).toEqual(["回答", "选 A"])
  })
  test("mafw_list_pending_questions：list 带 goalId 徽标", () => {
    const secs = TOOL_SPECS.mafw_list_pending_questions.extract({}, JSON.stringify([
      { id: "q1", question: "继续吗？", goalId: "g1" },
    ]))
    const items = (secs[0] as any).items
    expect(items[0].title).toBe("继续吗？")
    expect(items[0].badge).toBe("g1")
  })
  test("mafw_set_goal / mafw_cancel_goal：KV", () => {
    const a = TOOL_SPECS.mafw_set_goal.extract({ goalId: "g1", title: "T" }, undefined)
    expect((a[0] as any).rows[0]).toEqual(["Goal", "g1"])
    const b = TOOL_SPECS.mafw_cancel_goal.extract({ goalId: "g1" }, "cancelled")
    expect((b[0] as any).rows[0]).toEqual(["Goal", "g1"])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/desktop && bun test src/renderer/mafw/components/tool-cards/extract.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement（`TOOL_SPECS` 追加；文件顶部加 verdict→tone 辅助）**

```ts
const verdictTone = (v: any): ListItem["badgeTone"] => {
  const x = String(v ?? "").toUpperCase()
  if (x === "COMPLETED" || x === "PASS") return "ok"
  if (x === "FAILED" || x === "CANCELLED" || x === "FAIL") return "err"
  return "accent"
}
```

```ts
  // ── Goal 编排族 ─────────────────────────────────────────────
  mafw_create_goal: {
    icon: "checklist", title: "创建 Goal",
    subtitle: (i) => i?.goalId,
    extract: (i) => [{
      kind: "kv",
      rows: [
        ["Goal", s(i?.goalId)],
        ["标题", s(i?.title)],
        ["优先级", s(i?.priority, "medium")],
        ["最大循环", s(i?.maxLoops, 5)],
        ["预算", i?.budget ? `${i.budget.maxTurns ?? "-"} 轮 / $${i.budget.maxCostUsd ?? "-"}` : "-"],
      ],
    }],
  },
  mafw_set_goal: {
    icon: "checklist", title: "设置 Goal",
    subtitle: (i) => i?.goalId,
    extract: (i) => [{
      kind: "kv",
      rows: [
        ["Goal", s(i?.goalId)],
        ["标题", s(i?.title)],
        ["优先级", s(i?.priority, "medium")],
        ["最大循环", s(i?.maxLoops, 5)],
        ["预算", i?.budget ? `${i.budget.maxTurns ?? "-"} 轮 / $${i.budget.maxCostUsd ?? "-"}` : "-"],
      ],
    }],
  },
  mafw_get_goal_status: {
    icon: "magnifying-glass", title: "Goal 状态",
    subtitle: (i) => i?.goalId,
    extract: (i, o) => {
      const p = parseOut(o)
      if (!p || typeof p !== "object") return rawSection(o)
      return [{
        kind: "kv",
        rows: [
          ["Goal", s(p.goalId ?? i?.goalId)],
          ["阶段", s(p.phase)],
          ["判定", s(p.verdict)],
          ["循环", s(p.loopNum ?? p.loop)],
        ],
      }]
    },
  },
  mafw_list_goals: {
    icon: "bullet-list", title: "Goal 列表",
    extract: (_i, o) => {
      const p = parseOut(o)
      const arr = Array.isArray(p) ? p : p?.goals
      if (!Array.isArray(arr)) return rawSection(o)
      return [{
        kind: "list",
        items: arr.map((g: any) => ({
          title: s(g.title ?? g.goalId ?? g.id),
          subtitle: g.title ? s(g.goalId ?? g.id, "") : undefined,
          badge: s(g.phase ?? g.verdict, ""),
          badgeTone: verdictTone(g.verdict ?? g.phase),
        })),
      }]
    },
  },
  mafw_cancel_goal: {
    icon: "warning", title: "取消 Goal",
    subtitle: (i) => i?.goalId,
    extract: (i, o) => {
      const secs: Section[] = [{ kind: "kv", rows: [["Goal", s(i?.goalId)]] }]
      if (o) secs.push({ kind: "text", text: trunc(o, 200), tone: "muted" })
      return secs
    },
  },
  mafw_get_evidence: {
    icon: "folder", title: "Goal 证据",
    subtitle: (i) => i?.goalId,
    extract: (_i, o) => (o ? [{ kind: "code", text: trunc(o, 4000), language: "markdown" }] : []),
  },
  mafw_update_state: {
    icon: "edit", title: "更新 Goal 状态",
    subtitle: (i) => i?.goalId,
    extract: (i) => {
      const secs: Section[] = [{ kind: "kv", rows: [["Goal", s(i?.goalId)]] }]
      if (i?.patch) secs.push({ kind: "code", text: JSON.stringify(i.patch, null, 2), language: "json" })
      return secs
    },
  },
  mafw_load_state: {
    icon: "folder", title: "读取 Goal 状态",
    subtitle: (i) => i?.goalId,
    extract: (_i, o) => {
      const p = parseOut(o)
      if (p === undefined) return rawSection(o)
      return [{ kind: "code", text: JSON.stringify(p, null, 2), language: "json" }]
    },
  },
  mafw_answer_question: {
    icon: "help", title: "回答 Goal 提问",
    subtitle: (i) => i?.questionId,
    extract: (i) => [{
      kind: "kv",
      rows: [
        ["Goal", s(i?.goalId)],
        ["问题", s(i?.questionId)],
        ["回答", s(i?.answer)],
      ],
    }],
  },
  mafw_list_pending_questions: {
    icon: "bullet-list", title: "待决问题",
    extract: (_i, o) => {
      const p = parseOut(o)
      const arr = Array.isArray(p) ? p : p?.questions
      if (!Array.isArray(arr)) return rawSection(o)
      return [{
        kind: "list",
        items: arr.map((q: any) => ({
          title: s(q.question ?? q.text ?? q.id),
          badge: s(q.goalId, ""),
          badgeTone: "accent" as const,
        })),
      }]
    },
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/desktop && bun test src/renderer/mafw/components/tool-cards/extract.test.ts`
Expected: PASS（22 tests）

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/mafw/components/tool-cards/extract.ts packages/desktop/src/renderer/mafw/components/tool-cards/extract.test.ts
git commit -m "feat(desktop): goal family specs (10 tools)"
```

---

### Task 5: interact 族 specs（ask_user / record_feedback / get_model_route）

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/components/tool-cards/extract.ts`
- Test: `packages/desktop/src/renderer/mafw/components/tool-cards/extract.test.ts`

**Interfaces:** 同 Task 4。

- [ ] **Step 1: Write the failing test（追加）**

```ts
describe("interact specs", () => {
  test("mafw_ask_user：问题文本 + options tags", () => {
    const secs = TOOL_SPECS.mafw_ask_user.extract(
      { question: "用哪种方案？", options: ["A", "B"], priority: "high" }, undefined)
    expect(secs[0]).toEqual({ kind: "text", text: "用哪种方案？" })
    expect((secs[1] as any).items).toEqual(["A", "B"])
  })
  test("mafw_ask_user：无 options 只有文本段", () => {
    const secs = TOOL_SPECS.mafw_ask_user.extract({ question: "继续？" }, undefined)
    expect(secs).toHaveLength(1)
  })
  test("mafw_record_feedback：KV 含类型/目标/备注", () => {
    const secs = TOOL_SPECS.mafw_record_feedback.extract(
      { type: "thumbs_up", targetId: "wave-1", goalId: "g1", loopNum: 2 }, undefined)
    const rows = (secs[0] as any).rows as Array<[string, string]>
    expect(rows[0]).toEqual(["类型", "👍 thumbs_up"])
    expect(rows[1]).toEqual(["目标", "wave-1"])
  })
  test("mafw_get_model_route：KV 预算 + 路由结果", () => {
    const secs = TOOL_SPECS.mafw_get_model_route.extract(
      { agentType: "execute", remainingBudget: 8000, totalBudget: 10000 },
      JSON.stringify({ model: "qwen3.7-max" }))
    const rows = (secs[0] as any).rows as Array<[string, string]>
    expect(rows[3]).toEqual(["路由", "qwen3.7-max"])
  })
  test("mafw_get_model_route：非 JSON output 不崩", () => {
    const secs = TOOL_SPECS.mafw_get_model_route.extract({ agentType: "plan" }, "weird")
    expect((secs[0] as any).rows[3]).toEqual(["路由", "weird"])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/desktop && bun test src/renderer/mafw/components/tool-cards/extract.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement（`TOOL_SPECS` 追加）**

```ts
  // ── 交互/反馈族 ─────────────────────────────────────────────
  mafw_ask_user: {
    icon: "help", title: "向用户提问",
    subtitle: (i) => trunc(i?.question, 50),
    extract: (i) => {
      const secs: Section[] = [{ kind: "text", text: s(i?.question) }]
      if (Array.isArray(i?.options) && i.options.length)
        secs.push({ kind: "tags", items: i.options.map(String) })
      return secs
    },
  },
  mafw_record_feedback: {
    icon: "comment", title: "记录反馈",
    subtitle: (i) => i?.type,
    extract: (i) => {
      const mark = i?.type === "thumbs_up" ? "👍" : i?.type === "thumbs_down" ? "👎" : "✏️"
      return [{
        kind: "kv",
        rows: [
          ["类型", `${mark} ${s(i?.type)}`],
          ["目标", s(i?.targetId)],
          ["Goal", s(i?.goalId)],
          ["循环", s(i?.loopNum)],
          ["备注", s(i?.comment)],
        ],
      }]
    },
  },
  mafw_get_model_route: {
    icon: "models", title: "模型路由",
    subtitle: (i) => i?.agentType,
    extract: (i, o) => {
      const p = parseOut(o)
      const route = p && typeof p === "object" ? s(p.model ?? p.route) : s(o)
      return [{
        kind: "kv",
        rows: [
          ["Agent", s(i?.agentType)],
          ["剩余预算", s(i?.remainingBudget)],
          ["总预算", s(i?.totalBudget)],
          ["路由", route],
        ],
      }]
    },
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/desktop && bun test src/renderer/mafw/components/tool-cards/extract.test.ts`
Expected: PASS（27 tests）

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/mafw/components/tool-cards/extract.ts packages/desktop/src/renderer/mafw/components/tool-cards/extract.test.ts
git commit -m "feat(desktop): interact family specs (ask_user, record_feedback, model_route)"
```

---

### Task 6: desktop 控制族 specs（6 desktop_* + restart_agent）

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/components/tool-cards/extract.ts`
- Test: `packages/desktop/src/renderer/mafw/components/tool-cards/extract.test.ts`

**Interfaces:** 同 Task 4。

- [ ] **Step 1: Write the failing test（追加）**

```ts
describe("desktop control specs", () => {
  test("mafw_desktop_screenshot：文件路径 KV", () => {
    const secs = TOOL_SPECS.mafw_desktop_screenshot.extract(
      { selector: ".mafw-content" },
      JSON.stringify({ path: ".mafw/screenshots/x.png" }))
    const rows = (secs[0] as any).rows as Array<[string, string]>
    expect(rows[0]).toEqual(["区域", ".mafw-content"])
    expect(rows[1][1]).toContain("x.png")
  })
  test("mafw_desktop_navigate：目标 tab", () => {
    const secs = TOOL_SPECS.mafw_desktop_navigate.extract({ tab: "goals" }, undefined)
    expect((secs[0] as any).rows[0]).toEqual(["目标 Tab", "goals"])
  })
  test("mafw_desktop_get_ui_state：元素数 + 窗口", () => {
    const secs = TOOL_SPECS.mafw_desktop_get_ui_state.extract({}, JSON.stringify({
      activeTab: "chat", elements: [1, 2, 3], window: { width: 1280, height: 800 },
    }))
    const rows = (secs[0] as any).rows as Array<[string, string]>
    expect(rows[1]).toEqual(["元素数", "3"])
    expect(rows[2]).toEqual(["窗口", "1280×800"])
  })
  test("mafw_desktop_click：selector + 命中", () => {
    const secs = TOOL_SPECS.mafw_desktop_click.extract(
      { selector: "#btn" }, JSON.stringify({ tag: "BUTTON", text: "确定" }))
    const rows = (secs[0] as any).rows as Array<[string, string]>
    expect(rows[0]).toEqual(["Selector", "#btn"])
    expect(rows[1][1]).toBe("BUTTON 确定")
  })
  test("mafw_desktop_type / scroll：KV", () => {
    const a = TOOL_SPECS.mafw_desktop_type.extract({ selector: "#in", text: "hello" }, undefined)
    expect((a[0] as any).rows[1]).toEqual(["文本", "hello"])
    const b = TOOL_SPECS.mafw_desktop_scroll.extract({ direction: "down", amount: 400 }, undefined)
    expect((b[0] as any).rows[0]).toEqual(["方向", "down"])
  })
  test("mafw_restart_agent：失败文本标 error tone", () => {
    const secs = TOOL_SPECS.mafw_restart_agent.extract({}, "restart failed: 503")
    expect((secs[0] as any).tone).toBe("error")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/desktop && bun test src/renderer/mafw/components/tool-cards/extract.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement（`TOOL_SPECS` 追加）**

```ts
  // ── 桌面控制族 ──────────────────────────────────────────────
  mafw_desktop_screenshot: {
    icon: "magnifying-glass", title: "桌面截图",
    subtitle: (i) => i?.selector,
    extract: (i, o) => {
      const p = parseOut(o)
      if (p && typeof p === "object" && (p.path || p.file))
        return [{ kind: "kv", rows: [["区域", s(i?.selector, "全窗口")], ["文件", s(p.path ?? p.file)]] }]
      return rawSection(o)
    },
  },
  mafw_desktop_navigate: {
    icon: "menu", title: "桌面导航",
    subtitle: (i) => i?.tab,
    extract: (i) => [{ kind: "kv", rows: [["目标 Tab", s(i?.tab)]] }],
  },
  mafw_desktop_get_ui_state: {
    icon: "bullet-list", title: "桌面 UI 状态",
    extract: (_i, o) => {
      const p = parseOut(o)
      if (!p || typeof p !== "object") return rawSection(o)
      return [{
        kind: "kv",
        rows: [
          ["活跃 Tab", s(p.activeTab)],
          ["元素数", s(Array.isArray(p.elements) ? p.elements.length : p.elementCount)],
          ["窗口", p.window ? `${p.window.width}×${p.window.height}` : s(p.dimensions)],
        ],
      }]
    },
  },
  mafw_desktop_click: {
    icon: "enter", title: "桌面点击",
    subtitle: (i) => i?.selector,
    extract: (i, o) => {
      const p = parseOut(o)
      const hit = p && typeof p === "object" ? `${s(p.tag, "")} ${s(p.text, "")}`.trim() : ""
      return [{ kind: "kv", rows: [["Selector", s(i?.selector)], ["命中", hit || "-"]] }]
    },
  },
  mafw_desktop_type: {
    icon: "edit", title: "桌面输入",
    subtitle: (i) => trunc(i?.text, 40),
    extract: (i) => [{ kind: "kv", rows: [["Selector", s(i?.selector)], ["文本", trunc(i?.text, 80)]] }],
  },
  mafw_desktop_scroll: {
    icon: "menu", title: "桌面滚动",
    subtitle: (i) => `${s(i?.direction, "")} ${s(i?.amount, "")}`.trim(),
    extract: (i) => [{ kind: "kv", rows: [["方向", s(i?.direction)], ["像素", s(i?.amount, 200)]] }],
  },
  mafw_restart_agent: {
    icon: "rotate-ccw", title: "重启 Agent",
    extract: (_i, o) =>
      o ? [{ kind: "text", text: trunc(o, 200), tone: /fail|error|503/i.test(o) ? "error" as const : "muted" as const }] : [],
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/desktop && bun test src/renderer/mafw/components/tool-cards/extract.test.ts`
Expected: PASS（33 tests）

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/mafw/components/tool-cards/extract.ts packages/desktop/src/renderer/mafw/components/tool-cards/extract.test.ts
git commit -m "feat(desktop): desktop-control family specs (7 tools)"
```

---

### Task 7: media 族 specs（media_upload / media_ask / media_speak）

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/components/tool-cards/extract.ts`
- Test: `packages/desktop/src/renderer/mafw/components/tool-cards/extract.test.ts`

**Interfaces:** 同 Task 4。注意 `mafw_media_speak` 卡片纯展示（播放副作用由 `sse/handlers/chat-stream.ts` 负责，不在卡片内做任何播放逻辑）。

- [ ] **Step 1: Write the failing test（追加）**

```ts
describe("media specs", () => {
  test("mafw_media_upload：文件名 + taskID", () => {
    const secs = TOOL_SPECS.mafw_media_upload.extract(
      { mediaPath: "C:\\pics\\shot.png", question: "图里有啥" },
      JSON.stringify({ taskID: "t1", answer: "一只猫" }))
    const rows = (secs[0] as any).rows as Array<[string, string]>
    expect(rows[0]).toEqual(["文件", "shot.png"])
    expect(rows[1]).toEqual(["taskID", "t1"])
  })
  test("mafw_media_ask：问题 + 回答 + newTaskID 徽标", () => {
    const secs = TOOL_SPECS.mafw_media_ask.extract(
      { taskID: "t1", mediaPath: "", question: "细节？" },
      JSON.stringify({ answer: "更多细节", newTaskID: "t2" }))
    expect((secs[1] as any).text).toBe("更多细节")
    const tags = secs.find((x) => x.kind === "tags") as any
    expect(tags.items[0]).toContain("t2")
  })
  test("mafw_media_ask：纯文本 output 当回答", () => {
    const secs = TOOL_SPECS.mafw_media_ask.extract(
      { taskID: "t1", mediaPath: "", question: "？" }, "直接文本回答")
    expect(secs.some((x) => x.kind === "text" && (x as any).text === "直接文本回答")).toBe(true)
  })
  test("mafw_media_speak：音色 KV + 文本摘要", () => {
    const secs = TOOL_SPECS.mafw_media_speak.extract(
      { text: "你好世界", voice: "茉莉", style: "轻快" }, undefined)
    const rows = (secs[0] as any).rows as Array<[string, string]>
    expect(rows[0]).toEqual(["音色", "茉莉"])
    expect((secs[1] as any).text).toBe("你好世界")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/desktop && bun test src/renderer/mafw/components/tool-cards/extract.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement（`TOOL_SPECS` 追加）**

```ts
  // ── 媒体族 ─────────────────────────────────────────────────
  mafw_media_upload: {
    icon: "mcp", title: "媒体上传",
    subtitle: (i) => s(i?.mediaPath, "").split(/[\\/]/).pop() || undefined,
    extract: (i, o) => {
      const p = parseOut(o)
      return [{
        kind: "kv",
        rows: [
          ["文件", s(s(i?.mediaPath, "").split(/[\\/]/).pop())],
          ["taskID", s(p?.taskID ?? p?.taskId)],
          ["首问", trunc(i?.question, 60)],
          ["回答", trunc(p?.answer ?? p?.response, 200)],
        ],
      }]
    },
  },
  mafw_media_ask: {
    icon: "magnifying-glass", title: "媒体追问",
    subtitle: (i) => trunc(i?.question, 50),
    extract: (i, o) => {
      const p = parseOut(o)
      const secs: Section[] = [{
        kind: "kv",
        rows: [["taskID", s(i?.taskID)], ["问题", trunc(i?.question, 120)]],
      }]
      const ans = p?.answer ?? p?.output ?? (p === undefined && o ? o : undefined)
      if (ans) secs.push({ kind: "text", text: trunc(ans, 500) })
      if (p?.newTaskID) secs.push({ kind: "tags", items: [`新 taskID: ${p.newTaskID}`] })
      return secs
    },
  },
  mafw_media_speak: {
    icon: "comment", title: "语音回复",
    subtitle: (i) => trunc(i?.text, 50),
    extract: (i) => [
      { kind: "kv", rows: [["音色", s(i?.voice)], ["风格", s(i?.style)]] },
      { kind: "text", text: trunc(i?.text, 200) },
    ],
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/desktop && bun test src/renderer/mafw/components/tool-cards/extract.test.ts`
Expected: PASS（37 tests）

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/mafw/components/tool-cards/extract.ts packages/desktop/src/renderer/mafw/components/tool-cards/extract.test.ts
git commit -m "feat(desktop): media family specs (upload, ask, speak)"
```

---

### Task 8: bespoke 卡迁入族文件 + MafwShell 接线切换 + 删旧文件

**Files:**
- Create: `packages/desktop/src/renderer/mafw/components/tool-cards/memory-read.tsx`（MafwSearchCard）
- Create: `packages/desktop/src/renderer/mafw/components/tool-cards/memory-write.tsx`（MafwAddMemoryCard）
- Create: `packages/desktop/src/renderer/mafw/components/tool-cards/interact.tsx`（MafwDeltasCard）
- Create: `packages/desktop/src/renderer/mafw/components/tool-cards/automation.tsx`（MafwRuleCard + RULE_TOOLS + validate_rule 扩展）
- Create: `packages/desktop/src/renderer/mafw/components/tool-cards/python.tsx`（MafwPythonCard + MafwPythonRestartCard + pythonData）
- Modify: `packages/desktop/src/renderer/mafw/components/tool-cards/index.ts`（注册全部 44 key + 导出 REGISTERED_TOOLS）
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx:41`（import 路径）
- Delete: `packages/desktop/src/renderer/mafw/components/MafwToolCards.tsx`

**Interfaces:**
- Consumes: 旧 `MafwToolCards.tsx` 的 5 个组件源码（逐字搬运，视觉零改动）；`familyCard`（Task 2）；`TOOL_SPECS`（Tasks 1-7）
- Produces: `RULE_TOOLS: string[]`、`MafwSearchCard/MafwAddMemoryCard/MafwDeltasCard/MafwRuleCard/MafwPythonCard/MafwPythonRestartCard`（均为 `Component<ToolProps>`）；`REGISTERED_TOOLS: readonly string[]`（44 个，供 Task 9 完整性测试）；`registerMafwToolCards()`（签名不变）

- [ ] **Step 1: 搬运 bespoke 组件**

把旧 `MafwToolCards.tsx` 中以下组件**逐字**迁入对应新文件（含其私有 helper：`safeJson`、`tryJson` 放入各自用到的文件；`pythonData`/`PythonImageGrid` 随 python.tsx）：

- `memory-read.tsx`：`MafwSearchCard`（含 `safeJson`），`export function MafwSearchCard`
- `memory-write.tsx`：`MafwAddMemoryCard`，`export function MafwAddMemoryCard`
- `interact.tsx`：`MafwDeltasCard`（含 `safeJson`），`export function MafwDeltasCard`
- `python.tsx`：`PythonCardData`、`pythonData`、`PythonImageGrid`、`MafwPythonCard`、`MafwPythonRestartCard`，后两个 export
- `automation.tsx`：`MafwRuleCard` + 导出 `RULE_TOOLS`：

```ts
export const RULE_TOOLS = [
  "mafw_list_automation_rules", "mafw_get_automation_rule",
  "mafw_list_triage_items", "mafw_get_triage_item",
  "mafw_get_automation_history", "mafw_run_automation",
  "mafw_validate_rule", "mafw_propose_triage_decision",
  "mafw_draft_automation_rule",
] as const
```

`MafwRuleCard` 搬运后做一处扩展（spec §4.5）：在 `rules()` 为空且 output 可解析为带 `nextRuns`/`next5` 的对象时（`mafw_validate_rule` 的响应形状），追加渲染下次触发时间列表。在组件内 `rules()` 之后加：

```tsx
const nextRuns = () => {
  const parsed = safeJson(props.output || "[]")
  return Array.isArray(parsed) ? [] : parsed.nextRuns || parsed.next5 || []
}
// JSX 中 <For each={rules()}>…</For> 之后追加：
<For each={nextRuns()}>{(t: string) => (
  <div class="mafw-tool-meta" style="font-size:11px">下次触发: {t}</div>
)}</For>
```

新文件头部不加 `// @ts-nocheck`（旧文件的抑制不带入）；若有类型报错，用最小 `as any` 修复。

- [ ] **Step 2: index.ts 全量注册**

```ts
// packages/desktop/src/renderer/mafw/components/tool-cards/index.ts
import { ToolRegistry, type ToolProps } from "@mafw/session-ui/message-part"
import { TOOL_SPECS } from "./extract"
import { familyCard } from "./shared"
import { MafwSearchCard } from "./memory-read"
import { MafwAddMemoryCard } from "./memory-write"
import { MafwDeltasCard } from "./interact"
import { MafwRuleCard, RULE_TOOLS } from "./automation"
import { MafwPythonCard, MafwPythonRestartCard } from "./python"

export const REGISTERED_TOOLS = [
  // TOOL_SPECS（30）
  "mafw_supersede_memory", "mafw_pin_memory", "mafw_merge_memory",
  "mafw_resolve_merge", "mafw_commit_heuristic",
  "mafw_get_memory", "mafw_get_axioms",
  "mafw_create_goal", "mafw_set_goal", "mafw_get_goal_status",
  "mafw_list_goals", "mafw_cancel_goal", "mafw_get_evidence",
  "mafw_update_state", "mafw_load_state", "mafw_answer_question",
  "mafw_list_pending_questions",
  "mafw_ask_user", "mafw_record_feedback", "mafw_get_model_route",
  "mafw_desktop_screenshot", "mafw_desktop_navigate",
  "mafw_desktop_get_ui_state", "mafw_desktop_click", "mafw_desktop_type",
  "mafw_desktop_scroll", "mafw_restart_agent",
  "mafw_media_upload", "mafw_media_ask", "mafw_media_speak",
  // bespoke（5）
  "mafw_search_hybrid", "mafw_add_memory", "mafw_get_deltas",
  "mafw_python", "mafw_python_restart",
  // rule 族（9）
  ...RULE_TOOLS,
] as const

export function registerMafwToolCards() {
  for (const [name, spec] of Object.entries(TOOL_SPECS)) {
    ToolRegistry.register({ name, render: familyCard(spec) })
  }
  ToolRegistry.register({ name: "mafw_search_hybrid", render: MafwSearchCard })
  ToolRegistry.register({ name: "mafw_add_memory", render: MafwAddMemoryCard })
  ToolRegistry.register({ name: "mafw_get_deltas", render: MafwDeltasCard })
  for (const name of RULE_TOOLS) {
    ToolRegistry.register({
      name,
      render: (props: ToolProps) => MafwRuleCard({ ...props, tool: name }),
    })
  }
  ToolRegistry.register({ name: "mafw_python", render: MafwPythonCard })
  ToolRegistry.register({ name: "mafw_python_restart", render: MafwPythonRestartCard })
}
```

- [ ] **Step 3: MafwShell import 切换 + 删旧文件**

`packages/desktop/src/renderer/mafw/MafwShell.tsx:41`：
- 旧：`import { registerMafwToolCards } from "./components/MafwToolCards"`
- 新：`import { registerMafwToolCards } from "./components/tool-cards"`

`MafwShell.tsx:1151` 的调用点不变。删除 `packages/desktop/src/renderer/mafw/components/MafwToolCards.tsx`。

- [ ] **Step 4: Verify compile + tests**

Run: `cd packages/desktop && npx electron-vite build`
Expected: build 成功
Run: `cd packages/desktop && bun test`
Expected: 全部通过（无回归）

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/mafw/components/tool-cards packages/desktop/src/renderer/mafw/MafwShell.tsx
git rm packages/desktop/src/renderer/mafw/components/MafwToolCards.tsx
git commit -m "feat(desktop): migrate bespoke cards into tool-cards families, wire 44 tools"
```

---

### Task 9: 注册完整性测试 + 全量验证

**Files:**
- Create: `packages/desktop/src/renderer/mafw/components/tool-cards/index.test.ts`

**Interfaces:**
- Consumes: `REGISTERED_TOOLS`（Task 8）、`TOOL_SPECS`、`RULE_TOOLS`

- [ ] **Step 1: Write the test**

```ts
// packages/desktop/src/renderer/mafw/components/tool-cards/index.test.ts
import { describe, expect, test } from "bun:test"
import { REGISTERED_TOOLS } from "./index"
import { TOOL_SPECS } from "./extract"
import { RULE_TOOLS } from "./automation"

const ALL_TOOLS = [
  // gateway MCP（39，gateway/src/mcp/tool-registry.ts）
  "mafw_create_goal", "mafw_update_state", "mafw_search_hybrid",
  "mafw_get_deltas", "mafw_load_state", "mafw_ask_user",
  "mafw_record_feedback", "mafw_get_model_route", "mafw_add_memory",
  "mafw_supersede_memory", "mafw_pin_memory", "mafw_get_memory",
  "mafw_commit_heuristic", "mafw_get_axioms", "mafw_merge_memory",
  "mafw_resolve_merge", "mafw_set_goal", "mafw_get_goal_status",
  "mafw_list_goals", "mafw_answer_question", "mafw_get_evidence",
  "mafw_cancel_goal", "mafw_list_pending_questions",
  "mafw_list_automation_rules", "mafw_get_automation_rule",
  "mafw_list_triage_items", "mafw_get_triage_item",
  "mafw_get_automation_history", "mafw_run_automation",
  "mafw_validate_rule", "mafw_propose_triage_decision",
  "mafw_draft_automation_rule",
  "mafw_desktop_screenshot", "mafw_desktop_navigate",
  "mafw_desktop_get_ui_state", "mafw_desktop_click", "mafw_desktop_type",
  "mafw_desktop_scroll", "mafw_restart_agent",
  // 插件侧（5，src/plugin.ts）
  "mafw_media_ask", "mafw_media_upload", "mafw_media_speak",
  "mafw_python", "mafw_python_restart",
]

describe("registration completeness", () => {
  test("REGISTERED_TOOLS 覆盖全部 44 个第一方工具", () => {
    expect([...REGISTERED_TOOLS].sort()).toEqual([...ALL_TOOLS].sort())
  })
  test("无重复注册 key", () => {
    expect(new Set(REGISTERED_TOOLS).size).toBe(REGISTERED_TOOLS.length)
  })
  test("spec / bespoke / rule 三区数字吻合（30 + 5 + 9）", () => {
    expect(Object.keys(TOOL_SPECS)).toHaveLength(30)
    expect(RULE_TOOLS).toHaveLength(9)
  })
})
```

- [ ] **Step 2: Run test**

Run: `cd packages/desktop && bun test src/renderer/mafw/components/tool-cards/`
Expected: PASS（37 extract + 3 completeness = 40 tests in tool-cards/）

注意：`index.test.ts` import 链会加载 `@mafw/session-ui`（Solid 模块）——若 bun 解析 ESM/TSX 有问题，把 `REGISTERED_TOOLS` 移到一个纯 TS 文件（如 `registered-tools.ts`）让 index.ts 与测试都 import 它。先试直 import，失败再做此拆分。

- [ ] **Step 3: 全量验证**

Run: `npm run test:desktop`（root）
Expected: desktop 全套通过（新增 40 个测试，零回归）
Run: `cd packages/desktop && npx electron-vite build`
Expected: build 成功

- [ ] **Step 4: Commit**

```bash
git add packages/desktop/src/renderer/mafw/components/tool-cards/index.test.ts
git commit -m "test(desktop): tool-cards registration completeness (44 tools)"
```

---

## Self-Review 记录

- Spec §4 八族 44 工具 ↔ Tasks 1-8 全覆盖（30 spec + 5 bespoke + 9 rule = 44）✓
- Spec §5 降级（running 空 body / error 旁路 / fail-soft）↔ Task 2 familyCard + 各 spec 测试 ✓
- Spec §6 测试（extract 纯函数 + 注册完整性 + build）↔ Tasks 1-7、9 ✓
- 已知风险：Task 9 Step 2 的 bun import Solid 链已内嵌 plan B（registered-tools.ts 拆分）
