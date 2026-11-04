# Inputbar（composer）重设计调研 · 2026-11-04

> 范围：桌面端 ChatPane composer 的内容与按钮结构重设计（样式层）。纯研究，不改码。
> 前置：2026-10-09 `docs/research/2026-10-09-desktop-small-window-layout.md` §5 已定「溢出降级」共识（单行、按优先级降级、@container、发送恒显）——本篇补的是**内容与结构层**：按钮该有哪些、放哪、怎么分组。溢出策略是内容收敛后的兜底，不再是主策略。

## 1. 现状盘点（实读 `ChatPane.tsx` + `mafw.css`，2026-11-04 main）

Composer 结构（上→下）：DuplexVoiceBar（条件）→ chips 行（附件/@agent/@file，条件）→ textarea（52-200px）→ keyhint 浮层 → 工具条 44px。

工具条**常态最多 17 个元素**：

| 组 | 元素 | 类型 | 条件 |
|---|---|---|---|
| 左 | 附件 📎 | 输入动作 | 恒显 |
| 左 | ⋯ 更多 | 溢出入口 | ≤720 才出现 |
| 左 | 截屏批注 📷 | 输入动作（附件变体） | `optional`（≤720 隐藏） |
| 左 | 命令 (/) | 教学按钮（typed affordance） | `collapse`（≤620 隐藏） |
| 左 | 引用 Agent (@) | 教学按钮（typed affordance） | `collapse`（≤620 隐藏） |
| 左 | 审阅改动 👁（badge=diff 数） | **导航动作** | `optional` |
| 左 | 语音播报 🔊 | **输出动作** | `optional` |
| 左 | 语音输入 🎤 | 输入动作 | `optional` |
| 左 | 分隔线 | 视觉 | ≤620 隐藏 |
| 左 | 审批模式 pill（🛡只读/自动/全开） | 会话安全档位 | 恒显（≤620 图标化） |
| 左 | plan/build pill | 会话模式 | plan/build 可用时 |
| 右 | composer-meta | 状态文本 | 有 meta 时 |
| 右 | Agent pill（lead/build…） | 会话身份 | primaryAgents 非空或 Lead |
| 右 | 模型 pill ▾ | 会话配置 | 恒显 |
| 右 | 上下文 pill（12% · $0.06） | **状态指示** | 恒显（≤520 隐藏） |
| 右 | 暂停 ⏸ | run 控制 | busy + run.control |
| 右 | 发送/停止 ➤ ■ | 主动作 | 恒显 |

更多菜单（⋯）9 项：截屏批注 / 暂停回合 / 命令 / 引用 Agent / 审阅改动 / 语音播报 / 语音输入 / 切换 Agent / 切换模型。
另有 keyhint 一行文字（focus 时淡入）："↑ 历史 · Enter 发送 · Shift+Enter 换行 · @ 引用文件"。

**问题速记**：① 常态 17 元素远超业界（4-6）；② 输入动作、导航动作（审阅）、输出动作（语音播报）混排；③ `/`、`@` 是 typed affordance，业界不给按钮；④ 5 个会话状态/配置（审批、plan/build、agent、模型、上下文）全部摊在工具条；⑤ 4 档容器降级 + `:has()` hack 是在给「内容过多」打补丁。

## 2. 业界对照（2026-04~10 实测/官方文档）

| 产品 | composer 常态控件 | 模型在哪 | agent/mode 在哪 | 备注 |
|---|---|---|---|---|
| **ChatGPT web**（2026-04 起） | `+`（附件+能力）、工具(sliders)、🎤、发送 ≈ **4** | **搬进 composer**（release notes 2026-04：模型选择进 composer）；effort 收进模型 picker | 模式经 `+` 菜单，无 agent pill | mobile 把工具图标行**整个删掉**，合并为一个 sliders 图标开 Skills 菜单——"No tools are deprecated—access is simply consolidated to clear space" |
| **Claude.ai**（2026-05 起） | `+` 附件、thinking/effort、模型菜单、发送 ≈ **4** | **发送按钮旁的模型菜单一个菜单管三件事**：模型 + effort + thinking（官方 help：The model menu next to the send button controls three settings） | 无 agent 概念 | 「一个域一个菜单」的典范 |
| **Cursor** | @ 上下文、mode 下拉、model 下拉、发送 ≈ **4-5** | 输入框内下拉 | **mode 与 model 分开两个下拉**；Shift+Tab 循环 mode | 官方文档："mode 决定 AI 被允许做什么；model 决定是哪个 AI"；mode 切换=新上下文 |
| **VS Code Copilot Chat** | `#`-mention、keep context、mode 下拉、model 下拉、发送 ≈ **5** | 输入框内下拉 | mode 下拉 | `#` 打字触发（file/codebase/terminalSelection…）；上下文占用=输入区 donut 指示；**他们自己的 issue #287924（2026-01）也在抱怨输入框下拉过多** |
| **opencode v2**（我们同类参照） | model+agent picker 在输入下方、发送 ≈ **3-4** | 输入下方 | **agent picker 默认隐藏**（`showCustomAgents=false`，issue #30360；changelog："Hide agent names when agents are disabled"）；build/plan 仅 Tab | 社区评价其「clutter-free minimal」是卖点；模型可 per-prompt 切、thinking 档在 model picker 旁 |

通用惯例（setproduct 等桌面共识，2026-10-09 调研已收录）：multiline textarea + 附件按钮 + 模型选择（不在顶栏就在输入区）+ 发送；shortcut hints 常见但轻量；发送/停止 ≥44px；composer 随内容增长到上限后内滚。

## 3. 可提取的设计原则

1. **常态控件 ≤5**：ChatGPT 4、Claude 4、Cursor 4-5、opencode 3-4。我们 17。
2. **一个域一个菜单**：Claude 的模型菜单（模型+effort+thinking）、ChatGPT 的 `+`（附件+工具）。同一域的多个旋钮不摊成多个常驻 pill。
3. **Typed affordance 不给按钮**：`/`、`@`、`#` 全行业靠打字触发 + placeholder/keyhint 教学。我们给 `/` 和 `@` 各配了常驻按钮。
4. **输入条只放输入动作**：导航（审阅改动）和输出（语音播报）不在 composer。审阅归 turn 动作/工作台 tab；播报归 turn 动作。
5. **附件变体进附件菜单**：截屏批注本质是「附件的来源变体」，ChatGPT 把 Photos 等收进 `+` 菜单。
6. **低频高配收进设置/隐藏**：opencode 干脆把 agent picker 默认藏了。我们 Pod 模型下 agent 大多数时候就是 lead/build。
7. **状态指示≠控件**：上下文 pill 是只读状态（我们已不可切）；VS Code 用极小 donut。可压缩、可变色，不必与控件同级。
8. **发送恒显、run 控制贴发送**（已有，保留）。

## 4. 差距清单（ours vs 原则）

| # | 差距 | 违反原则 | 处置方向 |
|---|---|---|---|
| G1 | 常态 17 元素 | P1 | 收敛到 ≤6 |
| G2 | 审阅改动（导航）在 composer | P4 | 降级进 ⋯ 菜单（SessionTurn actions + 工作台「审阅」tab 已有入口，实读确认） |
| G3 | 语音播报（输出）在 composer | P4 | 降级进 ⋯ 菜单或移到 turn 动作 |
| G4 | 截屏批注与附件并列 | P5 | 并入 `+` 附件菜单 |
| G5 | `/`、`@` 常驻按钮 | P3 | 删按钮，靠打字 + placeholder 教学（keyhint 已有） |
| G6 | 5 个状态/配置 pill 摊开 | P2/P6 | agent pill 默认隐藏（非默认 agent 才显示）；plan/build 并入 agent/mode 域；审批模式保留图标化（安全档位需常驻可见）；上下文 pill 压缩 |
| G7 | keyhint 整行常驻 | P7 | 并入 placeholder 或聚焦 tooltip，还 composer 高度 |
| G8 | 4 档降级 + `:has()` hack | — | 内容收敛后档位可减半（预计 ≤720 一档 + 兜底） |

## 5. 重设计方向（三选一，供决策）

**A · ChatGPT 式「加号收纳」**
左：`＋`（附件/截屏批注）· `⋯`（其余全部：命令、引用、审阅、播报、录音除外）｜右：🎤 · 上下文微标 · 模型菜单 · 暂停 · 发送。
常态 ≈6。改动最小，与现有 more-menu 机制直接衔接。

**B · Claude 式「会话配置单菜单」**（推荐）
左：`＋`（附件/截屏批注/引用 Agent）｜右：🎤 · 上下文微标 · `[build ▾]` 会话菜单（模型+agent+plan/build）· 暂停 · 发送。
模型/agent/plan-build 是同一域（「这次谁来做、怎么做」）——收进一个菜单，默认态只显示当前值短标签。审批模式保留独立图标 pill（安全域，刻意不与模型混）。常态 ≈6，且每个常驻元素语义单一。

**C · opencode v2 式「对齐上游」**
输入下方平铺 model+agent picker（与 opencode v2 同构），agent 默认隐藏；composer 只剩 `＋`/🎤/发送。
最贴上游心智，但与我们「右组集中配置」的现行桌面语言不同构，动得多。

**共同项（三案一致）**：G2-G5、G7 全做；发送/pause 位置不动；chips 行不动；`/`、`@`、↑↓、Tab、Ctrl+Enter 键位全部不动（键位是肌肉记忆，UI 只删按钮不删功能）。

## 6. 结论

- 差距本质不是「样式不好看」，是**内容未收敛**：4 类异质动作（输入/导航/输出/教学）+ 5 个会话状态摊在一条 44px 工具条上，溢出降级四档全是给这个打补丁。
- 推荐方向 **B**：一域一菜单（模型+agent+mode）、输入条只留输入动作、typed affordance 去按钮化、状态指示压缩。预计常态 17→6，降级档位 4→2。
- 决策点：B 的「会话配置单菜单」默认标签显示什么（当前 agent 短名 vs 当前模型名 vs 双 chip）。
