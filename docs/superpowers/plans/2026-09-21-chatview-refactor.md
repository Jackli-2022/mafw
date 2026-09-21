# ChatView 结构与美学重构 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 ChatPane（2351 行 + @ts-nocheck + 45 props）重构为布局壳 + 5 个类型化模块，收编规则镜像为 session-ui 共享契约，props 收敛走 workspace，CSS 按域归位并 token 化。

**Architecture:** 绞杀者四波（W1 共享契约 → W2 拆模块 → W3 props 收敛 → W4 CSS 归位），每波独立可测可提交可回滚。共享规则单一真相源在 session-ui；desktop 侧新模块放 `renderer/mafw/chat/`，严格类型化无 ts-nocheck。

**Tech Stack:** SolidJS + @mafw/session-ui + bun test + electron-vite

## Global Constraints

- 每波门禁：desktop `bun test` 全量通过（当前基线 643）+ `cd packages/desktop && npx electron-vite build` 通过 + 独立 commit
- 新模块文件**禁止** `// @ts-nocheck`，严格类型化
- 规则镜像单一真相源：`@mafw/session-ui/parts-rules`，desktop 不得再本地定义 HIDDEN_TOOLS/CONTEXT_GROUP_TOOLS/renderable
- UI 图标一律走 `@mafw/ui` v1 `Icon` 组件，禁止新增字符 glyph
- 测试文件与源码同目录 `.test.ts`（bun:test 风格）
- 每波结束汇报：新增测试数 / 全量通过数 / commit 哈希

---

### Task 1: W1 — session-ui 导出 parts-rules 共享契约

**Files:**
- Create: `packages/session-ui/src/components/parts-rules.ts`
- Modify: `packages/session-ui/src/components/message-part.tsx:629-630,733-742`
- Modify: `packages/session-ui/package.json`（exports 加一条）
- Test: `packages/session-ui/src/components/parts-rules.test.ts`

**Interfaces:**
- Consumes: 无（纯提取）
- Produces: `HIDDEN_TOOLS: Set<string>`、`CONTEXT_GROUP_TOOLS: Set<string>`、`renderable(part, showReasoningSummaries?): boolean`、`isTopLevelToolEntry(part): boolean`、`PartLike` 类型。desktop 后续经 `@mafw/session-ui/parts-rules` import。

- [ ] **Step 1: 写失败测试**

`packages/session-ui/src/components/parts-rules.test.ts`：
```ts
import { describe, expect, test } from "bun:test"
import { HIDDEN_TOOLS, CONTEXT_GROUP_TOOLS, renderable, isTopLevelToolEntry } from "./parts-rules"

describe("parts-rules", () => {
  test("HIDDEN_TOOLS 含 todowrite", () => {
    expect(HIDDEN_TOOLS.has("todowrite")).toBe(true)
  })
  test("CONTEXT_GROUP_TOOLS 含 read/glob/grep/list", () => {
    for (const t of ["read", "glob", "grep", "list"]) expect(CONTEXT_GROUP_TOOLS.has(t)).toBe(true)
  })
  test("renderable: hidden tool 不渲染", () => {
    expect(renderable({ type: "tool", tool: "todowrite" } as any)).toBe(false)
  })
  test("renderable: question pending/running 不渲染，completed 渲染", () => {
    expect(renderable({ type: "tool", tool: "question", state: { status: "pending" } } as any)).toBe(false)
    expect(renderable({ type: "tool", tool: "question", state: { status: "running" } } as any)).toBe(false)
    expect(renderable({ type: "tool", tool: "question", state: { status: "completed" } } as any)).toBe(true)
  })
  test("renderable: 普通 tool 渲染", () => {
    expect(renderable({ type: "tool", tool: "bash" } as any)).toBe(true)
  })
  test("renderable: 空 text 不渲染", () => {
    expect(renderable({ type: "text", text: "  " } as any)).toBe(false)
    expect(renderable({ type: "text", text: "hi" } as any)).toBe(true)
  })
  test("isTopLevelToolEntry: 排除 hidden/context-group/question-pending", () => {
    expect(isTopLevelToolEntry({ type: "tool", tool: "bash" })).toBe(true)
    expect(isTopLevelToolEntry({ type: "tool", tool: "todowrite" })).toBe(false)
    expect(isTopLevelToolEntry({ type: "tool", tool: "read" })).toBe(false)
    expect(isTopLevelToolEntry({ type: "tool", tool: "question", state: { status: "pending" } })).toBe(false)
    expect(isTopLevelToolEntry({ type: "tool", tool: "question", state: { status: "completed" } })).toBe(true)
    expect(isTopLevelToolEntry({ type: "text" } as any)).toBe(false)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/session-ui && bun test src/components/parts-rules.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 parts-rules.ts**

从 message-part.tsx 提取（629-630 常量、733-742 renderable 原样），加入 isTopLevelToolEntry（逻辑与 desktop flow-card-placement.ts:31-40 一致）：
```ts
// 会话 part 渲染规则单一真相源：desktop flow-card 锚定与 AssistantParts 共用，
// 禁止在 desktop 侧再镜像这些常量与判定。
export interface PartLike {
  type: string
  tool?: string
  callID?: string
  text?: string
  state?: { status?: string }
}

export const CONTEXT_GROUP_TOOLS = new Set(["read", "glob", "grep", "list"])
export const HIDDEN_TOOLS = new Set(["todowrite"])

const PART_MAPPING_FALLBACK: Record<string, true> = {}

export function renderable(part: PartLike, showReasoningSummaries = true): boolean {
  if (part.type === "tool") {
    if (!part.tool) return false
    if (HIDDEN_TOOLS.has(part.tool)) return false
    if (part.tool === "question") return part.state?.status !== "pending" && part.state?.status !== "running"
    return true
  }
  if (part.type === "text") return !!part.text?.trim()
  if (part.type === "reasoning") return showReasoningSummaries && !!part.text?.trim()
  return false
}

export function isTopLevelToolEntry(part: PartLike): boolean {
  if (part.type !== "tool" || !part.tool) return false
  if (HIDDEN_TOOLS.has(part.tool)) return false
  if (CONTEXT_GROUP_TOOLS.has(part.tool)) return false
  if (part.tool === "question") {
    const s = part.state?.status
    if (s === "pending" || s === "running") return false
  }
  return true
}
```
注意：message-part.tsx 的 renderable 末行是 `return !!PART_MAPPING[part.type]`——提取时保持语义：PART_MAPPING 是组件映射表，纯规则层不含它；message-part.tsx 内 renderable 调用点改为 `(parts-rules 的 renderable) || !!PART_MAPPING[part.type]` 的组合，或保留本地 renderable 包装函数调共享核心。采用后者：message-part.tsx 保留一个本地 `renderable` 包装（tool/text/reasoning 分支委托 parts-rules，末行 fallback 仍查 PART_MAPPING），导出签名不变，行为零变化。

- [ ] **Step 4: package.json exports 加条目**

`packages/session-ui/package.json` exports 对象内加：
```json
"./parts-rules": "./src/components/parts-rules.ts",
```
（放在 "./session-diff" 条目旁，跟随现有非 tsx 显式映射约定）

- [ ] **Step 5: message-part.tsx 改 import**

删 629-630 两行常量定义，改为：
```ts
import { CONTEXT_GROUP_TOOLS, HIDDEN_TOOLS, renderable as renderableCore, isTopLevelToolEntry } from "./parts-rules"
```
本地 renderable（733-742）改为包装：
```ts
export function renderable(part: PartType, showReasoningSummaries = true) {
  if (part.type === "tool" || part.type === "text" || part.type === "reasoning") {
    return renderableCore(part as any, showReasoningSummaries)
  }
  return !!PART_MAPPING[part.type]
}
```
（868 行 `CONTEXT_GROUP_TOOLS.has` 调用点不变，只是来源变 import。）

- [ ] **Step 6: 跑测试 + 构建**

Run: `cd packages/session-ui && bun test src/components/parts-rules.test.ts`
Expected: PASS（7 测试）
Run: `cd packages/desktop && bun test`
Expected: 643 全量通过（session-ui 经 workspace 解析，desktop 测试含 message-part 消费方）
Run: `cd packages/desktop && npx electron-vite build`
Expected: 构建通过

- [ ] **Step 7: Commit**

```bash
git add packages/session-ui/src/components/parts-rules.ts packages/session-ui/src/components/parts-rules.test.ts packages/session-ui/src/components/message-part.tsx packages/session-ui/package.json
git commit -m "feat(session-ui): 导出 parts-rules 共享契约（renderable/isTopLevelToolEntry/工具集常量化）"
```

---

### Task 2: W1 — desktop flow-card-placement 改吃共享契约 + isLocalMessageId 收编

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/components/flow-card-placement.ts:1-40`
- Create: `packages/desktop/src/renderer/mafw/chat/local-id.ts`
- Modify: `packages/desktop/src/renderer/mafw/sse/chat-reducers.ts`、`packages/desktop/src/renderer/mafw/components/ChatPane.tsx`（handleVoiceSegment 乐观 id 前缀判断处）
- Test: `packages/desktop/src/renderer/mafw/chat/local-id.test.ts`

**Interfaces:**
- Consumes: `@mafw/session-ui/parts-rules` 的 `isTopLevelToolEntry`（Task 1 产出）
- Produces: `isLocalMessageId(id: string): boolean`（判定 `user-`/`local-`/`queued-` 前缀）

- [ ] **Step 1: 写 local-id 失败测试**

`packages/desktop/src/renderer/mafw/chat/local-id.test.ts`：
```ts
import { describe, expect, test } from "bun:test"
import { isLocalMessageId } from "./local-id"

describe("isLocalMessageId", () => {
  test("识别本地乐观 id 前缀", () => {
    expect(isLocalMessageId("user-1727000000000")).toBe(true)
    expect(isLocalMessageId("local-abc")).toBe(true)
    expect(isLocalMessageId("queued-1")).toBe(true)
  })
  test("拒绝真实 id", () => {
    expect(isLocalMessageId("msg_01J")).toBe(false)
    expect(isLocalMessageId("")).toBe(false)
    expect(isLocalMessageId("username-x")).toBe(false) // 前缀必须带连字符边界
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/desktop && bun test src/renderer/mafw/chat/local-id.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 local-id.ts**

```ts
// 乐观本地消息 id 判定单一真相源：chat-reducers / voice 上传 / part upsert 共用，
// 禁止再散落 `id.startsWith("user-")` 之类的硬编码。
const LOCAL_PREFIXES = ["user-", "local-", "queued-"]

export function isLocalMessageId(id: string): boolean {
  if (!id) return false
  return LOCAL_PREFIXES.some((p) => id.startsWith(p))
}
```

- [ ] **Step 4: flow-card-placement.ts 改 import**

删 24-28 行本地常量与 31-40 行 `isTopLevelToolEntry` 定义；文件头镜像警告注释替换为：
```ts
// Flow card 内联锚点判定（纯函数，bun 可测）。
// 顶层条目判定规则来自 @mafw/session-ui/parts-rules（单一真相源，禁止本地镜像）。
import { isTopLevelToolEntry } from "@mafw/session-ui/parts-rules"
```
保留 `flowCardInitialExpanded`/`inlineAnchor`/`findPendingToolPart` 与所有类型导出不变（`isTopLevelToolEntry` 改为 re-export 以兼容既有测试 import：`export { isTopLevelToolEntry }`）。

- [ ] **Step 5: 替换三处前缀硬编码**

- `chat-reducers.ts`（约 21 行 `id.startsWith("user-")` 处）改 `import { isLocalMessageId } from "../chat/local-id"` 并替换。
- `ChatPane.tsx` handleVoiceSegment（约 557 行 `user-` 前缀判断处）同样替换。
- `chat-reducers.ts` applyPartUpsert（约 104 行）同样替换。

- [ ] **Step 6: 跑测试 + 构建**

Run: `cd packages/desktop && bun test`
Expected: 644 全量通过（643 基线 + 1 个 local-id 测试文件内 2 测试——汇报口径：新增 2 测试）
Run: `cd packages/desktop && npx electron-vite build`
Expected: 通过

- [ ] **Step 7: Commit**

```bash
git add packages/desktop/src/renderer/mafw/chat/local-id.ts packages/desktop/src/renderer/mafw/chat/local-id.test.ts packages/desktop/src/renderer/mafw/components/flow-card-placement.ts packages/desktop/src/renderer/mafw/sse/chat-reducers.ts packages/desktop/src/renderer/mafw/components/ChatPane.tsx
git commit -m "refactor(desktop): flow-card 锚定吃 session-ui 共享契约；乐观 id 判定收编 isLocalMessageId"
```

---

### Task 3: W2 — 抽 flow-card-slots.ts 纯函数模块

**Files:**
- Create: `packages/desktop/src/renderer/mafw/chat/flow-card-slots.ts`
- Modify: `packages/desktop/src/renderer/mafw/components/ChatPane.tsx:1633-1719`
- Test: `packages/desktop/src/renderer/mafw/chat/flow-card-slots.test.ts`

**Interfaces:**
- Consumes: `flow-card-placement.ts` 的 `inlineAnchor`/`FlowCardLink`；store 形状 `WorkspaceStore`
- Produces: `hasInlineAnchor(card, partsOf)`、`inlineCardsForPart(cards, messageID, callID, partsOf)`、`turnOfMessage(messageID, store)`、`cardsForTurn(cards, userMsgId, store, partsOf)`、`unplacedCards(cards, store, partsOf)`——签名与 ChatPane 1633-1719 现有内联实现一致，只是迁为独立模块。

- [ ] **Step 1: 写失败测试**

`flow-card-slots.test.ts`：针对 `turnOfMessage`（assistant→parentID 归 turn；orphan 按时间序向上找最近 user）与 `cardsForTurn`（内联卡排除、无链接卡归最后一 turn）写 6 个用例，数据用最小 store mock：
```ts
import { describe, expect, test } from "bun:test"
import { turnOfMessage, cardsForTurn, unplacedCards } from "./flow-card-slots"

function mkStore(messages: Record<string, any[]>) {
  return { message: messages, part: {} } as any
}
const partsOf = () => [] as any[]

describe("turnOfMessage", () => {
  test("user 消息归自身", () => {
    const store = mkStore({ s1: [{ id: "u1", role: "user", time: { created: 1 } }] })
    expect(turnOfMessage("u1", store, "s1")).toBe("u1")
  })
  test("assistant 经 parentID 归 turn", () => {
    const store = mkStore({ s1: [
      { id: "u1", role: "user", time: { created: 1 } },
      { id: "a1", role: "assistant", parentID: "u1", time: { created: 2 } },
    ] })
    expect(turnOfMessage("a1", store, "s1")).toBe("u1")
  })
  test("orphan assistant 按时间向上找最近 user", () => {
    const store = mkStore({ s1: [
      { id: "u1", role: "user", time: { created: 1 } },
      { id: "u2", role: "user", time: { created: 5 } },
      { id: "a9", role: "assistant", parentID: "missing", time: { created: 6 } },
    ] })
    expect(turnOfMessage("a9", store, "s1")).toBe("u2")
  })
})

describe("cardsForTurn", () => {
  test("卡归对应 turn；内联锚定卡排除", () => {
    // 构造两 turn + 一张带 messageID/callID 但 store.part 无对应 part（无法内联 → 落回合底部）
    const store = mkStore({ s1: [
      { id: "u1", role: "user", time: { created: 1 } },
      { id: "a1", role: "assistant", parentID: "u1", time: { created: 2 } },
    ] })
    const cards = [
      { id: "c1", data: { messageID: "a1", callID: "x" } },
      { id: "c2", data: {} },
    ] as any[]
    const forU1 = cardsForTurn(cards, "u1", store, "s1", partsOf)
    expect(forU1.map((c) => c.id)).toContain("c1")
  })
  test("unplacedCards：无 user 消息时全部落兜底", () => {
    const store = mkStore({ s1: [{ id: "a1", role: "assistant", time: { created: 2 } }] })
    const cards = [{ id: "c1", data: {} }] as any[]
    expect(unplacedCards(cards, store, "s1", partsOf).map((c) => c.id)).toEqual(["c1"])
  })
})
```
（第 6 个用例：cardsForTurn 中有内联锚的卡被排除——需 partsOf 返回含对应 ToolPart 的数据。）

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/desktop && bun test src/renderer/mafw/chat/flow-card-slots.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 搬迁实现**

把 ChatPane.tsx 1633-1719 的 `hasInlineAnchor`/`inlineCardsForPart`/`turnOfMessage`/`cardsForTurn`/`unplacedCards` 逐字迁入 `flow-card-slots.ts`，把闭包捕获的 `props.store`/`props.flowCards()` 改为显式参数（store、sessionID、cards、partsOf），严格类型化（无 ts-nocheck）。ChatPane 原位置改为：
```ts
import { hasInlineAnchor, inlineCardsForPart, turnOfMessage, cardsForTurn, unplacedCards } from "../chat/flow-card-slots"
```
并在组件内用薄包装传入 store/sessionID。

- [ ] **Step 4: 跑测试 + 构建**

Run: `cd packages/desktop && bun test`
Expected: 全量通过（新增 6 测试）
Run: `cd packages/desktop && npx electron-vite build`
Expected: 通过

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/mafw/chat/flow-card-slots.ts packages/desktop/src/renderer/mafw/chat/flow-card-slots.test.ts packages/desktop/src/renderer/mafw/components/ChatPane.tsx
git commit -m "refactor(desktop): flow-card 归位逻辑抽为 chat/flow-card-slots.ts 纯函数模块"
```

---

### Task 4: W2 — 抽 use-attachments.ts hook

**Files:**
- Create: `packages/desktop/src/renderer/mafw/chat/use-attachments.ts`
- Modify: `packages/desktop/src/renderer/mafw/components/ChatPane.tsx:608-814`（附件管线）+ chips 行 JSX（2027-2059）
- Test: `packages/desktop/src/renderer/mafw/chat/use-attachments.test.ts`

**Interfaces:**
- Consumes: `window.api.mafw.media.*`（A2A 上传）
- Produces:
```ts
interface Attachment { id: string; name: string; mime: string; dataUrl: string; size: number; kind: "image" | "video" | "audio" | "file" }
useAttachments(): {
  attachments: () => Attachment[]
  addFiles(files: FileList | File[]): Promise<void>
  addPaste(e: ClipboardEvent): void
  addDrop(e: DragEvent): void
  removeAttachment(id: string): void
  clearAttachments(): void
  uploading: () => boolean
}
```
另导出纯函数 `imageToDataUrl(file: File, maxDim?: number): Promise<string>` 与 `classifyMime(mime: string): Attachment["kind"]`（可单测）。

- [ ] **Step 1: 写失败测试**

`use-attachments.test.ts`：测 `classifyMime`（image/png→image、video/mp4→video、audio/wav→audio、application/pdf→file、空串→file）与 `imageToDataUrl` 的尺寸计算纯逻辑（抽 `fitWithin(w, h, maxDim)` 纯函数：2048×1024 max 1280 → 1280×640；800×600 → 原样）。
```ts
import { describe, expect, test } from "bun:test"
import { classifyMime, fitWithin } from "./use-attachments"

describe("classifyMime", () => {
  test("按 mime 前缀分类", () => {
    expect(classifyMime("image/png")).toBe("image")
    expect(classifyMime("video/mp4")).toBe("video")
    expect(classifyMime("audio/wav")).toBe("audio")
    expect(classifyMime("application/pdf")).toBe("file")
    expect(classifyMime("")).toBe("file")
  })
})
describe("fitWithin", () => {
  test("超限时等比缩小", () => {
    expect(fitWithin(2048, 1024, 1280)).toEqual([1280, 640])
  })
  test("未超限原样返回", () => {
    expect(fitWithin(800, 600, 1280)).toEqual([800, 600])
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/desktop && bun test src/renderer/mafw/chat/use-attachments.test.ts`
Expected: FAIL

- [ ] **Step 3: 搬迁实现**

ChatPane 608-814 的附件管线（文件选择/粘贴/拖拽/canvas 下采样/A2A 上传/mime 表）迁入 `use-attachments.ts`；`fitWithin`/`classifyMime` 为导出纯函数；canvas 操作留在 hook 内（不依赖 Solid 响应式之外的东西）。ChatPane 原位置改为 `const att = useAttachments()`，chips 行 JSX 引用 `att.attachments()`/`att.removeAttachment`，事件处理引用 `att.addPaste` 等。

- [ ] **Step 4: 跑测试 + 构建**

Run: `cd packages/desktop && bun test`
Expected: 全量通过（新增 3 测试）
Run: `cd packages/desktop && npx electron-vite build`
Expected: 通过

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/mafw/chat/use-attachments.ts packages/desktop/src/renderer/mafw/chat/use-attachments.test.ts packages/desktop/src/renderer/mafw/components/ChatPane.tsx
git commit -m "refactor(desktop): 附件管线抽为 chat/use-attachments.ts hook"
```

---

### Task 5: W2 — 抽 use-voice-binding.ts hook

**Files:**
- Create: `packages/desktop/src/renderer/mafw/chat/use-voice-binding.ts`
- Modify: `packages/desktop/src/renderer/mafw/components/ChatPane.tsx:381-584,1386-1420` + 语音相关 JSX（1880-1907）
- Test: `packages/desktop/src/renderer/mafw/chat/use-voice-binding.test.ts`

**Interfaces:**
- Consumes: `renderer/mafw/voice/session.ts` 的 VoiceSession；workspace（mediaSpeak 注册）
- Produces:
```ts
useVoiceBinding(sessionID: () => string, opts: { speakToolText: (text: string) => void }): {
  voiceState: () => "idle" | "recording" | "speaking" | "interrupted"
  speakText(text: string): void
  startRecording(): void
  stopRecording(): void
  interruptTts(): void
}
```
另导出纯函数 `extractVoiceReplyText(text: string): string | null`（VOICE_REPLY_RE 匹配逻辑，可单测）与 `lastAssistantTextOf(messages: any[]): string | null`。

- [ ] **Step 1: 写失败测试**

`use-voice-binding.test.ts`：`extractVoiceReplyText` 对 `[语音回复 art:xxx 音色:茉莉 h:abc]` 标记提取、无标记返回 null；`lastAssistantTextOf` 取最后一条 assistant text part、空数组返回 null。
```ts
import { describe, expect, test } from "bun:test"
import { extractVoiceReplyText, lastAssistantTextOf } from "./use-voice-binding"

describe("extractVoiceReplyText", () => {
  test("提取语音回复标记前的文本", () => {
    expect(extractVoiceReplyText("你好[语音回复 art:1 音色:茉莉 h:x]")).toBe("你好")
  })
  test("无标记返回 null", () => {
    expect(extractVoiceReplyText("普通文本")).toBeNull()
  })
})
describe("lastAssistantTextOf", () => {
  test("取最后一条 assistant 的 text part", () => {
    const msgs = [
      { role: "user", parts: [{ type: "text", text: "q" }] },
      { role: "assistant", parts: [{ type: "text", text: "a1" }] },
      { role: "assistant", parts: [{ type: "text", text: "a2" }] },
    ]
    expect(lastAssistantTextOf(msgs)).toBe("a2")
  })
  test("空数组返回 null", () => {
    expect(lastAssistantTextOf([])).toBeNull()
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/desktop && bun test src/renderer/mafw/chat/use-voice-binding.test.ts`
Expected: FAIL

- [ ] **Step 3: 搬迁实现**

ChatPane 381-584（VoiceSession 接线、assistant 播报、handleVoiceSegment 乐观上传管线 ~95 行、speakText）+ 1386-1420（语音自动播放 effect）迁入 `use-voice-binding.ts`；正则 VOICE_REPLY_RE 的匹配逻辑抽为 `extractVoiceReplyText` 纯函数；mediaSpeak 注册走 `workspace.register("mediaSpeak", sid, fn)`（保持现有接口）。ChatPane 原位置改为 `const voice = useVoiceBinding(() => props.sessionID, { speakToolText: ... })`。

- [ ] **Step 4: 跑测试 + 构建**

Run: `cd packages/desktop && bun test`
Expected: 全量通过（新增 4 测试）
Run: `cd packages/desktop && npx electron-vite build`
Expected: 通过

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/mafw/chat/use-voice-binding.ts packages/desktop/src/renderer/mafw/chat/use-voice-binding.test.ts packages/desktop/src/renderer/mafw/components/ChatPane.tsx
git commit -m "refactor(desktop): 语音绑定层抽为 chat/use-voice-binding.ts hook"
```

---

### Task 6: W2 — 抽 use-send-message.ts hook

**Files:**
- Create: `packages/desktop/src/renderer/mafw/chat/use-send-message.ts`
- Modify: `packages/desktop/src/renderer/mafw/components/ChatPane.tsx:816-1051`（sendMessage）+ 1053-1111（interrupt/flushQueue）
- Test: `packages/desktop/src/renderer/mafw/chat/use-send-message.test.ts`

**Interfaces:**
- Consumes: `useAttachments` 的 attachments/clearAttachments；`chat.sendEnriched`（MafwShell 经 props 传入的 chat API）；workspace（sendingReset/queueFlush 注册）
- Produces:
```ts
useSendMessage(deps: {
  sessionID: () => string
  chatSend: (sid: string, text: string, attachments: Attachment[]) => Promise<void>
  attachments: () => Attachment[]
  clearAttachments(): void
  matchSlash(text: string): { name: string; args: string } | null
  runSlash(name: string, args: string): Promise<boolean> // true=已消费
}): {
  send(text: string): Promise<void>
  sending: () => boolean
  interrupt(): void
  queued: () => string[]
  flushQueue(): void
}
```
另导出纯函数 `parseSlashCommand(text: string): { name: string; args: string } | null`（`/cmd args` 解析，可单测）与 `buildOptimisticUserMessage(text: string, now?: number): any`（乐观消息构造，id 用 `user-${now}`）。

- [ ] **Step 1: 写失败测试**

`use-send-message.test.ts`：
```ts
import { describe, expect, test } from "bun:test"
import { parseSlashCommand, buildOptimisticUserMessage } from "./use-send-message"

describe("parseSlashCommand", () => {
  test("解析 /cmd args", () => {
    expect(parseSlashCommand("/btw 这是啥")).toEqual({ name: "btw", args: "这是啥" })
  })
  test("无参数", () => {
    expect(parseSlashCommand("/compact")).toEqual({ name: "compact", args: "" })
  })
  test("非 slash 返回 null", () => {
    expect(parseSlashCommand("hello")).toBeNull()
    expect(parseSlashCommand("路径 /tmp 测试")).toBeNull()
  })
})
describe("buildOptimisticUserMessage", () => {
  test("构造乐观消息", () => {
    const m = buildOptimisticUserMessage("你好", 1727000000000)
    expect(m.id).toBe("user-1727000000000")
    expect(m.role).toBe("user")
    expect(m.parts[0].text).toBe("你好")
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/desktop && bun test src/renderer/mafw/chat/use-send-message.test.ts`
Expected: FAIL

- [ ] **Step 3: 搬迁实现**

ChatPane 816-1051 sendMessage 拆为：`parseSlashCommand`（纯）→ slash 分支；`uploadPendingMedia`（附件 A2A 上传循环，消费 use-attachments）；`buildOptimisticUserMessage`（纯）→ 乐观写库；最终 `chatSend`。排队分支（sending 时入 queuedTurns）与 flushQueue（1053-1111）一并迁入。ChatPane 原位置改为 `const sm = useSendMessage({...})`，发送按钮/Enter 调 `sm.send(input())`。

- [ ] **Step 4: 跑测试 + 构建**

Run: `cd packages/desktop && bun test`
Expected: 全量通过（新增 4 测试）
Run: `cd packages/desktop && npx electron-vite build`
Expected: 通过

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/mafw/chat/use-send-message.ts packages/desktop/src/renderer/mafw/chat/use-send-message.test.ts packages/desktop/src/renderer/mafw/components/ChatPane.tsx
git commit -m "refactor(desktop): sendMessage 五合一抽为 chat/use-send-message.ts hook"
```

---

### Task 7: W2 — 抽 TtsPicker.tsx 组件

**Files:**
- Create: `packages/desktop/src/renderer/mafw/chat/TtsPicker.tsx`
- Modify: `packages/desktop/src/renderer/mafw/components/ChatPane.tsx:1232-1306`（逻辑）+ 2343-2417（JSX）

**Interfaces:**
- Consumes: `window.api.mafw.tts.*`（引擎/音色列表）；PopoverShell 组件
- Produces: `TtsPicker(props: { open: boolean; onClose(): void; onPick(voice: string, style?: string): void })`——受控组件，内部自管引擎/音色/风格状态。

- [ ] **Step 1: 搬迁实现**

ChatPane 1232-1306（音色加载/切换/试听/风格保存逻辑）+ 2343-2417（PopoverShell 内联 JSX ~75 行）迁入 `TtsPicker.tsx`，props 收敛为上述接口。本组件为纯 UI 搬迁，无新纯逻辑，不新增测试文件（UI 行为由现有集成路径覆盖）。

- [ ] **Step 2: 构建 + 测试**

Run: `cd packages/desktop && npx electron-vite build`
Expected: 通过
Run: `cd packages/desktop && bun test`
Expected: 全量通过（无新增）

- [ ] **Step 3: Commit**

```bash
git add packages/desktop/src/renderer/mafw/chat/TtsPicker.tsx packages/desktop/src/renderer/mafw/components/ChatPane.tsx
git commit -m "refactor(desktop): TTS picker 抽为 chat/TtsPicker.tsx 受控组件"
```

---

### Task 8: W2 收口 — ChatPane 去 ts-nocheck + 行数验证

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/components/ChatPane.tsx:1`（删 `// @ts-nocheck`）

**Interfaces:**
- Consumes: Task 3-7 产出的 5 个模块
- Produces: 类型化的 ChatPane（≤600 行目标；若超出，记录实际行数与原因）

- [ ] **Step 1: 删 ts-nocheck，修类型错误**

删 ChatPane.tsx:1 的 `// @ts-nocheck`，跑 `npx electron-vite build`，逐个修类型错误（预期集中在 props 类型、store any、事件对象）。修为显式类型，不加回 ts-nocheck、不用 `as any` 蒙混（store 的 any[] 可用 WorkspaceStore 既有类型）。

- [ ] **Step 2: 验证行数与门禁**

Run: `(Get-Content packages/desktop/src/renderer/mafw/components/ChatPane.tsx).Count`
Expected: ≤600（若超，在 commit message 记录实际值与构成）
Run: `cd packages/desktop && bun test`
Expected: 全量通过
Run: `cd packages/desktop && npx electron-vite build`
Expected: 通过

- [ ] **Step 3: Commit**

```bash
git add packages/desktop/src/renderer/mafw/components/ChatPane.tsx
git commit -m "refactor(desktop): ChatPane 去 ts-nocheck 完成类型化（W2 收口）"
```

---

### Task 9: W3 — ChatPaneProps 收敛 + isManager per-session 修复

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/components/ChatPane.tsx`（Props 类型 90-159）
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx`（ChatPane 挂载点 ~2251）
- Modify: `packages/desktop/src/renderer/mafw/workspace/session-workspace.ts`（加 sessionRole/modelPicks/agentPicks 访问器）
- Test: `packages/desktop/src/renderer/mafw/workspace/session-workspace.test.ts`（扩充）

**Interfaces:**
- Consumes: workspace 单例（已有 register/call/records）
- Produces:
```ts
interface ChatPaneProps {
  sessionID: string
  workspace: SessionWorkspace
  paneId: "A" | "B"
  onClose?: () => void
}
// workspace 新增：
workspace.sessionRole(sid: string): string | undefined  // 读 sessions() 中该 tab 的 metadata.mafw.role
```

- [ ] **Step 1: 写失败测试**

`session-workspace.test.ts` 追加：
```ts
test("sessionRole 返回 per-session 角色", () => {
  const ws = createSessionWorkspace()
  ws.setSessions([
    { id: "s1", title: "a", userMsgId: "", assistantMsgId: null, done: false, metadata: { mafw: { role: "manager" } } },
    { id: "s2", title: "b", userMsgId: "", assistantMsgId: null, done: false },
  ] as any)
  expect(ws.sessionRole("s1")).toBe("manager")
  expect(ws.sessionRole("s2")).toBeUndefined()
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/desktop && bun test src/renderer/mafw/workspace/session-workspace.test.ts`
Expected: FAIL（sessionRole 不存在）

- [ ] **Step 3: 实现 sessionRole + Props 收敛**

workspace 加 `sessionRole(sid)`。ChatPane Props 类型替换为 4 字段版；组件体内所有 `props.store`→`props.workspace.store`、`props.registerXxx`→`props.workspace.register(...)`、`props.isManager`→`props.workspace.sessionRole(props.sessionID) === "manager"`、flow cards 相关 props 暂时保留（见 Step 4 说明——若 flowCards 状态迁徙量过大，本波保留 `flowCards`/`sessionCards` 两个 props，在 commit message 记录残留原因）。

- [ ] **Step 4: MafwShell 挂载点改传参**

MafwShell ~2251 处 `<ChatPane ...>` 删 40+ props，改传 `{ sessionID, workspace, paneId, onClose }`。`isManagerSession()` 全局调用点删除。flow cards 若保留 props 则照常传。

- [ ] **Step 5: 跑测试 + 构建**

Run: `cd packages/desktop && bun test`
Expected: 全量通过（新增 1 测试）
Run: `cd packages/desktop && npx electron-vite build`
Expected: 通过

- [ ] **Step 6: Commit**

```bash
git add packages/desktop/src/renderer/mafw/components/ChatPane.tsx packages/desktop/src/renderer/mafw/MafwShell.tsx packages/desktop/src/renderer/mafw/workspace/session-workspace.ts packages/desktop/src/renderer/mafw/workspace/session-workspace.test.ts
git commit -m "refactor(desktop): ChatPaneProps 45→4 收敛走 workspace；isManager 改 per-session 判定修 split view 串扰"
```

---

### Task 10: W4 — mafw.css 按域归位 + 去重

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/mafw.css`

**Interfaces:**
- Consumes: 无
- Produces: 按区段注释组织的 mafw.css（tokens→base→motion→rail→tabs→chat→pickers→overlays→docks→dashboard→config→diff→misc）

- [ ] **Step 1: 机械归位**

用脚本或手工把尾部 4400+ 追加区规则按类名前缀移动到对应区段（`.mafw-queue-*`→chat 区、`.mafw-tsearch-*`→overlays 区、`.mafw-diff-*`→diff 区等），加 `/* ====== 区名 ====== */` 注释头。**不改任何属性值**。

- [ ] **Step 2: 去重**

合并 `.mafw-usage-stack-bar` 两处（~3165 与 ~3180）；`.mafw-session-turn-container{position:relative}`（~4497）并入 ~697 主规则；`.mafw-config-oc-name` font-size 三遍去重；`Select-String` 全文件扫描其余完全重复规则块。

- [ ] **Step 3: 目检 + 门禁**

Run: `cd packages/desktop && npx electron-vite build`
Expected: 通过
Run: `cd packages/desktop && bun test`
Expected: 全量通过（无新增）
人工目检 chat/dashboard/config 三页（重启 desktop）。

- [ ] **Step 4: Commit**

```bash
git add packages/desktop/src/renderer/mafw/mafw.css
git commit -m "refactor(desktop): mafw.css 按域归位 + 重复规则合并（不改样式值）"
```

---

### Task 11: W4 — 硬编码色 token 化

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/mafw.css`

- [ ] **Step 1: 替换硬编码色**

`#7aa2f7`（3 处）→ `var(--accent)`；`#e8636b`（3 处）→ `var(--danger)`；diff 面板 `rgba(128,128,128,...)` 一族 → 新增 `--diff-neutral` token（tokens 区定义，亮暗双主题各一份）。`Select-String -Pattern "#[0-9a-fA-F]{3,6}"` 扫描 tokens 区外残留，逐一替换或记录例外。

- [ ] **Step 2: 目检 + 门禁**

Run: `cd packages/desktop && npx electron-vite build` + `bun test`
Expected: 通过
目检：usage 条、错误态、diff 面板颜色与之前一致。

- [ ] **Step 3: Commit**

```bash
git add packages/desktop/src/renderer/mafw/mafw.css
git commit -m "refactor(desktop): mafw.css 硬编码色 token 化（#7aa2f7/#e8636b/diff rgba 一族）"
```

---

### Task 12: W4 — 剩余字符 glyph 图标统一

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/components/ChatPane.tsx`（titlebar ✕/⎇/← 返回、jump 按钮、发送按钮内联 SVG）
- Test: `packages/desktop/src/renderer/mafw/components/composer-icons.test.ts`（扩充）

- [ ] **Step 1: 扩充图标回归测试**

composer-icons.test.ts 追加断言：`"x"`、`"git-branch"`、`"arrow-left"` 在 v1 图标表且 body 非空（跟随现有 11 图标断言模式）。

- [ ] **Step 2: 跑测试确认现状通过**

Run: `cd packages/desktop && bun test src/renderer/mafw/components/composer-icons.test.ts`
Expected: PASS（图标已在表中，测试先绿）

- [ ] **Step 3: 替换 glyph 为 Icon**

ChatPane titlebar `✕`→`<Icon name="x" />`；`⎇`→`<Icon name="git-branch" />`；`← 返回`→`<Icon name="arrow-left" />返回`；jump 按钮内联 SVG→`<Icon name="arrow-down" />`（或 v1 表中最接近者，先查表）；发送按钮内联 SVG→`<Icon name="send" />`（同上，先查表，缺则沿用内联 SVG 并在 commit 记录）。`.mafw-stop-icon` CSS 方块保留不动。

- [ ] **Step 4: 门禁**

Run: `cd packages/desktop && bun test` + `npx electron-vite build`
Expected: 通过
目检 titlebar/jump/发送按钮渲染正常。

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/mafw/components/ChatPane.tsx packages/desktop/src/renderer/mafw/components/composer-icons.test.ts
git commit -m "refactor(desktop): titlebar/按钮字符 glyph 统一为 SVG Icon"
```

---

## Self-Review 记录

- Spec 覆盖：W1→Task 1-2；W2→Task 3-8；W3→Task 9；W4→Task 10-12。spec §3 第 1 点（注册表泛化）经核实**现状已是泛化注册表**，对应任务已删除并在 Task 9 改为仅加 sessionRole 访问器。
- 占位符：无 TBD；所有测试与实现代码完整。
- 类型一致性：`isLocalMessageId`（Task 2）/`isTopLevelToolEntry`（Task 1）/`parseSlashCommand`（Task 6）等跨任务引用签名一致。
- 已知偏差：Task 8 行数目标 ≤600 为期望值，允许记录实际值；Task 9 flow cards context 化允许残留 props 并记录原因；Task 12 的 send/arrow-down 图标名需先查 v1 表，缺则保留内联 SVG 并记录。
