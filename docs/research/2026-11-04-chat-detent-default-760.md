# Chat 对话列默认档：760 vs 640 —— 业界最大宽度调研

日期：2026-11-04
背景：现行三档 **520 / 640 / 760**、默认 640、墙 760（`workbench-detents.ts`；2026-10-26 rev2 commit `6483323a` 按用户要求设 640 为默认）。用户体感 **760 比 640 舒适**，要求调研业界对话列的最大宽度，回答「默认档该不该上移到 760、墙够不够高」。前次调研（`2026-10-26-detent-ratio-vs-absolute.md`）回答的是「比例 vs 绝对」，本文回答「绝对值锚在哪」。

## 一、业界数据：两类语境必须分开

**聊天阅读列**（chat-first 产品，对话列是主表面——我们的 chat 列属于这类）与 **IDE dock 面板**（对话列是辅助表面）。

### 1a. 聊天阅读列

| 产品 | 列宽 | 字号 | 折合内容 em | 依据 |
|---|---|---|---|---|
| ChatGPT web/desktop | **768px（48rem）帽**，居中 | 16px | 48em | 社区 CSS hack 全在改 `xl:max-w-[48rem]`；4K 用户长期抱怨太窄（OpenAI 社区多个 thread） |
| Codex desktop | **≈768px**（`--thread-content-max-width`），居中留白 | 16px | 48em | 前次调研 issues #16669/#10516；OpenChamber #4286 评价「Codex does this well: prose keeps a readable measure, tables/code extend beyond」 |
| Hermes desktop | **780px（48.75rem `--composer-width`）** → PR #86766 改 100% 全宽 → 用户反弹「long prose lines genuinely tiring」→ PR #95134 恢复三档预设（narrow **44rem=704** / default **780** / wide） | 16px | 48.75em | issues #55287 / #134024、PR #95134 |
| OpenClaw Control UI | **min(900px, 68%)** 帽 | 16px | 56em | issue #67935（后加 `--chat-max-width` 可配） |
| OpenChamber | narrow 档 48rem=768 全帽 / wide 档全宽 | 16px | 48em | issue #4286 请求「正文限宽、表格/代码突破限宽」；相关 PR #2118 做三档 Narrow/Wide/Fluid |
| Claude Desktop Code tab | 无帽拉伸；用户请求 **720-820px** 帽，官方关为 not planned | — | — | anthropics/claude-code #57991 |
| Discord | 无帽 full-bleed | 16px | — | 社区主题（relaxed-discord 等）自行加「~80 字符」帽补偿阅读疲劳 |
| Slack / Linear | 默认带阅读帽（数值未公开） | — | — | Hermes #134024 引为「standard chat-UX pattern (Discord, Slack, ChatGPT web, Linear all ship a reading-width cap)」※该句对 Discord 的描述与实测不符，Discord 实为 full-bleed |

**锚点高度收敛：768-780px（48-48.75rem @16px），已知最宽默认帽 900px（OpenClaw）。** 无帽的（Discord、Claude Code tab）都有用户在要帽子；改成全宽的（Hermes #86766）被反弹回预设制；用户自定义 1200px 只出现在超宽屏（Cursor）。

### 1b. IDE dock 型面板（对照）

| 产品 | 宽度机制 | 依据 |
|---|---|---|
| VS Code 侧栏 | min 170 / preferred 下限 300 / **max = ∞**（`sidebarPart.ts: maximumWidth = Number.POSITIVE_INFINITY`）；社区实践自约束 ~45% 窗宽 | 源码（2026-11-04 main）；vscode-sidebar-resize-half 扩展 |
| VS Code Copilot Chat（副侧栏） | 同上自由拖；默认宽被长期抱怨「unusable，求翻倍」 | issues #158603 / #283355 |
| Cursor | 右栏 min 400（2026-03 从 300 上调）；自由拖到大半窗（双击 tab 展开）；**内容**另有固定帽，`cursor.chatMaxWidth` 可调，UW 用户设 1200 | forum #155981 / #149076 |
| Zed Agent Panel | 默认 640 | 前次调研 |
| opencode desktop | 默认 600 | 源码 `layout.tsx` |

IDE dock 无硬帽、靠兄弟面板最小宽自然约束——正是我们护栏的形态；但其默认值（300/400/600/640）是**辅助表面**语境。我们的 chat 是主表面，默认值应对标 §1a。

## 二、归一化对比（字号不同，必须折 em）

实测本仓参数：正文 **14px**（`--font-size-base`），对话列水平 padding **`0 32px`**（`.mafw-session-turn-container`，mafw.css:796）。CJK 1 字 = 1em；Latin ≈ 0.51em/字符。

| 档位 | 内容宽 | 内容 em（内容宽/字号） | CJK 字/行 | Latin 字/行 |
|---|---|---|---|---|
| 520 | 456px | 32.6em | ~33 | ~64 |
| 640 | 576px | 41.1em | ~41 | ~81 |
| **760** | 696px | **49.7em** | **~50** | **~97** |
| ChatGPT 768@16px | 768px | 48em | ~48 | ~96 |

- **760 ≈ ChatGPT 阅读列的等价物**：CJK 50 vs 48 字/行、Latin ~97 vs ~96 字/行，几乎同长；也落在 Claude Desktop 用户请求的 720-820px 帽带内。
- **640（41.1em）比业界锚点（48em）窄 7em**——按聊天阅读列标准是「偏紧凑」档（对标 Hermes narrow 704 之下）。
- 散文舒适带（65-75 Latin / 30-45 CJK，Baymard/经典排版指引）：640 在带内上缘，760 略超；但**所有聊天产品都超出**（内容混 code/表格/工具卡，消息是短段落而非长文），ChatGPT 同样超出且用户还在要求更宽。
- em 梯度再参照：OpenClaw 900@16 = 56em 是「宽」的已知上限先例；我们 760 = 49.7em、640 = 41.1em、520 = 32.6em。

## 三、「业界最大大小」的直接回答

1. **聊天阅读列：主流帽 768-780px**（ChatGPT / Codex / OpenChamber-narrow / Hermes-default 全部 48rem 附近）；OpenClaw 900px 是已知最宽默认帽；**1200px 只见于超宽屏用户自定义**（Cursor `chatMaxWidth`）。
2. **IDE dock：无硬帽**（VS Code `maximumWidth = ∞`），靠其他面板最小宽约束——我们 `clamp(detent, 320, min(760, avail−640))` 护栏同构，无需动。
3. **我们的墙 760 已经就是业界聊天阅读列锚点（768-780）**——墙不用动；问题只是默认档坐在 41.1em，比锚点低半档到一档。

## 四、建议（供拍板）

**rev3：默认档 640 → 760**（三档 520/640/760 不变、墙 760 不变、双击回 760）。

1. 用户体感与业界锚点吻合：760 是「业界标准聊天阅读列」在我们 14px 字号下的等价物（49.7em，介于 ChatGPT 48em 与 OpenClaw 56em 之间）。
2. 640 默认对标业界是偏紧凑档（41.1em < Hermes narrow 704@16=44em）；改后梯度语义变成 520 紧凑 / 640 标准 / 760 阅读，更贴合业界分布。
3. 墙保持 760：再往上只有 OpenClaw 900 与 UW 自设 1200 的先例；主窗 1600 还要养 640 工作台 + 46 rail，760 是平衡点。**deferred**：若日后 4K/UW 用户抱怨不够宽，再议 880-900 档（OpenClaw 先例），本批不做。
4. rev2 的 640 默认是 2026-10-26 用户拍板（commit `6483323a`），本次由同一用户的新偏好取代，属正常 rev 迭代。

### 实施影响（若执行）

- `workbench-detents.ts`：`WORKBENCH_DEFAULT_DETENT = 760`；`normalizeDetent` / `migrateLegacyChatWidth` 缺省随动；头注释补 rev3 与本文引用。
- `left-dock.ts`：**`PUSH_PAIR_BUDGET = 1280` 建议不动**，注释语义从「保默认档 640+640」改为「保底 640+640」。左 dock 开着时 760 被护栏钳回 ~650（1600 窗：avail = 1600−46−264 = 1290 → chat 650，与今日 640 几乎无差），无左 dock 或窗宽 ≥ 1710 时 760 全实现——「无 dock 时聊天优先、有 dock 时协商让位」，行为优雅无需阈值改动。若坚持「push 必须保默认档」则预算 +120 → 1590→1710 预算点，默认 1600 窗的左 dock 直接翻 overlay，得不偿失，不推荐。
- 测试：`workbench-detents.test.ts`（默认值/迁移/双击回默认断言）、`left-dock.test.ts`（预算注释）、layout 持久化用例；旧 localStorage 存的 640 仍合法（白名单不变，仅缺省值变）。
- GUI 冒烟清单：1600 窗无左 dock 760 全实现 / 有左 dock 钳 ~650 / 双击回 760 / 存量 640 偏好不丢。

## 来源

- 本仓：`workbench-detents.ts`、`left-dock.ts`、`mafw.css`（`.mafw-session-turn-container` padding `0 32px`、`--font-size-base` 14px）、`2026-10-26-detent-ratio-vs-absolute.md`
- VS Code：`src/vs/workbench/browser/parts/sidebar/sidebarPart.ts`（min 170 / max ∞ / preferred ≥300，2026-11-04 main）；issues #158603、#283355
- Cursor：forum「Chat is fixed-width even with a large screen」#149076（`cursor.chatMaxWidth`，UW 设 1200）、「Right sidebar min width」#155981（min 300→400）、「Minimal chat width becomes so large」#164086
- Hermes desktop：issues #55287（48.75rem≈780 默认与预设提案）、#134024（全宽后要求阅读帽，optimal 45-90 chars）、PR #95134（narrow 44rem / default / wide 三档）、PR #86766（100% 全宽引发反弹）
- OpenClaw：issue #67935（`min(900px, 68%)` 帽 + `--chat-max-width` 可配）
- OpenChamber：issue #4286（narrow 48rem 全帽 vs wide 全宽之争；「Codex does this well」）
- Claude Desktop：anthropics/claude-code #57991（无帽，用户请求 720-820px 帽）
- ChatGPT：OpenAI 社区「Wider conversation view」「Ability to increase max-width」（48rem 帽与 4K 抱怨）
- Discord：设计系统分析（chat 列 fluid 无帽、16px 正文）+ relaxed-discord 主题（社区自行加 ~80 字符帽）
