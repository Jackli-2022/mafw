# Slash 命令 P1 内置补齐 + P2 体验 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **前置依赖：** 姊妹计划 `2026-09-18-slash-command-registry.md`（注册表收敛 + 自定义命令）必须先落地——本计划复用其 `argumentHint`、gateway 命令合并、`runGatewayCommand` 派发链。

**Goal:** 补齐业界高频内置命令（`/export`、`/copy`、`/exit`、`/usage`）并实现补全模糊匹配（子序列 + 分隔符容忍），消除与 Claude Code/opencode/aider 的日常体验差距。

**Architecture:** 全部为 TUI 本地命令（注册进 `COMMAND_REGISTRY` + `createSlashHandler` 新分支），`/usage` 经 SDK `session.usageSummary()` 拉 gateway 数据渲染 overlay。模糊匹配收敛在 `command-registry.ts` 纯函数，chat-tab 补全 provider 消费。

**Tech Stack:** TUI（ESM、node --test、pi-tui ^0.84.1、chalk）；SDK（既有 `session.usageSummary`）

## Global Constraints

- 继承姊妹计划全部约束（TDD、commit 逐次确认、禁 TS parameter properties、`.ts` 相对 import、中文注释）。
- 版本号与 commit 哈希交付时显式汇报；新增测试数 + 全量通过数必须报告。
- `/rewind`（检查点回滚）、`/theme`（TUI 无主题系统）、`/share`（runtime 契约无 share 能力）、`/permissions` `/mcp` 管理面板：**本期不做**，记录在「范围外」节。

## 范围外（刻意排除，附原因）

| 命令 | 原因 |
|---|---|
| `/rewind` | 需要检查点子系统（对话+文件双快照），是独立工程；现有 `/undo`/`/redo` 覆盖单步 |
| `/theme` | TUI 主题目前硬编码在 `src/theme.ts`，无多套主题可切 |
| `/share` | runtime 契约无 share 能力（opencode 专属），跨 runtime 不可移植 |
| `/permissions` `/mcp` | TUI 已有 permission overlay + 弹卡交互；管理面板属桌面端职责 |

---

### Task 1: `/export` — 导出会话为 Markdown 文件

**Files:**
- Create: `packages/tui/src/ui/export-chat.ts`
- Modify: `packages/tui/src/ui/command-registry.ts`（注册）、`slash-commands.ts`（deps + 分支）、`app.ts`（注入）
- Test: `packages/tui/tests/export-chat.test.ts`

**Interfaces:**
- Consumes: `ChatStore.turns`（`{ messageID, role, parts: [{type, text?...}], done, queued? }[]`）。
- Produces: `turnsToMarkdown(turns: ChatTurn[]): string`；`exportChat(turns, cwd): Promise<string>`（写 `./mafw-chat-<yyyymmdd-hhmmss>.md`，返回文件路径）。

- [ ] **Step 1: 写失败测试** `packages/tui/tests/export-chat.test.ts`

```typescript
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { turnsToMarkdown } from '../src/ui/export-chat.ts'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

test('turnsToMarkdown renders user/assistant with text parts', () => {
  const md = turnsToMarkdown([
    { messageID: 'm1', role: 'user', done: true, parts: [{ id: '1', type: 'text', text: '你好' }] },
    { messageID: 'm2', role: 'assistant', done: true, parts: [{ id: '2', type: 'text', text: '回答' }, { id: '3', type: 'tool', name: 'bash' } as any] },
  ])
  assert.ok(md.includes('## User'))
  assert.ok(md.includes('你好'))
  assert.ok(md.includes('## Assistant'))
  assert.ok(md.includes('回答'))
  assert.ok(!md.includes('tool'))  // 工具块不导出
})

test('queued/local turns skipped', () => {
  const md = turnsToMarkdown([
    { messageID: 'queued-1', role: 'user', done: false, queued: true, parts: [{ id: '1', type: 'text', text: '排队' }] },
  ])
  assert.equal(md.includes('排队'), false)
})

test('exportChat writes file and returns path', async () => {
  const { exportChat } = await import('../src/ui/export-chat.ts')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-export-'))
  const p = await exportChat([
    { messageID: 'm1', role: 'user', done: true, parts: [{ id: '1', type: 'text', text: 'x' }] },
  ], dir)
  assert.ok(p.startsWith(dir))
  assert.ok(fs.readFileSync(p, 'utf-8').includes('x'))
  fs.rmSync(dir, { recursive: true, force: true })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/tui; node --test tests/export-chat.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现** `packages/tui/src/ui/export-chat.ts`

```typescript
/** /export：会话导出为 Markdown（opencode /export 同款，写文件而非打开编辑器）。 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import type { ChatTurn } from './blocks.ts'

/** turns → markdown；跳过排队/本地块，只导 text part。 */
export function turnsToMarkdown(turns: ChatTurn[]): string {
  const out: string[] = ['# MAFW 会话导出', '']
  for (const t of turns) {
    if (t.queued || t.messageID.startsWith('local-')) continue
    const texts = t.parts.filter((p) => p.type === 'text' && typeof (p as any).text === 'string')
    if (texts.length === 0) continue
    out.push(`## ${t.role === 'user' ? 'User' : 'Assistant'}`, '')
    for (const p of texts) out.push((p as any).text, '')
  }
  return out.join('\n')
}

/** 写入 cwd/mafw-chat-<ts>.md，返回绝对路径。 */
export async function exportChat(turns: ChatTurn[], cwd: string): Promise<string> {
  const ts = new Date().toISOString().replace(/[:T]/g, '').slice(0, 14)
  const file = path.join(cwd, `mafw-chat-${ts}.md`)
  fs.writeFileSync(file, turnsToMarkdown(turns), 'utf-8')
  return file
}
```

注册：`command-registry.ts` 的 `COMMAND_REGISTRY`「会话」组加：

```typescript
  { name: 'export', description: '导出会话为 Markdown 文件', category: '会话', immediate: true },
```

`slash-commands.ts`：`SlashDeps` 加 `exportChat(): Promise<string | null>`（返回提示文本），switch 加分支：

```typescript
      case 'export':
        return deps.exportChat()
```

`app.ts` deps 注入：

```typescript
    exportChat: async () => {
      try {
        const file = await exportChat(chatStore.turns, process.cwd())
        return `已导出: ${file}`
      } catch (e: any) {
        return `导出失败: ${String(e?.message ?? e).slice(0, 80)}`
      }
    },
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd packages/tui; node --test tests/export-chat.test.ts tests/command-registry.test.ts tests/slash-commands.test.ts`
Expected: PASS（3 新用例 + 既有不红）

- [ ] **Step 5: Commit（先向用户确认）**

```bash
git add packages/tui
git commit -m "feat(tui): /export 导出会话为 Markdown"
```

---

### Task 2: `/copy [N]` — 复制最近回复到剪贴板（OSC52）

**Files:**
- Create: `packages/tui/src/ui/copy-text.ts`
- Modify: command-registry / slash-commands / app.ts（同 Task 1 模式）
- Test: `packages/tui/tests/copy-text.test.ts`

**Interfaces:**
- Consumes: `ChatStore.turns`。
- Produces: `lastAssistantText(turns, n): string | null`（第 N 近的 assistant text，默认 1）；`copyToClipboard(text, write: (s)=>void): void`（OSC52 转义序列；tmux/screen 由 pi-tui 内建处理鼠标选区，此处直写 stdout）。

- [ ] **Step 1: 写失败测试** `packages/tui/tests/copy-text.test.ts`

```typescript
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { lastAssistantText, copyToClipboard } from '../src/ui/copy-text.ts'

test('lastAssistantText picks Nth latest assistant text', () => {
  const turns = [
    { messageID: 'u1', role: 'user', done: true, parts: [{ type: 'text', text: 'q1' }] },
    { messageID: 'a1', role: 'assistant', done: true, parts: [{ type: 'text', text: 'first' }] },
    { messageID: 'a2', role: 'assistant', done: true, parts: [{ type: 'text', text: 'second' }] },
  ] as any
  assert.equal(lastAssistantText(turns, 1), 'second')
  assert.equal(lastAssistantText(turns, 2), 'first')
  assert.equal(lastAssistantText(turns, 3), null)
  assert.equal(lastAssistantText([], 1), null)
})

test('copyToClipboard emits OSC52 with base64 payload', () => {
  const written: string[] = []
  copyToClipboard('hi', (s) => written.push(s))
  assert.equal(written.length, 1)
  assert.ok(written[0].startsWith(']52;c;'))
  assert.ok(written[0].includes(Buffer.from('hi').toString('base64')))
  assert.ok(written[0].endsWith(''))
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/tui; node --test tests/copy-text.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现** `packages/tui/src/ui/copy-text.ts`

```typescript
/** /copy [N]：复制第 N 近 assistant 回复到系统剪贴板（OSC52，终端支持时生效）。 */
import type { ChatTurn } from './blocks.ts'

export function lastAssistantText(turns: ChatTurn[], n: number): string | null {
  const assistants = turns.filter((t) => t.role === 'assistant' && t.done && !t.queued)
  const target = assistants[assistants.length - n]
  if (!target) return null
  const text = target.parts
    .filter((p) => p.type === 'text' && typeof (p as any).text === 'string')
    .map((p) => (p as any).text as string)
    .join('\n')
    .trim()
  return text || null
}

/** OSC52 转义序列写剪贴板（fail-open：终端不支持时静默无效）。 */
export function copyToClipboard(text: string, write: (s: string) => void): void {
  write(`]52;c;${Buffer.from(text, 'utf-8').toString('base64')}`)
}
```

注册：`COMMAND_REGISTRY`「会话」组加：

```typescript
  { name: 'copy', description: '复制最近回复到剪贴板（/copy [N]）', category: '会话', argumentHint: '[N]', immediate: true },
```

`slash-commands.ts`：`SlashDeps` 加 `copyReply(n: number): string`，switch 分支：

```typescript
      case 'copy': {
        const n = parseInt(args.trim(), 10)
        return deps.copyReply(Number.isNaN(n) || n < 1 ? 1 : n)
      }
```

`app.ts` deps 注入：

```typescript
    copyReply: (n) => {
      const text = lastAssistantText(chatStore.turns, n)
      if (!text) return '没有可复制的回复'
      copyToClipboard(text, (s) => tui.terminal.write(s))
      return `已复制第 ${n} 近回复（${text.length} 字符）`
    },
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd packages/tui; node --test tests/copy-text.test.ts tests/slash-commands.test.ts`
Expected: PASS

- [ ] **Step 5: Commit（先向用户确认）**

```bash
git add packages/tui
git commit -m "feat(tui): /copy [N] OSC52 剪贴板复制"
```

---

### Task 3: `/exit` — 命令形态退出

**Files:**
- Modify: command-registry / slash-commands / app.ts
- Test: `packages/tui/tests/slash-commands.test.ts`（追加）

- [ ] **Step 1: 追加失败测试**（`slash-commands.test.ts` 既有风格）

```typescript
test('exit triggers quit callback', async () => {
  let quit = 0
  const handler = createSlashHandler(makeDeps({ quitApp: () => { quit++ } }))
  await handler('exit', '')
  assert.equal(quit, 1)
})
```

（`makeDeps` 为测试文件既有的 deps 工厂，按其现有形态补 `quitApp` 默认值。）

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/tui; node --test tests/slash-commands.test.ts`
Expected: FAIL（makeDeps 缺 quitApp / 分支不存在）

- [ ] **Step 3: 实现**

`COMMAND_REGISTRY`「帮助」组前加「会话」组条目：

```typescript
  { name: 'exit', description: '退出 TUI', category: '会话', aliases: ['quit'], immediate: true },
```

`SlashDeps` 加 `quitApp(): void`；switch 分支：

```typescript
      case 'exit':
        deps.quitApp()
        return null
```

`app.ts` deps 注入：`quitApp: quitApp`（既有函数，line 531 附近）。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd packages/tui; node --test tests/slash-commands.test.ts`
Expected: PASS

- [ ] **Step 5: Commit（先向用户确认）**

```bash
git add packages/tui
git commit -m "feat(tui): /exit 命令（别名 /quit）"
```

---

### Task 4: `/usage` — 用量概览 overlay

**Files:**
- Create: `packages/tui/src/ui/usage-overlay.ts`（纯函数：usageSummary → 渲染行）
- Modify: command-registry / slash-commands / app.ts
- Test: `packages/tui/tests/usage-overlay.test.ts`

**Interfaces:**
- Consumes: SDK `client.session.usageSummary({ window })`（既有，client.ts:191）。
- Produces: `usageLines(summary: any): string[]`（KPI 行 + 分模型 top3 + 配额窗口行；字段缺失 fail-open 显示 `—`）。

- [ ] **Step 1: 写失败测试** `packages/tui/tests/usage-overlay.test.ts`

```typescript
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { usageLines } from '../src/ui/usage-overlay.ts'

test('renders KPI and model rows', () => {
  const lines = usageLines({
    totals: { tokens: 1234567, costUsd: 0.5678, cacheHitRate: 0.42 },
    models: [
      { model: 'mimo-v2.5', tokens: 1000000, costUsd: 0.5 },
      { model: 'qwen3', tokens: 234567, costUsd: 0.06 },
    ],
  })
  const text = lines.join('\n')
  assert.ok(text.includes('1.2M'))
  assert.ok(text.includes('$0.57'))
  assert.ok(text.includes('mimo-v2.5'))
  assert.ok(text.includes('42%'))
})

test('missing fields → — placeholders, no throw', () => {
  const lines = usageLines({})
  assert.ok(lines.join('\n').includes('—'))
})

test('quota windows rendered when present', () => {
  const lines = usageLines({ windows: [{ label: '5h', used: 30, limit: 100, unit: '%' }] })
  assert.ok(lines.join('\n').includes('5h'))
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/tui; node --test tests/usage-overlay.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现** `packages/tui/src/ui/usage-overlay.ts`

```typescript
/** /usage：用量概览 overlay 渲染（数据来自 gateway /api/usage/summary，fail-open）。 */

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

export function usageLines(summary: any): string[] {
  const t = summary?.totals ?? {}
  const lines: string[] = ['用量概览（本会话统计自 gateway trajectory）', '']
  lines.push(`总 tokens: ${t.tokens != null ? fmtTokens(t.tokens) : '—'}`)
  lines.push(`估算成本: ${t.costUsd != null ? `$${t.costUsd.toFixed(2)}` : '—'}`)
  lines.push(`缓存命中率: ${t.cacheHitRate != null ? `${Math.round(t.cacheHitRate * 100)}%` : '—'}`)
  const models: any[] = Array.isArray(summary?.models) ? summary.models : []
  if (models.length > 0) {
    lines.push('', '分模型:')
    for (const m of models.slice(0, 5)) {
      lines.push(`  ${m.model ?? '?'}  ${m.tokens != null ? fmtTokens(m.tokens) : '—'}  ${m.costUsd != null ? `$${m.costUsd.toFixed(2)}` : '—'}`)
    }
  }
  const windows: any[] = Array.isArray(summary?.windows) ? summary.windows : []
  if (windows.length > 0) {
    lines.push('', '配额窗口:')
    for (const w of windows) {
      lines.push(`  ${w.label ?? w.window ?? '?'}  ${w.used ?? '—'}/${w.limit ?? '∞'}${w.unit ?? ''}`)
    }
  }
  return lines
}
```

注意：实现时对 `summary` 的实际字段名先做运行时探测（SDK `usageSummary` 返回结构以 gateway `/api/usage/summary` 为准）；测试桩的字段名是实现契约，若 gateway 实际字段不同，在 app.ts 注入层做一次字段映射适配（不动本纯函数），并把映射写进测试。

注册：`COMMAND_REGISTRY`「帮助」组加：

```typescript
  { name: 'usage', description: '用量与成本概览', category: '帮助', aliases: ['cost'], immediate: true },
```

`SlashDeps` 加 `showUsage(): Promise<string | null>`；switch 分支：

```typescript
      case 'usage':
        return deps.showUsage()
```

`app.ts` 注入（复用既有 overlay 模式，参照 showStatusRecap）：

```typescript
    showUsage: async () => {
      try {
        const summary = await client.session.usageSummary({ window: '7d' })
        const overlay = tui.showOverlay(new Text(usageLines(summary).join('\n'), 1, 1), { width: '70%', maxHeight: 24, anchor: 'center' })
        const off = tui.addInputListener((data) => {
          if (matchesKey(data, Key.escape) || matchesKey(data, Key.enter)) { off(); overlay.hide(); return { consume: true } }
          return undefined
        })
        return null
      } catch (e: any) {
        return `usage 获取失败: ${String(e?.message ?? e).slice(0, 80)}`
      }
    },
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd packages/tui; node --test tests/usage-overlay.test.ts tests/slash-commands.test.ts`
Expected: PASS

- [ ] **Step 5: Commit（先向用户确认）**

```bash
git add packages/tui
git commit -m "feat(tui): /usage 用量概览 overlay（别名 /cost）"
```

---

### Task 5: 补全模糊匹配（子序列 + 分隔符容忍）

**Files:**
- Create: `packages/tui/src/ui/fuzzy.ts`
- Modify: `packages/tui/src/ui/chat-tab.ts`（如 pi-tui provider 仅前缀匹配，包一层自定义 provider）
- Test: `packages/tui/tests/fuzzy.test.ts`

**Interfaces:**
- Produces: `fuzzyMatch(query: string, candidate: string): boolean`（子序列匹配，忽略 `-` `_` `:` 分隔符，大小写不敏感）；`filterCommands(query, items: {name, description}[]): items`（name 与别名维度匹配，按匹配位置排序）。

- [ ] **Step 0: 探测 pi-tui 过滤行为**

先读 `node_modules/@earendil-works/pi-tui` 的 `CombinedAutocompleteProvider` 源码确认其过滤逻辑：
- 若已支持子序列/模糊匹配 → 本 Task 只做 `fuzzy.ts` 纯函数 + 单测，不改接线（记录结论）
- 若仅前缀匹配 → 在 chat-tab 用自定义 provider 包装（实现 `getSuggestions(prefix)` 走 `filterCommands`）

- [ ] **Step 1: 写失败测试** `packages/tui/tests/fuzzy.test.ts`

```typescript
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fuzzyMatch, filterCommands } from '../src/ui/fuzzy.ts'

test('subsequence match ignoring separators and case', () => {
  assert.ok(fuzzyMatch('adddir', 'add-dir'))
  assert.ok(fuzzyMatch('mm', 'merge-memory'))
  assert.ok(fuzzyMatch('GC', 'git:commit'))
  assert.ok(!fuzzyMatch('xyz', 'merge-memory'))
  assert.ok(fuzzyMatch('', 'anything'))
})

test('filterCommands ranks prefix hits before mid-word hits', () => {
  const items = [
    { name: 'merge-memory', description: '' },
    { name: 'model', description: '' },
    { name: 'memory-note', description: '' },
  ]
  const out = filterCommands('m', items)
  assert.equal(out[0].name, 'merge-memory') // 前缀命中优先（同位置按字母序）
  assert.ok(out.every((i) => fuzzyMatch('m', i.name)))
  assert.equal(filterCommands('zz', items).length, 0)
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/tui; node --test tests/fuzzy.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现** `packages/tui/src/ui/fuzzy.ts`

```typescript
/** 补全模糊匹配（Claude Code 语义：子序列 + 忽略 - _ : 分隔符 + 大小写不敏感）。 */

function normalize(s: string): string {
  return s.toLowerCase().replace(/[-_:]/g, '')
}

/** query 是否为 candidate 的子序列（归一化后）。 */
export function fuzzyMatch(query: string, candidate: string): boolean {
  const q = normalize(query)
  const c = normalize(candidate)
  if (q.length === 0) return true
  let i = 0
  for (const ch of c) {
    if (ch === q[i]) i++
    if (i === q.length) return true
  }
  return false
}

/** 匹配位置（前缀=0，词中=n，未命中=-1），供排序。 */
function matchIndex(query: string, candidate: string): number {
  const q = normalize(query)
  const c = normalize(candidate)
  if (q.length === 0) return 0
  if (c.startsWith(q)) return 0
  return fuzzyMatch(query, candidate) ? c.indexOf(q[0]) + 1 : -1
}

export function filterCommands<T extends { name: string }>(query: string, items: T[]): T[] {
  return items
    .map((item) => ({ item, idx: matchIndex(query, item.name) }))
    .filter((x) => x.idx >= 0)
    .sort((a, b) => a.idx - b.idx || a.item.name.localeCompare(b.item.name))
    .map((x) => x.item)
}
```

- [ ] **Step 4: 接线（依 Step 0 探测结论）**

若需自定义 provider，`chat-tab.ts`：

```typescript
import { filterCommands } from './fuzzy.ts'

// setAutocompleteExtra / 构造函数中 provider 包装：
const allItems = () => [...autocompleteItems(), ...this.autocompleteExtra]
this.editor.setAutocompleteProvider(new CombinedAutocompleteProvider(allItems(), process.cwd()))
// 若 CombinedAutocompleteProvider 仅前缀匹配：改为其实现类实例化前先把 filterCommands
// 验证过——pi-tui 接受 items 数组时无过滤钩子，则实现最小 provider 接口：
// { getSuggestions(prefix: string) { return filterCommands(prefix.replace(/^\//, ''), allItems()) } }
```

（确切 provider 接口以 pi-tui ^0.84.1 源码为准；若 `CombinedAutocompleteProvider` 自带模糊匹配，此步只保留 fuzzy.ts + 测试并在 AGENTS.md 记录结论。）

- [ ] **Step 5: 跑测试 + 全量**

Run: `cd packages/tui; node --test tests/*.test.ts; npm run typecheck`
Expected: 全 PASS

- [ ] **Step 6: Commit（先向用户确认）**

```bash
git add packages/tui
git commit -m "feat(tui): slash 补全模糊匹配（子序列+分隔符容忍）"
```

---

### Task 6: 收尾

- [ ] **Step 1: AGENTS.md §5.9b TUI 节追加一行**

```markdown
- v4.11 命令扩展：`/export`（导出 markdown）`/copy [N]`（OSC52 剪贴板）`/exit` `/usage`（用量 overlay）；补全模糊匹配（`ui/fuzzy.ts`，子序列+分隔符容忍）
```

- [ ] **Step 2: 全量验证**

```bash
npm run build
cd packages/tui; node --test tests/*.test.ts
cd ../gateway; npx jest --silent
cd ../gateway-sdk; bun test
```

- [ ] **Step 3: 版本 bump + 交付汇报**

版本 bump 与姊妹计划合并为一次（v4.11.0）；gateway 重启只需一次（姊妹计划 Task 9 已含）。向用户汇报：新增测试数、全量通过数、版本号、commit 哈希列表、范围外清单复述。

---

## Self-Review 记录

- **Spec 覆盖**：P1 `/export`→T1、`/copy`→T2、`/exit`→T3、`/usage`→T4；P2 模糊匹配→T5；P2 argumentHint 已在姊妹计划 Task 7/8 落地。P1 中 `/init` 改以自定义命令模板形式交付（姊妹计划 Task 5/6 的 dogfood：落地后在 `~/.mafw/commands/init.md` 写一条内置示例，列入姊妹计划 Task 9 文档步骤）。
- **类型一致性**：`ChatTurn` 引用 `ui/blocks.ts` 既有导出（执行时确认导出路径，若未导出则在 blocks.ts 补 export）。
- **风险**：①OSC52 在 Windows Terminal 支持、在旧 conhost 无效——fail-open 静默；②usageSummary 字段名与测试桩可能漂移，Task 4 已内嵌适配层指令；③pi-tui provider 过滤行为未知，Task 5 Step 0 先探测。
