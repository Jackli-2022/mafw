# Desktop 思考块：默认折叠 + 活动计时 + 流式点开 — 调研与设计

日期：2026-09-22 · 状态：待确认 · 范围：`packages/desktop`（纯 UI 层，gateway/SDK 零改动）

## 业界实现对比

| 产品 | 流式中 | 完成后 | 点击展开 | 计时 | glyph 动效 |
|---|---|---|---|---|---|
| **Claude Code (CLI)** | 折叠；状态行动效 glyph + 计时 | 折叠（transcript 内 Thinking 行） | Ctrl+O transcript「expands lines that collapse by default」 | 秒级 tick | braille/星形帧循环 |
| **Claude.ai** | **自动展开**灰底面板流式陪看 | 自动收起为 pill「Thought for 12s」 | 点 pill 重看 | 完成后显示总时长 | 无（呼吸文本） |
| **ChatGPT (o 系列)** | 折叠，仅状态条「Thinking…」微光 | 折叠 pill「Thought for 14 seconds」 | 展开**摘要**（故意不给原始 CoT） | 秒级 | 文字微光 |
| **Gemini** | 「Show thinking」默认收起 | 收起 | 点开看 thought 流 | 有 | 无 |
| **DeepSeek R1** | **自动展开**灰块流式 | 收起「已深度思考（用时 X 秒）」 | 重看 | 完成后标注用时 | 无 |
| **开源系（open-webui/LobeChat/LibreChat）** | 可配置（多为流式展开） | 自动收起，标题带时长 | antd Collapse 式 | 标题内嵌 | 无 |
| **session-ui 默认（被我们覆盖前）** | **无折叠**，reasoning 内联铺开 | 内联 | — | — | — |

来源：Claude Code 交互模式官方文档（Ctrl+O「expands lines that collapse by default」，
docs.anthropic.com/en/docs/claude-code/interactive-mode）；其余为产品行为观察。
本地参照：session-ui `message-part.tsx:1842`（默认无折叠——噪音来源，即本次覆盖的动机）；
pi-tui `Loader`（braille 帧 80ms 循环——CLI spinner 惯例）。

**收敛结论**：业界分成「陪看派」（Claude.ai/DeepSeek：流式自动展开）与「折叠派」
（Claude Code/ChatGPT：永远折叠 + 状态行动效计时）。桌面端一屏多消息、密度高，
**折叠派是共识取向**；差异点只在状态行的动效与计时粒度。我们取：
折叠派 + Claude Code 式状态行（glyph 动效 + 秒级 tick），完成后 pill 保留时长。

## 需求

1. 思考（reasoning）**默认折叠**——流式期间也不自动展开
2. 计时**会动**：思考进行中显示逐秒递增的 `思考中 Ns`
3. **点开看流式思考**：展开后 reasoning 文本随 SSE 实时增长
4. 参考：Claude Code 的 thinking 折叠头（✻ 旋转 + 计时 + 收起）

## 现状调研（代码事实）

### 数据面 —— 已就绪，无需改动

- 注册点：`ThinkingBlock.tsx` `registerPartComponent("reasoning", ThinkingBlock)`，
  覆盖 session-ui 默认 reasoning 渲染。
- 文本来源：`readPartText(data.store.part_text_accum_delta, part())`
  = `accum?.[part.id] ?? part.text ?? ""`。
  `part_text_accum_delta` 在 desktop **从未被写入**（全仓库零写点）→ 实际走
  `part.text` 回退。
- `part.text` 的响应式更新链路（chat-stream.ts）：
  - `message.part.updated` → `applyPartUpsert`（全量快照 upsert，任意 part 类型含 reasoning）
  - `message.part.delta` → `applyPartDelta`（`field==="text"` 时把 delta 追加到
    `cur.text`——reasoning part 若已在 store 中，delta 直接累加到其 text）
  - 即：**reasoning 文本已随 SSE 增长且是 Solid 响应式的**。点开时
    `<Markdown streaming={streaming()}>` 已支持流式渲染。数据面无需任何改动。

### UI 面 —— 三个与需求的偏差

| # | 现状 | 需求 |
|---|------|------|
| 1 | `<Show when={streaming() \|\| open()}>`——**流式期间自动展开** | 永远默认折叠，仅点击展开 |
| 2 | label：streaming → 静态"思考中…"；结束后冻结 `已思考 Ns`（`thinkingDurationSec` 的 `now` 参数在无响应式依赖的 memo 中一次性求值，**不会跳动**） | streaming 中逐秒递增 |
| 3 | caret 在 streaming 时隐藏（`<Show when={!streaming()}>`）——流式中看不出可点开 | caret 常显 + glyph 动效提示 |

### 计时边界情况（需防御）

`thinkingDurationSec(time, now)`：`end` 缺失时用 `now`。abort/error 场景
reasoning part 的 `time.end` 可能永远缺失，而 `reasoningStreaming()` 会因
`message.time.completed` 变为 false——若此时才第一次计算 duration，会得到
`now - start` 的巨大值。**方案**：组件内维护 `lastTickSec`，streaming 期间
每秒刷新；`!streaming` 且 `end` 缺失时用 `lastTickSec` 冻结，不回退到 now。

## 设计（改动面：3 个文件，全部 UI 层）

### ThinkingBlock.tsx

1. `<Show when={streaming() || open()}>` → `<Show when={open()}>`（默认折叠）。
2. 计时器：`const [tick, setTick] = createSignal(Date.now())`；
   `createEffect` 当 `streaming()` 为 true 时 `setInterval(() => setTick(Date.now()), 1000)`，
   false 时清除（onCleanup）。
3. label 推导：
   - streaming → `思考中 ${sec}s`（sec = `Math.max(1, round((tick()-start)/1000))`）
   - !streaming 且 `time.end` 存在 → `已思考 Ns`（现有逻辑）
   - !streaming 且 `end` 缺失 → `已思考 ${lastTickSec}s`（防 abort 巨值）
4. caret 常显（streaming 时也显示 ▸/▾）。
5. glyph `✻` 在 streaming 时加 CSS 类做旋转动效。

### thinking-label.ts

`thinkingLabel` 增加可选 `tickingSec`：streaming 时优先用它（向后兼容现有签名，
desktop tests 如有引用不动）。`reasoningStreaming` / `thinkingDurationSec` 不变。

### mafw.css

- `.mafw-thinking-glyph.stream`：`animation: mafw-think-spin 1.2s linear infinite`
  （keyframes 旋转；沿用现有 `prefers-reduced-motion` 全局守卫，自动降级）。
- caret/label 无需新样式。

## 实现计划（确认后执行）

1. `thinking-label.ts`：`thinkingLabel` 支持 tickingSec；补/改单测（node --test，
   desktop 侧如有 thinking-label 测试文件则同步）。
2. `ThinkingBlock.tsx`：折叠逻辑 + tick interval + lastTickSec 冻结 + caret 常显。
3. `mafw.css`：glyph 旋转 keyframes。
4. 构建 + bun test 全量；探针实例真实触发一轮带思考的对话，CDP 验证：
   默认折叠 → label 每秒 +1 → 点开展开显示流式增长文本 → 结束后冻结。
5. 完成后**等你确认**再提交/推送。

## 不做的事

- 不动 gateway / SDK / SSE 协议（数据面已满足）。
- 不给思考块加自动展开的任何特例（含 streaming）。
- 不改 session-ui 默认 reasoning 渲染（desktop 覆盖层职责）。
